-- ============================================================================
-- 0057 — Ödemesiz sipariş akışı (Faz 7 M2)
--
-- Kilitli karar: kasadan ödeme TAMAMEN kalkıyor; online ödeme sonraki fazda.
-- O gelene dek sistem "sipariş yönetimi" olarak çalışır: müşteri siparişi
-- doğrudan mutfağa düşer (ödeme kapısı yok), adisyon TESLİMDE otomatik
-- kapanır (odeme_turu='harici' — tahsilat sistem dışında).
--
-- Bu migration eski web/app sürümleriyle GERİYE UYUMLUDUR:
--  - musteri_siparis_olustur imzası aynı (gövde değişti)
--  - masa_duzeni=false flip'i eski app'i otomatik self-servis yoluna düşürür
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Masasız ⇒ önce-ödeme kısıtı kalkar (odeme_modu artık akışı yönetmiyor;
--    kolonun kendisi 0060 final temizliğinde düşecek)
-- ---------------------------------------------------------------------------
alter table public.cafe drop constraint if exists cafe_masasiz_once_odeme;

-- ---------------------------------------------------------------------------
-- 2) Tüm kafeler self-servis (masa kavramı emekli — teslim sipariş numarasıyla).
--    Default da değişir: panel'den açılacak YENİ kafeler de self-servis doğar.
-- ---------------------------------------------------------------------------
update public.cafe set masa_duzeni = false where masa_duzeni;
alter table public.cafe alter column masa_duzeni set default false;

-- ---------------------------------------------------------------------------
-- 3) musteri_siparis_olustur v2: ödeme kapısı yok — sipariş her zaman
--    'bekliyor' ile doğar (masa_duzeni ve odeme_modu dallanmaları söküldü).
--    Gövdenin kalanı 0041 ile birebir (rate limit, sunucuda opsiyon fiyatı).
-- ---------------------------------------------------------------------------
create or replace function public.musteri_siparis_olustur(
  p_cafe_id uuid,
  p_kalemler jsonb,
  p_musteri_notu text default null
) returns uuid
language plpgsql security definer set search_path = public as
$$
declare
  v_cafe public.cafe%rowtype;
  v_adisyon_id uuid;
  v_siparis_id uuid;
  v_kalem jsonb;
  v_urun public.urun%rowtype;
  v_ek_fiyat numeric(10,2);
  v_opsiyonlar jsonb;
  v_son_dakika int;
  v_adet int;
  v_musteri_id uuid;
begin
  select id into v_musteri_id from public.kullanici
    where id = auth.uid() and rol = 'musteri' and aktif;
  if v_musteri_id is null then
    raise exception 'Sipariş için uygulamadan giriş yapmalısınız';
  end if;

  select * into v_cafe from public.cafe where id = p_cafe_id and aktif;
  if not found then
    raise exception 'Kafe aktif değil';
  end if;

  if p_kalemler is null or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'Sipariş boş olamaz';
  end if;

  select count(*) into v_son_dakika from public.siparis
    where musteri_id = v_musteri_id and created_at > now() - interval '60 seconds';
  if v_son_dakika >= 3 then
    raise exception 'Çok sık sipariş; lütfen biraz bekleyin';
  end if;

  -- her sipariş kendi adisyonunu açar (teslimde otomatik kapanır)
  insert into public.adisyon (cafe_id) values (v_cafe.id)
  returning id into v_adisyon_id;

  insert into public.siparis
    (cafe_id, adisyon_id, durum, musteri_notu, musteri_id, siparis_no)
  values (
    v_cafe.id, v_adisyon_id,
    'bekliyor'::public.siparis_durum,  -- ödeme kapısı yok: doğrudan mutfağa
    p_musteri_notu,
    v_musteri_id,
    public.siparis_no_al(v_cafe.id)
  ) returning id into v_siparis_id;

  for v_kalem in select * from jsonb_array_elements(p_kalemler) loop
    select * into v_urun from public.urun
      where id = (v_kalem->>'urun_id')::uuid and cafe_id = v_cafe.id and aktif;
    if not found then
      raise exception 'Ürün bulunamadı veya pasif: %', v_kalem->>'urun_id';
    end if;

    v_adet := greatest(coalesce((v_kalem->>'adet')::int, 1), 1);
    if v_urun.stok_takip and coalesce(v_urun.stok_adet, 0) < v_adet then
      raise exception '"%" tükenmek üzere; kalan adet: %', v_urun.ad, coalesce(v_urun.stok_adet, 0);
    end if;

    -- Ek fiyat ve seçim listesi SUNUCUDA opsiyon tablosundan kurulur (fiyat güvenliği)
    select
      coalesce(sum(o.ek_fiyat), 0),
      coalesce(jsonb_agg(jsonb_build_object('grup', g.ad, 'secim', o.ad, 'ek_fiyat', o.ek_fiyat)), '[]'::jsonb)
    into v_ek_fiyat, v_opsiyonlar
    from jsonb_array_elements(coalesce(v_kalem->'opsiyonlar', '[]'::jsonb)) sec
    join public.opsiyon o on o.ad = (sec->>'secim') and o.aktif
    join public.opsiyon_grubu g on g.id = o.opsiyon_grubu_id
      and g.ad = (sec->>'grup') and g.urun_id = v_urun.id;

    insert into public.siparis_kalemi
      (cafe_id, siparis_id, urun_id, urun_ad, birim_fiyat, adet, secilen_opsiyonlar, opsiyon_ek_fiyat, kalem_notu)
    values (
      v_cafe.id, v_siparis_id, v_urun.id, v_urun.ad, v_urun.fiyat, v_adet,
      v_opsiyonlar, v_ek_fiyat,
      nullif(trim(coalesce(v_kalem->>'not', '')), '')
    );
  end loop;

  return v_siparis_id;
end
$$;

-- ---------------------------------------------------------------------------
-- 4) Teslimde adisyon kapanışı: siparişin adisyonunda başka açık sipariş
--    kalmadıysa adisyon 'odendi' + odeme_turu='harici' olur. DEFINER —
--    çağıranın RLS'inden bağımsız çalışır (KDS, janitor, RPC hepsi tetikler).
--    0055'teki bakim_temizlik'in 24s hazir→teslim güvenlik ağı da bu yoldan
--    geçer, ayrı kural gerekmez.
-- ---------------------------------------------------------------------------
create or replace function public.adisyon_teslimde_kapat() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if new.adisyon_id is not null then
    update public.adisyon a
       set durum = 'odendi', odeme_turu = 'harici', kapanis = now()
     where a.id = new.adisyon_id
       and a.durum = 'acik'
       and not exists (
         select 1 from public.siparis s
          where s.adisyon_id = a.id
            and s.id <> new.id
            and s.durum not in ('teslim', 'iptal', 'reddedildi'));
  end if;
  return null;
end
$$;

drop trigger if exists siparis_teslim_adisyon_kapat on public.siparis;
create trigger siparis_teslim_adisyon_kapat
  after update of durum on public.siparis
  for each row
  when (new.durum = 'teslim'::public.siparis_durum
        and old.durum is distinct from new.durum)
  execute function public.adisyon_teslimde_kapat();

-- ---------------------------------------------------------------------------
-- 5) Bir defalık geçiş temizliği:
--    a) Ödeme onayı bekleyen siparişler mutfağa düşer (kapı artık yok)
--    b) Tüm siparişleri bitmiş ama açık kalmış adisyonlar kapanır
--       (kasa ekranı M3'te silinince bunları kapatacak kimse kalmayacak)
-- ---------------------------------------------------------------------------
update public.siparis set durum = 'bekliyor' where durum = 'odeme_bekliyor';

update public.adisyon a
   set durum = 'odendi', odeme_turu = 'harici', kapanis = now()
 where a.durum = 'acik'
   and exists (select 1 from public.siparis s
                where s.adisyon_id = a.id and s.durum = 'teslim')
   and not exists (select 1 from public.siparis s
                    where s.adisyon_id = a.id
                      and s.durum not in ('teslim', 'iptal', 'reddedildi'));

update public.adisyon a
   set durum = 'iptal', kapanis = now()
 where a.durum = 'acik'
   and not exists (select 1 from public.siparis s
                    where s.adisyon_id = a.id
                      and s.durum not in ('iptal', 'reddedildi'));

-- ---------------------------------------------------------------------------
-- 6) bakim_temizlik v3: odeme_bekliyor kuralı gider (değer artık üretilmiyor);
--    yerine 24 saatten eski bekliyor/hazirlaniyor → iptal gelir (KDS kapalı
--    kalırsa yetim sipariş birikmesin; iptal, stok/reçete iade trigger'larını
--    da tetikler). hazir→teslim ağı yeni trigger'la adisyonu da kapatır.
-- ---------------------------------------------------------------------------
create or replace function public.bakim_temizlik() returns void
language plpgsql security definer set search_path = public as
$$
begin
  update public.siparis set durum = 'iptal'
    where durum in ('bekliyor', 'hazirlaniyor')
      and created_at < now() - interval '24 hours';
  update public.siparis set durum = 'teslim'
    where durum = 'hazir' and updated_at < now() - interval '24 hours';
  delete from public.masa_oturumu where bitis < now() - interval '2 days';
  delete from public.garson_cagri where not acik and created_at < now() - interval '2 days';
  delete from public.yazdirma_kuyrugu where durum = 'basildi' and created_at < now() - interval '7 days';
  delete from public.basilan_fis where basildi_at < now() - interval '7 days';
  delete from public.hata_log where created_at < now() - interval '30 days';
end
$$;
