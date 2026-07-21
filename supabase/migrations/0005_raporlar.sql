-- ============================================================================
-- Faz 3: Rapor fonksiyonları
-- Ciro tanımı: KAPANMIŞ adisyonların (durum='odendi', kapanış tarihi aralıkta)
-- geçerli kalemleri — yani POS'tan gerçekten tahsil edilen para (Z raporu mantığı).
-- Tüm fonksiyonlar security invoker: personelin RLS yetkileriyle, kendi kafesiyle
-- sınırlı çalışır. Saat/gün hesapları Europe/Istanbul dilimindedir.
-- ============================================================================

-- Yardımcı: bir adisyonun geçerli (iptal/red olmamış) kalem toplamı
create or replace view public.adisyon_tutarlari
with (security_invoker = true) as
select
  a.id as adisyon_id,
  a.cafe_id,
  a.masa_id,
  a.durum,
  a.acilis,
  a.kapanis,
  coalesce(sum(
    case
      when s.durum in ('iptal', 'reddedildi') or k.reddedildi then 0
      else (k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet
    end
  ), 0) as tutar
from public.adisyon a
left join public.siparis s on s.adisyon_id = a.id
left join public.siparis_kalemi k on k.siparis_id = s.id
group by a.id;

-- ---------------------------------------------------------------------------
create or replace function public.rapor_ozet(p_baslangic timestamptz, p_bitis timestamptz)
returns table (
  ciro numeric,
  adisyon_sayisi bigint,
  siparis_sayisi bigint,
  ortalama_adisyon numeric,
  iptal_sayisi bigint,
  iptal_tutar numeric
)
language sql stable security invoker set search_path = public as
$$
  with kapanan as (
    select tutar from adisyon_tutarlari
    where durum = 'odendi' and kapanis >= p_baslangic and kapanis < p_bitis
  ),
  gecerli_siparis as (
    select id from siparis
    where created_at >= p_baslangic and created_at < p_bitis
      and durum not in ('iptal', 'reddedildi')
  ),
  iptaller as (
    select s.id,
      coalesce((
        select sum((k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet)
        from siparis_kalemi k where k.siparis_id = s.id
      ), 0) as tutar
    from siparis s
    where s.durum in ('iptal', 'reddedildi')
      and s.updated_at >= p_baslangic and s.updated_at < p_bitis
  )
  select
    coalesce((select sum(tutar) from kapanan), 0),
    (select count(*) from kapanan),
    (select count(*) from gecerli_siparis),
    coalesce((select round(avg(tutar), 2) from kapanan), 0),
    (select count(*) from iptaller),
    coalesce((select sum(tutar) from iptaller), 0)
$$;

-- ---------------------------------------------------------------------------
create or replace function public.rapor_gunluk(p_baslangic timestamptz, p_bitis timestamptz)
returns table (gun date, ciro numeric, adisyon_sayisi bigint)
language sql stable security invoker set search_path = public as
$$
  select
    (kapanis at time zone 'Europe/Istanbul')::date as gun,
    sum(tutar) as ciro,
    count(*) as adisyon_sayisi
  from adisyon_tutarlari
  where durum = 'odendi' and kapanis >= p_baslangic and kapanis < p_bitis
  group by 1
  order by 1
$$;

-- ---------------------------------------------------------------------------
create or replace function public.rapor_saatlik(p_baslangic timestamptz, p_bitis timestamptz)
returns table (saat int, siparis_sayisi bigint)
language sql stable security invoker set search_path = public as
$$
  select
    extract(hour from created_at at time zone 'Europe/Istanbul')::int as saat,
    count(*) as siparis_sayisi
  from siparis
  where created_at >= p_baslangic and created_at < p_bitis
    and durum not in ('iptal', 'reddedildi')
  group by 1
  order by 1
$$;

-- ---------------------------------------------------------------------------
-- Ürün satışları + reçeteden yaklaşık maliyet (hammadde son alış fiyatlarıyla)
create or replace function public.rapor_urun(p_baslangic timestamptz, p_bitis timestamptz)
returns table (urun_ad text, adet bigint, ciro numeric, maliyet numeric)
language sql stable security invoker set search_path = public as
$$
  select
    k.urun_ad,
    sum(k.adet) as adet,
    sum((k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet) as ciro,
    case
      when max(rm.birim_maliyet) is null then null
      else round(sum(k.adet * coalesce(rm.birim_maliyet, 0)), 2)
    end as maliyet
  from siparis_kalemi k
  join siparis s on s.id = k.siparis_id
  join adisyon a on a.id = s.adisyon_id
  left join lateral (
    select sum(r.miktar * h.son_birim_fiyat) as birim_maliyet
    from recete r
    join hammadde h on h.id = r.hammadde_id
    where r.urun_id = k.urun_id and h.son_birim_fiyat is not null
  ) rm on true
  where a.durum = 'odendi'
    and a.kapanis >= p_baslangic and a.kapanis < p_bitis
    and s.durum not in ('iptal', 'reddedildi')
    and not k.reddedildi
  group by k.urun_ad
  order by ciro desc
$$;

-- ---------------------------------------------------------------------------
-- Kayıp analizi: iptal ve reddedilen siparişler
create or replace function public.rapor_iptaller(p_baslangic timestamptz, p_bitis timestamptz)
returns table (zaman timestamptz, masa_ad text, durum public.siparis_durum, tutar numeric, kalemler text)
language sql stable security invoker set search_path = public as
$$
  select
    s.updated_at,
    m.ad,
    s.durum,
    coalesce((
      select sum((k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet)
      from siparis_kalemi k where k.siparis_id = s.id
    ), 0),
    (
      select string_agg(k.adet || '× ' || k.urun_ad, ', ' order by k.id)
      from siparis_kalemi k where k.siparis_id = s.id
    )
  from siparis s
  join masa m on m.id = s.masa_id
  where s.durum in ('iptal', 'reddedildi')
    and s.updated_at >= p_baslangic and s.updated_at < p_bitis
  order by s.updated_at desc
$$;

-- ---------------------------------------------------------------------------
-- Kanal / personel kırılımı: siparişi kim aldı
create or replace function public.rapor_personel(p_baslangic timestamptz, p_bitis timestamptz)
returns table (kanal text, siparis_sayisi bigint)
language sql stable security invoker set search_path = public as
$$
  select
    coalesce(ku.ad, case when s.masa_oturumu_id is not null then 'QR (müşteri)' else 'Bilinmiyor' end) as kanal,
    count(*) as siparis_sayisi
  from siparis s
  left join kullanici ku on ku.id = s.olusturan_id
  where s.created_at >= p_baslangic and s.created_at < p_bitis
    and s.durum not in ('iptal', 'reddedildi')
  group by 1
  order by 2 desc
$$;

-- Yalnız giriş yapmış personel çağırabilir
revoke execute on function public.rapor_ozet(timestamptz, timestamptz) from public;
revoke execute on function public.rapor_gunluk(timestamptz, timestamptz) from public;
revoke execute on function public.rapor_saatlik(timestamptz, timestamptz) from public;
revoke execute on function public.rapor_urun(timestamptz, timestamptz) from public;
revoke execute on function public.rapor_iptaller(timestamptz, timestamptz) from public;
revoke execute on function public.rapor_personel(timestamptz, timestamptz) from public;
grant execute on function public.rapor_ozet(timestamptz, timestamptz) to authenticated;
grant execute on function public.rapor_gunluk(timestamptz, timestamptz) to authenticated;
grant execute on function public.rapor_saatlik(timestamptz, timestamptz) to authenticated;
grant execute on function public.rapor_urun(timestamptz, timestamptz) to authenticated;
grant execute on function public.rapor_iptaller(timestamptz, timestamptz) to authenticated;
grant execute on function public.rapor_personel(timestamptz, timestamptz) to authenticated;
