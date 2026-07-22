-- ============================================================================
-- 0051: siparis_kalemi INSERT/DELETE kilidi (Faz 6 M0-b)
--
-- 0048 (G3) mevcut bir kalemin fiyat/ürün UPDATE'ini kilitledi ama doğrudan
-- istemci INSERT'i (0-fiyat kalem ekleme) açık kalmıştı; çünkü meşru sipariş
-- girişi olan personel_siparis_olustur INVOKER'dı ve kalemi authenticated
-- olarak ekliyordu — bekçi onu ayıramazdı.
--
-- Çözüm: personel_siparis_olustur DEFINER olur (siparis_olustur /
-- musteri_siparis_olustur zaten öyle) → kalem INSERT'i postgres olarak koşar.
-- Böylece bekçi authenticated/anon'un TÜM doğrudan INSERT/DELETE'ini kesebilir.
--
-- DEFINER'a çevirince RLS kalktığından, masalı yolda masa aramasına
-- "cafe_id = aktif_cafe_id()" eklendi (INVOKER'ken bunu personel_masa RLS'i
-- sağlıyordu) — başka kafenin masasına sipariş açılamaz. birim_fiyat zaten
-- sunucudaki urun.fiyat'tan alınıyordu (0023), o güvence korunur.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- personel_siparis_olustur → SECURITY DEFINER + kiracı kontrolü
-- ---------------------------------------------------------------------------
create or replace function public.personel_siparis_olustur(
  p_masa_id uuid, p_kalemler jsonb, p_musteri_notu text default null
) returns uuid
language plpgsql security definer set search_path = public as
$$
declare
  v_cafe_id uuid;
  v_masa public.masa%rowtype;
  v_adisyon_id uuid;
  v_siparis_id uuid;
  v_kalem jsonb;
  v_urun public.urun%rowtype;
  v_ek_fiyat numeric(10,2);
  v_opsiyonlar jsonb;
  v_adet int;
begin
  if p_kalemler is null or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'Sipariş boş olamaz';
  end if;

  if p_masa_id is null then
    -- masasız tezgah satışı: yalnız self-servis kafede
    v_cafe_id := public.aktif_cafe_id();
    if v_cafe_id is null then
      raise exception 'Kafe bulunamadı';
    end if;
    if (select masa_duzeni from public.cafe where id = v_cafe_id) then
      raise exception 'Bu kafede sipariş için masa seçimi gerekli';
    end if;
    insert into public.adisyon (cafe_id) values (v_cafe_id)
    returning id into v_adisyon_id;
  else
    -- DEFINER: RLS artık uygulanmadığı için masa yalnız çağıranın kafesinde
    -- olmalı (INVOKER'ken personel_masa RLS'i bunu sağlıyordu).
    select * into v_masa from public.masa
      where id = p_masa_id and cafe_id = public.aktif_cafe_id();
    if not found then
      raise exception 'Masa bulunamadı';
    end if;
    v_cafe_id := v_masa.cafe_id;

    select id into v_adisyon_id from public.adisyon
      where masa_id = p_masa_id and durum = 'acik'
      order by acilis desc limit 1;
    if v_adisyon_id is null then
      insert into public.adisyon (cafe_id, masa_id)
      values (v_cafe_id, p_masa_id)
      returning id into v_adisyon_id;
    end if;
  end if;

  insert into public.siparis
    (cafe_id, adisyon_id, masa_id, olusturan_id, durum, musteri_notu, siparis_no)
  values (v_cafe_id, v_adisyon_id, p_masa_id, auth.uid(), 'bekliyor', p_musteri_notu,
          public.personel_siparis_no_al(v_cafe_id))
  returning id into v_siparis_id;

  for v_kalem in select * from jsonb_array_elements(p_kalemler) loop
    select * into v_urun from public.urun
      where id = (v_kalem->>'urun_id')::uuid and cafe_id = v_cafe_id and aktif;
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
      v_cafe_id, v_siparis_id, v_urun.id, v_urun.ad, v_urun.fiyat, v_adet,
      v_opsiyonlar, v_ek_fiyat,
      nullif(trim(coalesce(v_kalem->>'not', '')), '')
    );
  end loop;

  return v_siparis_id;
end
$$;

-- ---------------------------------------------------------------------------
-- kalem bekçisi: artık INSERT ve DELETE'i de keser (yalnız RPC/servis ekler).
-- UPDATE bloğu 0048 ile aynı (fiyat/ürün alanları + ikram rolü).
-- ---------------------------------------------------------------------------
create or replace function public.kalem_kolon_bekcisi() returns trigger
language plpgsql set search_path = public as
$$
begin
  if current_user not in ('authenticated', 'anon') then
    if tg_op = 'DELETE' then return old; end if;
    return new; -- RPC (postgres) / servis (service_role) serbest
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Sipariş kalemi yalnız sipariş RPC''leriyle eklenebilir';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Sipariş kalemi silinemez; kalem reddi (reddedildi) kullanılır';
  end if;
  -- UPDATE: fiyat/ürün kimlik alanları istemciden değişemez (siparis_id
  -- serbest — kalem_tasi masalar arası taşır; cafe_id RLS with_check ile kilitli)
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

drop trigger kalem_kolon_bekcisi on public.siparis_kalemi;
create trigger kalem_kolon_bekcisi
before insert or update or delete on public.siparis_kalemi
for each row execute function public.kalem_kolon_bekcisi();
