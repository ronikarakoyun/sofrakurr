-- ============================================================================
-- 0048: Güvenlik yaması (Faz 6 M0) — tam sistem taramasının bulguları
--
--   G1 (KRİTİK) admin_personel policy'si kolon kısıtlamıyordu: kafe admini
--       kendi kullanici satırına rol='super_admin' yazıp tüm platformu ele
--       geçirebilirdi.
--   G2 (YÜKSEK) admin, cafe.zincir_id'yi değiştirerek başka zincirin sadakat
--       hesaplarını (müşteri + puan) okuyabilirdi.
--   G3 (ORTA)   siparis_kalemi fiyat kolonları kafe içinde doğrudan UPDATE /
--       INSERT / DELETE'e açıktı (RPC'ler korumalıydı ama tabloya doğrudan
--       yazma serbestti — mutfak dahil).
--   G4 (ORTA)   _rapor_* iç fonksiyonları rol denetimsiz çağrılabiliyordu
--       (0027 gerekli diye geri açmıştı; mutfak kendi kafesinin cirosunu
--       okuyabiliyordu).
--   G5 (DÜŞÜK)  kampanya_admin with check'i zincir_id'yi kısıtlamıyordu.
--   G6 (DÜŞÜK)  masa_oturumu_ac hız sınırsızdı (anon spam / tablo şişmesi).
--
-- KİLİT DESENİ: PostgREST'ten doğrudan tablo yazması oturum rolü
-- authenticated/anon ile çalışır; security definer RPC'lerin İÇİ ise fonksiyon
-- sahibi (postgres) olarak çalışır, sunucu API'si de service_role kullanır.
-- Bekçi trigger'ları yalnız authenticated/anon'dan gelen doğrudan yazmayı
-- keser — tüm RPC, trigger ve servis yolları etkilenmez. Bekçiler bilerek
-- SECURITY INVOKER'dır (definer olsalar current_user hep 'postgres' görünür
-- ve kilit boşa düşerdi).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- G1: kullanici kolon bekçisi — rol/kafe/zincir ataması istemciden değişemez
-- Meşru yollar: /api/personel + /api/platform (service_role), musteri_kayit /
-- kafe_sec_panel / kafe_olustur RPC'leri (definer → postgres). İstemciden
-- serbest kalanlar: ad, aktif, yetkiler (personel sayfası bunları yazıyor).
-- ---------------------------------------------------------------------------
create function public.kullanici_kolon_bekcisi() returns trigger
language plpgsql set search_path = public as
$$
begin
  if current_user not in ('authenticated', 'anon') then
    return new; -- RPC (postgres) ve sunucu API'si (service_role) serbest
  end if;
  if tg_op = 'INSERT' then
    -- personel açma zaten service_role API'sinden geçer; doğrudan istemci
    -- INSERT'iyle yönetici rolü yaratılamaz
    if new.rol in ('super_admin', 'franchise', 'admin') then
      raise exception 'Yönetici hesapları yalnız platform yönetiminden açılabilir';
    end if;
    return new;
  end if;
  if new.rol is distinct from old.rol
     or new.cafe_id is distinct from old.cafe_id
     or new.zincir_id is distinct from old.zincir_id
     or new.secili_cafe_id is distinct from old.secili_cafe_id then
    raise exception 'Rol ve kafe/zincir ataması buradan değiştirilemez';
  end if;
  return new;
end
$$;

create trigger kullanici_kolon_bekcisi
before insert or update on public.kullanici
for each row execute function public.kullanici_kolon_bekcisi();

-- ---------------------------------------------------------------------------
-- G2: cafe kolon bekçisi — zincir üyeliği yalnız platformdan atanır
-- (kafe_zincire_ata RPC'si ve /api/platform yolu etkilenmez; admin Ayarlar
-- sayfası ad/odeme_modu/masa_duzeni vb. alanları yazmayı sürdürür)
-- ---------------------------------------------------------------------------
create function public.cafe_kolon_bekcisi() returns trigger
language plpgsql set search_path = public as
$$
begin
  if current_user in ('authenticated', 'anon')
     and new.zincir_id is distinct from old.zincir_id then
    raise exception 'Zincir üyeliği buradan değiştirilemez';
  end if;
  return new;
end
$$;

create trigger cafe_kolon_bekcisi
before update on public.cafe
for each row execute function public.cafe_kolon_bekcisi();

-- ---------------------------------------------------------------------------
-- G3: siparis_kalemi bekçisi — mevcut bir kalemin FİYAT/ÜRÜN alanları
-- istemciden UPDATE ile değiştirilemez (birim_fiyat=0 hilesi kapanır).
--
-- KAPSAM BİLİNÇLİ DAR: yalnız UPDATE, yalnız fiyat/ürün kolonları.
--  • Serbest kalan meşru UPDATE'ler: hazir (KDS), reddedildi + red_nedeni
--    (mutfak/kasa reddi), siparis_id (kalem_tasi — masa/adisyon taşıma);
--    ikram yalnız kasa/admin.
--  • cafe_id zaten personel_kalem RLS with_check'iyle kiracıya kilitli.
--  • INSERT bilerek KAPSAM DIŞI: personel_siparis_olustur bugün INVOKER olup
--    kalemi authenticated olarak ekliyor ve birim_fiyat'ı sunucudaki
--    urun.fiyat'tan alıyor. Doğrudan istemci INSERT'iyle 0-fiyat kalem ekleme
--    açığı, personel_siparis_olustur DEFINER'a çevrilip INSERT revoke edilerek
--    AYRI ve tam regresyon testli bir adımda kapatılacak (bkz. ROADMAP M0-b).
-- ---------------------------------------------------------------------------
create function public.kalem_kolon_bekcisi() returns trigger
language plpgsql set search_path = public as
$$
begin
  if current_user not in ('authenticated', 'anon') then
    return new; -- RPC (postgres) / servis (service_role) serbest
  end if;
  if new.birim_fiyat        is distinct from old.birim_fiyat
     or new.opsiyon_ek_fiyat is distinct from old.opsiyon_ek_fiyat
     or new.adet             is distinct from old.adet
     or new.urun_id          is distinct from old.urun_id
     or new.urun_ad          is distinct from old.urun_ad
     or new.secilen_opsiyonlar is distinct from old.secilen_opsiyonlar then
    raise exception 'Kalem fiyat/ürün alanları buradan değiştirilemez';
  end if;
  if new.ikram is distinct from old.ikram
     and public.aktif_rol() not in ('admin', 'kasa') then
    raise exception 'İkram yalnız kasa/admin tarafından işaretlenebilir';
  end if;
  return new;
end
$$;

create trigger kalem_kolon_bekcisi
before update on public.siparis_kalemi
for each row execute function public.kalem_kolon_bekcisi();

-- ---------------------------------------------------------------------------
-- G4: rapor rol denetimini İÇ _rapor_* fonksiyonlarının gövdesine taşı.
-- 0026 iç fonksiyonların execute'ını authenticated'dan aldı; invoker
-- sarmalayıcılar çağıramayınca 0027 geri açtı → o günden beri mutfak/garson
-- _rapor_ozet'i DOĞRUDAN çağırıp kafenin cirosunu okuyabiliyordu (rapor_yetki
-- yalnız sarmalayıcıdaydı).
--
-- Çözüm (Supabase-uyumlu, yeni rol/owner gerektirmez): iç fonksiyonlar SQL'den
-- plpgsql'e çevrilir, gövdeye `perform public.rapor_yetki()` eklenir. Böylece
-- doğrudan çağrı da rol denetler; SECURITY INVOKER korunduğu için RLS kiracı
-- yalıtımı aynen sürer. Gövde mantığı birebir aynı — yalnız guard + return
-- query sarmalaması eklendi. authenticated grant'ı (0027) olduğu gibi kalır.
-- ---------------------------------------------------------------------------
create or replace function public._rapor_ozet(p_baslangic timestamptz, p_bitis timestamptz)
returns table (ciro numeric, nakit_ciro numeric, kart_ciro numeric, adisyon_sayisi bigint,
  siparis_sayisi bigint, ortalama_adisyon numeric, iptal_sayisi bigint, iptal_tutar numeric,
  ikram_tutar numeric, iskonto_tutar numeric, cariye_yazilan numeric, cari_tahsilat numeric)
language plpgsql stable set search_path = public as
$$
-- RETURNS TABLE OUT adları (ciro, iskonto_tutar, ...) plpgsql'de değişken
-- sayılır; sorgu kolonlarıyla çakışmasın diye kolon adı önceliklenir.
#variable_conflict use_column
begin
  perform public.rapor_yetki();
  return query
  with kapanan as (
    select tutar, iskonto_tutar, ikram_tutar, cari_id, odeme_turu from adisyon_tutarlari
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
    coalesce((select sum(t.tutar) from kapanan t), 0),
    coalesce((select sum(t.tutar) from kapanan t where t.odeme_turu = 'nakit'), 0),
    coalesce((select sum(t.tutar) from kapanan t where t.odeme_turu = 'kart'), 0),
    (select count(*) from kapanan),
    (select count(*) from gecerli_siparis),
    coalesce((select round(avg(t.tutar), 2) from kapanan t), 0),
    (select count(*) from iptaller),
    coalesce((select sum(i.tutar) from iptaller i), 0),
    coalesce((select sum(t.ikram_tutar) from kapanan t), 0),
    coalesce((select sum(t.iskonto_tutar) from kapanan t), 0),
    coalesce((select sum(t.tutar) from kapanan t where t.cari_id is not null), 0),
    coalesce((
      select -sum(h.tutar) from cari_hareket h
      where h.tutar < 0 and h.created_at >= p_baslangic and h.created_at < p_bitis
    ), 0);
end
$$;

create or replace function public._rapor_gunluk(p_baslangic timestamptz, p_bitis timestamptz)
returns table (gun date, ciro numeric, adisyon_sayisi bigint)
language plpgsql stable set search_path = public as
$$
-- RETURNS TABLE OUT adları (ciro, iskonto_tutar, ...) plpgsql'de değişken
-- sayılır; sorgu kolonlarıyla çakışmasın diye kolon adı önceliklenir.
#variable_conflict use_column
begin
  perform public.rapor_yetki();
  return query
  select
    (kapanis at time zone 'Europe/Istanbul')::date as gun,
    sum(tutar) as ciro,
    count(*) as adisyon_sayisi
  from adisyon_tutarlari
  where durum = 'odendi' and kapanis >= p_baslangic and kapanis < p_bitis
  group by 1
  order by 1;
end
$$;

create or replace function public._rapor_saatlik(p_baslangic timestamptz, p_bitis timestamptz)
returns table (saat int, siparis_sayisi bigint)
language plpgsql stable set search_path = public as
$$
-- RETURNS TABLE OUT adları (ciro, iskonto_tutar, ...) plpgsql'de değişken
-- sayılır; sorgu kolonlarıyla çakışmasın diye kolon adı önceliklenir.
#variable_conflict use_column
begin
  perform public.rapor_yetki();
  return query
  select
    extract(hour from created_at at time zone 'Europe/Istanbul')::int as saat,
    count(*) as siparis_sayisi
  from siparis
  where created_at >= p_baslangic and created_at < p_bitis
    and durum not in ('iptal', 'reddedildi')
  group by 1
  order by 1;
end
$$;

create or replace function public._rapor_urun(p_baslangic timestamptz, p_bitis timestamptz)
returns table (urun_ad text, adet bigint, ciro numeric, maliyet numeric, ikram_adet bigint)
language plpgsql stable set search_path = public as
$$
-- RETURNS TABLE OUT adları (ciro, iskonto_tutar, ...) plpgsql'de değişken
-- sayılır; sorgu kolonlarıyla çakışmasın diye kolon adı önceliklenir.
#variable_conflict use_column
begin
  perform public.rapor_yetki();
  return query
  select
    k.urun_ad,
    sum(k.adet) filter (where not k.ikram) as adet,
    coalesce(sum((k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet) filter (where not k.ikram), 0) as ciro,
    case
      when max(rm.birim_maliyet) is null then null
      else round(sum(k.adet * coalesce(rm.birim_maliyet, 0)), 2)
    end as maliyet,
    coalesce(sum(k.adet) filter (where k.ikram), 0) as ikram_adet
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
  order by ciro desc;
end
$$;

create or replace function public._rapor_iptaller(p_baslangic timestamptz, p_bitis timestamptz)
returns table (zaman timestamptz, masa_ad text, durum public.siparis_durum, tutar numeric, kalemler text)
language plpgsql stable set search_path = public as
$$
-- RETURNS TABLE OUT adları (ciro, iskonto_tutar, ...) plpgsql'de değişken
-- sayılır; sorgu kolonlarıyla çakışmasın diye kolon adı önceliklenir.
#variable_conflict use_column
begin
  perform public.rapor_yetki();
  return query
  select
    s.updated_at,
    coalesce('#' || s.siparis_no::text, m.ad, 'Sipariş'),
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
  left join masa m on m.id = s.masa_id
  where s.durum in ('iptal', 'reddedildi')
    and s.updated_at >= p_baslangic and s.updated_at < p_bitis
  order by s.updated_at desc;
end
$$;

create or replace function public._rapor_personel(p_baslangic timestamptz, p_bitis timestamptz)
returns table (kanal text, siparis_sayisi bigint)
language plpgsql stable set search_path = public as
$$
-- RETURNS TABLE OUT adları (ciro, iskonto_tutar, ...) plpgsql'de değişken
-- sayılır; sorgu kolonlarıyla çakışmasın diye kolon adı önceliklenir.
#variable_conflict use_column
begin
  perform public.rapor_yetki();
  return query
  select
    coalesce(ku.ad, case when s.masa_oturumu_id is not null then 'QR (müşteri)' else 'Bilinmiyor' end) as kanal,
    count(*) as siparis_sayisi
  from siparis s
  left join kullanici ku on ku.id = s.olusturan_id
  where s.created_at >= p_baslangic and s.created_at < p_bitis
    and s.durum not in ('iptal', 'reddedildi')
  group by 1
  order by 2 desc;
end
$$;

-- ---------------------------------------------------------------------------
-- G7 (canlı bug, denetimin 3. bulgusu): rapor_urun SARMALAYICISI 0026'da 4
-- kolon bildiriyordu ama iç fonksiyon 5 kolon (ikram_adet, 0009 sonrası)
-- döndürüyor → "structure of query does not match" ile Yönetim→Raporlar'daki
-- ürün/kâr tablosu sessizce boş geliyordu. Sarmalayıcı 5 kolona çıkarılır.
-- (Faz 6 M6'nın bu parçası burada erken kapanır; imza artık iç fonksiyonla
-- birebir.)
-- ---------------------------------------------------------------------------
-- OUT kolonu eklendiği için REPLACE yetmez; imza değişiyor → DROP + CREATE.
drop function if exists public.rapor_urun(timestamptz, timestamptz);
create function public.rapor_urun(p_baslangic timestamptz, p_bitis timestamptz)
returns table (urun_ad text, adet bigint, ciro numeric, maliyet numeric, ikram_adet bigint)
language plpgsql stable security invoker set search_path = public as
$$ begin perform public.rapor_yetki();
   return query select * from public._rapor_urun(p_baslangic, p_bitis); end $$;
grant execute on function public.rapor_urun(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- G5: kampanya_admin — kafe admini zincir kampanyası kurgulayamaz
-- (zincir kampanyası yalnız kampanya_zincir policy'sinden, franchise ile)
-- ---------------------------------------------------------------------------
drop policy kampanya_admin on public.kampanya;
create policy kampanya_admin on public.kampanya
  for all using (cafe_id = public.aktif_cafe_id()
                 and public.rol_var(array['admin']::public.kullanici_rol[]))
  with check (cafe_id = public.aktif_cafe_id()
              and public.rol_var(array['admin']::public.kullanici_rol[])
              and zincir_id is null);

-- ---------------------------------------------------------------------------
-- G6: masa_oturumu_ac hız sınırı — 0006 gövdesi + masa başına dakikada 10
-- oturum tavanı. Meşru müşteri asla takılmaz (QR okutup menü açmak tek
-- oturumdur); uzaktan spam ve tablo şişmesi kesilir.
-- ---------------------------------------------------------------------------
create or replace function public.masa_oturumu_ac(p_qr_kod text)
returns table (oturum_token text, cafe_id uuid, cafe_ad text, masa_id uuid, masa_ad text)
language plpgsql security definer set search_path = public as
$$
declare
  v_masa public.masa%rowtype;
  v_cafe public.cafe%rowtype;
  v_token text;
begin
  select * into v_masa from public.masa where qr_kod = p_qr_kod and aktif;
  if not found then
    raise exception 'Geçersiz QR kodu';
  end if;
  select * into v_cafe from public.cafe where id = v_masa.cafe_id and aktif;
  if not found then
    raise exception 'Kafe aktif değil';
  end if;

  -- hız sınırı: aynı masaya son 60 saniyede en çok 10 oturum
  if (select count(*) from public.masa_oturumu m
      where m.masa_id = v_masa.id
        and m.created_at > now() - interval '60 seconds') >= 10 then
    raise exception 'Çok sık deneme yapıldı; lütfen biraz sonra tekrar deneyin';
  end if;

  insert into public.masa_oturumu (cafe_id, masa_id)
  values (v_masa.cafe_id, v_masa.id)
  returning token into v_token;

  return query select v_token, v_cafe.id, v_cafe.ad, v_masa.id, v_masa.ad;
end
$$;
