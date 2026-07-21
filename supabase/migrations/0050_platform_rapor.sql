-- ============================================================================
-- 0050: Çok şubeli platform raporlama (Faz 6 M7)
--
-- Süper admin (tüm kafeler / seçili zincir) ve franchise (yalnız kendi zinciri)
-- için zengin rapor RPC'leri. Mevcut platform_rapor (0039) korunur; bunlar
-- /panel/rapor'un yeni sekmeli tasarımını (M8) besler.
--
-- Yetki: _platform_kapsam(p_zincir_id) — kapsamdaki cafe_id'leri döndürür;
-- yetkisizse EXCEPTION (0043 _zincir_yetki deseni). 0039'un sessiz-boş cross
-- join'i değil: kullanıcı "ciro sıfır mı, yetkim mi yok" ayrımını yapabilmeli.
--
-- Ciro tanımı rapor_ozet/platform_rapor ile BİREBİR aynı: adisyon_tutarlari
-- (durum='odendi', kapanis aralıkta). Bu view kullanımı bilinçli — tek kafede
-- rapor_ozet ile eşleşme garantisi için. Ölçek notu (plan K8): >500k adisyon
-- ya da >2sn'de ön-toplamaya geçilir; bugün indeksler (0049) yeterli.
--
-- Önceki dönem: aynı uzunlukta hemen önceki pencere [bas-(bit-bas), bas);
-- değişim yüzdesi istemcide hesaplanır.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Yetki + kapsam: kapsamdaki cafe_id'ler. Yetkisizse exception.
--   super_admin + zincir null → tüm kafeler
--   super_admin + zincir dolu → o zincirin kafeleri
--   franchise → kendi zinciri (başka zincir istenirse exception)
--   diğer → exception
-- ---------------------------------------------------------------------------
create function public._platform_kapsam(p_zincir_id uuid)
returns table (cafe_id uuid)
language plpgsql stable security definer set search_path = public as
$$
declare
  v_rol public.kullanici_rol := public.gercek_rol();
  v_zincir uuid;
begin
  if v_rol = 'super_admin' then
    return query
      select c.id from public.cafe c
      where p_zincir_id is null or c.zincir_id = p_zincir_id;
  elsif v_rol = 'franchise' then
    select zincir_id into v_zincir from public.kullanici
      where id = auth.uid() and aktif;
    if v_zincir is null then
      raise exception 'Hesabınız bir zincire bağlı değil';
    end if;
    if p_zincir_id is not null and p_zincir_id <> v_zincir then
      raise exception 'Bu zincir size bağlı değil';
    end if;
    return query
      select c.id from public.cafe c where c.zincir_id = v_zincir;
  else
    raise exception 'Bu işlem için zincir sahibi veya platform yöneticisi girişi gerekli';
  end if;
end
$$;

revoke execute on function public._platform_kapsam(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1) platform_ozet: kapsam geneli tek satır özet + önceki dönem cirosu
-- ---------------------------------------------------------------------------
create function public.platform_ozet(
  p_baslangic timestamptz, p_bitis timestamptz, p_zincir_id uuid default null
)
returns table (
  ciro numeric, nakit_ciro numeric, kart_ciro numeric,
  adisyon_sayisi bigint, siparis_sayisi bigint, ortalama_adisyon numeric,
  aktif_kafe_sayisi bigint, kafe_sayisi bigint, onceki_ciro numeric
)
language sql stable security definer set search_path = public as
$$
  with kapsam as (select cafe_id from public._platform_kapsam(p_zincir_id)),
  onceki as (select (p_baslangic - (p_bitis - p_baslangic)) as bas),
  kapanan as (
    select at.cafe_id, at.tutar, at.odeme_turu, at.kapanis
    from adisyon_tutarlari at
    join kapsam k on k.cafe_id = at.cafe_id
    where at.durum = 'odendi'
      and at.kapanis >= (select bas from onceki) and at.kapanis < p_bitis
  ),
  bu_donem as (
    select * from kapanan where kapanis >= p_baslangic and kapanis < p_bitis
  )
  select
    coalesce((select sum(tutar) from bu_donem), 0),
    coalesce((select sum(tutar) from bu_donem where odeme_turu = 'nakit'), 0),
    coalesce((select sum(tutar) from bu_donem where odeme_turu = 'kart'), 0),
    (select count(*) from bu_donem),
    coalesce((
      select count(*) from siparis sp
      join kapsam k on k.cafe_id = sp.cafe_id
      where sp.created_at >= p_baslangic and sp.created_at < p_bitis
        and sp.durum not in ('iptal', 'reddedildi')
    ), 0),
    coalesce((select round(avg(tutar), 2) from bu_donem), 0),
    (select count(distinct cafe_id) from bu_donem),
    (select count(*) from kapsam),
    coalesce((
      select sum(tutar) from kapanan
      where kapanis >= (select bas from onceki) and kapanis < p_baslangic
    ), 0)
$$;

grant execute on function public.platform_ozet(timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) platform_sube_karsilastirma: kafe başına ciro/adisyon/ort + önceki dönem
-- ---------------------------------------------------------------------------
create function public.platform_sube_karsilastirma(
  p_baslangic timestamptz, p_bitis timestamptz, p_zincir_id uuid default null
)
returns table (
  cafe_id uuid, cafe_ad text, zincir_ad text, cafe_aktif boolean,
  ciro numeric, adisyon_sayisi bigint, ortalama_adisyon numeric,
  siparis_sayisi bigint, onceki_ciro numeric
)
language sql stable security definer set search_path = public as
$$
  with kapsam as (select cafe_id from public._platform_kapsam(p_zincir_id)),
  onceki_bas as (select (p_baslangic - (p_bitis - p_baslangic)) as bas)
  select
    c.id, c.ad, z.ad, c.aktif,
    coalesce(t.ciro, 0), coalesce(t.adisyon_sayisi, 0),
    coalesce(round(t.ciro / nullif(t.adisyon_sayisi, 0), 2), 0),
    coalesce(sp.siparis_sayisi, 0),
    coalesce(t.onceki_ciro, 0)
  from cafe c
  join kapsam k on k.cafe_id = c.id
  left join zincir z on z.id = c.zincir_id
  left join lateral (
    select
      sum(at.tutar) filter (where at.kapanis >= p_baslangic and at.kapanis < p_bitis) as ciro,
      count(*) filter (where at.kapanis >= p_baslangic and at.kapanis < p_bitis) as adisyon_sayisi,
      sum(at.tutar) filter (where at.kapanis >= (select bas from onceki_bas) and at.kapanis < p_baslangic) as onceki_ciro
    from adisyon_tutarlari at
    where at.cafe_id = c.id and at.durum = 'odendi'
      and at.kapanis >= (select bas from onceki_bas) and at.kapanis < p_bitis
  ) t on true
  left join lateral (
    select count(*) as siparis_sayisi
    from siparis s
    where s.cafe_id = c.id
      and s.created_at >= p_baslangic and s.created_at < p_bitis
      and s.durum not in ('iptal', 'reddedildi')
  ) sp on true
  order by coalesce(t.ciro, 0) desc, c.ad
$$;

grant execute on function public.platform_sube_karsilastirma(timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) platform_gunluk: gün bazında toplam ciro (trend grafiği)
-- ---------------------------------------------------------------------------
create function public.platform_gunluk(
  p_baslangic timestamptz, p_bitis timestamptz, p_zincir_id uuid default null
)
returns table (gun date, ciro numeric, adisyon_sayisi bigint)
language sql stable security definer set search_path = public as
$$
  with kapsam as (select cafe_id from public._platform_kapsam(p_zincir_id))
  select
    (at.kapanis at time zone 'Europe/Istanbul')::date as gun,
    sum(at.tutar) as ciro,
    count(*) as adisyon_sayisi
  from adisyon_tutarlari at
  join kapsam k on k.cafe_id = at.cafe_id
  where at.durum = 'odendi'
    and at.kapanis >= p_baslangic and at.kapanis < p_bitis
  group by 1
  order by 1
$$;

grant execute on function public.platform_gunluk(timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) platform_saatlik: saat bazında sipariş yoğunluğu
-- ---------------------------------------------------------------------------
create function public.platform_saatlik(
  p_baslangic timestamptz, p_bitis timestamptz, p_zincir_id uuid default null
)
returns table (saat int, siparis_sayisi bigint)
language sql stable security definer set search_path = public as
$$
  with kapsam as (select cafe_id from public._platform_kapsam(p_zincir_id))
  select
    extract(hour from s.created_at at time zone 'Europe/Istanbul')::int as saat,
    count(*) as siparis_sayisi
  from siparis s
  join kapsam k on k.cafe_id = s.cafe_id
  where s.created_at >= p_baslangic and s.created_at < p_bitis
    and s.durum not in ('iptal', 'reddedildi')
  group by 1
  order by 1
$$;

grant execute on function public.platform_saatlik(timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) platform_urun: zincir geneli ürün satışları. Aynı ürün farklı şubelerde
-- kaynak_id ile birleşir (coalesce(kaynak_id, id) — 0043). Maliyet kalem
-- başına o kafenin reçetesinden (senkron reçeteyi de kopyalar); reçetesiz
-- ürün null. Marj "bugünkü maliyetle" (son_birim_fiyat anlık).
-- ---------------------------------------------------------------------------
create function public.platform_urun(
  p_baslangic timestamptz, p_bitis timestamptz, p_zincir_id uuid default null
)
returns table (urun_ad text, adet bigint, ciro numeric, maliyet numeric)
language sql stable security definer set search_path = public as
$$
  with kapsam as (select cafe_id from public._platform_kapsam(p_zincir_id)),
  kalemler as (
    select
      coalesce(u.kaynak_id, u.id) as urun_anahtar,
      k.urun_ad, k.adet, k.birim_fiyat, k.opsiyon_ek_fiyat, k.urun_id
    from siparis_kalemi k
    join kapsam ks on ks.cafe_id = k.cafe_id
    join siparis s on s.id = k.siparis_id
    join adisyon a on a.id = s.adisyon_id
    join urun u on u.id = k.urun_id
    where a.durum = 'odendi'
      and a.kapanis >= p_baslangic and a.kapanis < p_bitis
      and s.durum not in ('iptal', 'reddedildi')
      and not k.reddedildi and not k.ikram
  )
  select
    max(kl.urun_ad) as urun_ad,
    sum(kl.adet) as adet,
    coalesce(sum((kl.birim_fiyat + kl.opsiyon_ek_fiyat) * kl.adet), 0) as ciro,
    case when count(rm.birim_maliyet) = 0 then null
         else round(sum(kl.adet * coalesce(rm.birim_maliyet, 0)), 2) end as maliyet
  from kalemler kl
  left join lateral (
    select sum(r.miktar * h.son_birim_fiyat) as birim_maliyet
    from recete r join hammadde h on h.id = r.hammadde_id
    where r.urun_id = kl.urun_id and h.son_birim_fiyat is not null
  ) rm on true
  group by kl.urun_anahtar
  order by ciro desc
$$;

grant execute on function public.platform_urun(timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) platform_urun_sube: ürün × şube kırılımı (hangi şube neyi satıyor —
-- drill-down). urun_anahtar zincir geneli eşleşme için de döner.
-- ---------------------------------------------------------------------------
create function public.platform_urun_sube(
  p_baslangic timestamptz, p_bitis timestamptz, p_zincir_id uuid default null
)
returns table (cafe_id uuid, cafe_ad text, urun_ad text, adet bigint, ciro numeric)
language sql stable security definer set search_path = public as
$$
  with kapsam as (select cafe_id from public._platform_kapsam(p_zincir_id))
  select
    c.id, c.ad, k.urun_ad,
    sum(k.adet) as adet,
    coalesce(sum((k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet), 0) as ciro
  from siparis_kalemi k
  join kapsam ks on ks.cafe_id = k.cafe_id
  join cafe c on c.id = k.cafe_id
  join siparis s on s.id = k.siparis_id
  join adisyon a on a.id = s.adisyon_id
  where a.durum = 'odendi'
    and a.kapanis >= p_baslangic and a.kapanis < p_bitis
    and s.durum not in ('iptal', 'reddedildi')
    and not k.reddedildi and not k.ikram
  group by c.id, c.ad, k.urun_ad
  order by ciro desc
$$;

grant execute on function public.platform_urun_sube(timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) platform_sadakat: dönemsel sadakat özeti (kapsam geneli). Metrikler
-- puan_hareketi.cafe_id üzerinden (hangi kafede kazanıldı/harcandı) — kapsamla
-- birebir uyumlu; zincir/bağımsız hesap ayrımı gerektirmez.
-- ---------------------------------------------------------------------------
create function public.platform_sadakat(
  p_baslangic timestamptz, p_bitis timestamptz, p_zincir_id uuid default null
)
returns table (
  kazanilan_puan bigint, harcanan_puan bigint,
  kazanim_sayisi bigint, harcama_sayisi bigint, aktif_uye bigint
)
language sql stable security definer set search_path = public as
$$
  with kapsam as (select cafe_id from public._platform_kapsam(p_zincir_id)),
  h as (
    select ph.tur, ph.puan, ph.sadakat_hesabi_id
    from puan_hareketi ph
    join kapsam k on k.cafe_id = ph.cafe_id
    where ph.created_at >= p_baslangic and ph.created_at < p_bitis
  )
  select
    coalesce(sum(puan) filter (where tur = 'kazanim'), 0),
    coalesce(sum(puan) filter (where tur = 'harcama'), 0),
    count(*) filter (where tur = 'kazanim'),
    count(*) filter (where tur = 'harcama'),
    count(distinct sadakat_hesabi_id)
  from h
$$;

grant execute on function public.platform_sadakat(timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) platform_sadakat_sube: kafe başına sadakat kırılımı
-- ---------------------------------------------------------------------------
create function public.platform_sadakat_sube(
  p_baslangic timestamptz, p_bitis timestamptz, p_zincir_id uuid default null
)
returns table (
  cafe_id uuid, cafe_ad text,
  kazanilan_puan bigint, harcanan_puan bigint, aktif_uye bigint
)
language sql stable security definer set search_path = public as
$$
  with kapsam as (select cafe_id from public._platform_kapsam(p_zincir_id))
  select
    c.id, c.ad,
    coalesce(sum(ph.puan) filter (where ph.tur = 'kazanim'), 0),
    coalesce(sum(ph.puan) filter (where ph.tur = 'harcama'), 0),
    count(distinct ph.sadakat_hesabi_id)
  from cafe c
  join kapsam k on k.cafe_id = c.id
  join puan_hareketi ph on ph.cafe_id = c.id
    and ph.created_at >= p_baslangic and ph.created_at < p_bitis
  group by c.id, c.ad
  order by 3 desc
$$;

grant execute on function public.platform_sadakat_sube(timestamptz, timestamptz, uuid) to authenticated;
