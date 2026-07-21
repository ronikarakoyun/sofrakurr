-- Canlı öncesi güvenlik/bütünlük düzeltmeleri:
--   K1: Opsiyon ek fiyatı istemciden değil sunucuda (opsiyon tablosundan) hesaplanır.
--   K2: Sipariş durum geçişleri DB'de zorlanır — iptal/teslim/reddedilmiş sipariş
--       "diriltilemez" (bayat kasa ekranından yanlış Ödendi bunu tetikliyordu).
--   K3: Bir adisyonun son geçerli siparişi iptal olursa adisyon otomatik kapanır
--       (masa süresiz "dolu" kalmaz).
--   + adisyon_kapat: kasa/panel kapanışı için guard'lı tek RPC (yalnız 'acik' kapatır).

-- ---------------------------------------------------------------------------
-- K2) Durum geçiş bekçisi: terminal durumdan çıkış yasak
-- ---------------------------------------------------------------------------
create or replace function public.siparis_durum_bekcisi() returns trigger
language plpgsql set search_path = public as
$$
begin
  if old.durum in ('teslim', 'iptal', 'reddedildi') and new.durum <> old.durum then
    raise exception 'Sipariş "%" durumundan çıkarılamaz (geçersiz geçiş: % → %)',
      old.durum, old.durum, new.durum;
  end if;
  return new;
end
$$;

drop trigger if exists siparis_durum_bekcisi on public.siparis;
create trigger siparis_durum_bekcisi
  before update of durum on public.siparis
  for each row execute function public.siparis_durum_bekcisi();

-- ---------------------------------------------------------------------------
-- K3) Boş kalan adisyon otomatik iptal
-- ---------------------------------------------------------------------------
create or replace function public.bos_adisyon_iptal() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if new.durum in ('iptal', 'reddedildi') and old.durum not in ('iptal', 'reddedildi') then
    if not exists (
      select 1 from public.siparis
      where adisyon_id = new.adisyon_id
        and durum not in ('iptal', 'reddedildi')
    ) then
      -- açık hesabı geçerli siparişi kalmayan adisyonu kapat (0015 trigger'ı
      -- masa oturumunu da sıfırlar)
      update public.adisyon set durum = 'iptal'
        where id = new.adisyon_id and durum = 'acik';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists siparis_bos_adisyon_iptal on public.siparis;
create trigger siparis_bos_adisyon_iptal
  after update of durum on public.siparis
  for each row execute function public.bos_adisyon_iptal();

-- ---------------------------------------------------------------------------
-- Guard'lı adisyon kapatma (kasa "Ödendi" + panel "Hesabı Kapat")
-- Yalnız 'acik' adisyonu kapatır; çift kapanış / bayat ekran ezmesini önler.
-- ---------------------------------------------------------------------------
create or replace function public.adisyon_kapat(
  p_adisyon_id uuid,
  p_odeme_turu public.odeme_turu_tip
) returns boolean
language plpgsql security invoker set search_path = public as
$$
declare
  v_etki int;
begin
  update public.adisyon
    set durum = 'odendi', kapanis = now(), odeme_turu = p_odeme_turu
    where id = p_adisyon_id and durum = 'acik';
  get diagnostics v_etki = row_count;
  if v_etki = 0 then
    return false; -- zaten kapalı ya da başkası kapatmış
  end if;
  -- bekleyen ödeme onaylı siparişler mutfağa geçsin (henüz düşmediyse)
  update public.siparis set durum = 'bekliyor'
    where adisyon_id = p_adisyon_id and durum = 'odeme_bekliyor';
  return true;
end
$$;

revoke execute on function public.adisyon_kapat(uuid, public.odeme_turu_tip) from public;
grant execute on function public.adisyon_kapat(uuid, public.odeme_turu_tip) to authenticated;

-- ---------------------------------------------------------------------------
-- K1) Opsiyon fiyatını sunucuda doğrula: siparis_olustur
-- ek_fiyat ve secilen_opsiyonlar istemciden DEĞİL, opsiyon tablosundan kurulur.
-- İstemci yalnız hangi grubun hangi seçimini istediğini bildirir.
-- ---------------------------------------------------------------------------
create or replace function public.siparis_olustur(
  p_token text,
  p_kalemler jsonb,
  p_musteri_notu text default null
) returns uuid
language plpgsql security definer set search_path = public as
$$
declare
  v_oturum public.masa_oturumu%rowtype;
  v_cafe public.cafe%rowtype;
  v_adisyon_id uuid;
  v_siparis_id uuid;
  v_kalem jsonb;
  v_urun public.urun%rowtype;
  v_ek_fiyat numeric(10,2);
  v_opsiyonlar jsonb;
  v_son_dakika int;
  v_adet int;
begin
  select * into v_oturum from public.masa_oturumu
    where token = p_token and bitis > now();
  if not found then
    raise exception 'Oturum geçersiz veya süresi dolmuş; QR kodu yeniden okutun';
  end if;

  select * into v_cafe from public.cafe where id = v_oturum.cafe_id and aktif;
  if not found then
    raise exception 'Kafe aktif değil';
  end if;

  if p_kalemler is null or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'Sipariş boş olamaz';
  end if;

  select count(*) into v_son_dakika from public.siparis
    where masa_id = v_oturum.masa_id and created_at > now() - interval '60 seconds';
  if v_son_dakika >= 3 then
    raise exception 'Çok sık sipariş; lütfen biraz bekleyin';
  end if;

  select id into v_adisyon_id from public.adisyon
    where masa_id = v_oturum.masa_id and durum = 'acik'
    order by acilis desc limit 1;
  if v_adisyon_id is null then
    insert into public.adisyon (cafe_id, masa_id)
    values (v_oturum.cafe_id, v_oturum.masa_id)
    returning id into v_adisyon_id;
  end if;

  insert into public.siparis (cafe_id, adisyon_id, masa_id, masa_oturumu_id, durum, musteri_notu)
  values (
    v_oturum.cafe_id, v_adisyon_id, v_oturum.masa_id, v_oturum.id,
    case when v_cafe.odeme_modu = 'once_odeme' then 'odeme_bekliyor'::public.siparis_durum
         else 'bekliyor'::public.siparis_durum end,
    p_musteri_notu
  ) returning id into v_siparis_id;

  for v_kalem in select * from jsonb_array_elements(p_kalemler) loop
    select * into v_urun from public.urun
      where id = (v_kalem->>'urun_id')::uuid and cafe_id = v_oturum.cafe_id and aktif;
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
      v_oturum.cafe_id, v_siparis_id, v_urun.id, v_urun.ad, v_urun.fiyat, v_adet,
      v_opsiyonlar, v_ek_fiyat,
      nullif(trim(coalesce(v_kalem->>'not', '')), '')
    );
  end loop;

  return v_siparis_id;
end
$$;

-- ---------------------------------------------------------------------------
-- K1) Aynı doğrulama: personel_siparis_olustur
-- ---------------------------------------------------------------------------
create or replace function public.personel_siparis_olustur(
  p_masa_id uuid,
  p_kalemler jsonb,
  p_musteri_notu text default null
) returns uuid
language plpgsql security invoker set search_path = public as
$$
declare
  v_masa public.masa%rowtype;
  v_adisyon_id uuid;
  v_siparis_id uuid;
  v_kalem jsonb;
  v_urun public.urun%rowtype;
  v_ek_fiyat numeric(10,2);
  v_opsiyonlar jsonb;
  v_adet int;
begin
  select * into v_masa from public.masa where id = p_masa_id;
  if not found then
    raise exception 'Masa bulunamadı';
  end if;

  if p_kalemler is null or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'Sipariş boş olamaz';
  end if;

  select id into v_adisyon_id from public.adisyon
    where masa_id = p_masa_id and durum = 'acik'
    order by acilis desc limit 1;
  if v_adisyon_id is null then
    insert into public.adisyon (cafe_id, masa_id)
    values (v_masa.cafe_id, p_masa_id)
    returning id into v_adisyon_id;
  end if;

  insert into public.siparis (cafe_id, adisyon_id, masa_id, olusturan_id, durum, musteri_notu)
  values (v_masa.cafe_id, v_adisyon_id, p_masa_id, auth.uid(), 'bekliyor', p_musteri_notu)
  returning id into v_siparis_id;

  for v_kalem in select * from jsonb_array_elements(p_kalemler) loop
    select * into v_urun from public.urun
      where id = (v_kalem->>'urun_id')::uuid and cafe_id = v_masa.cafe_id and aktif;
    if not found then
      raise exception 'Ürün bulunamadı veya pasif';
    end if;

    v_adet := greatest(coalesce((v_kalem->>'adet')::int, 1), 1);
    if v_urun.stok_takip and coalesce(v_urun.stok_adet, 0) < v_adet then
      raise exception '"%" için yeterli stok yok (kalan: %)', v_urun.ad, coalesce(v_urun.stok_adet, 0);
    end if;

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
      v_masa.cafe_id, v_siparis_id, v_urun.id, v_urun.ad, v_urun.fiyat, v_adet,
      v_opsiyonlar, v_ek_fiyat,
      nullif(trim(coalesce(v_kalem->>'not', '')), '')
    );
  end loop;

  return v_siparis_id;
end
$$;
