-- ============================================================================
-- 0052: Ödül karşılığı bedava kalem (Faz 6 M4/M5 hazırlığı)
--
-- İkram tamamen kalkıyor (manuel kasiyer bedava-ürün yolu). Ama sadakat ödülü
-- kullanıldığında ürünün bedava yazılması gerekiyordu — eskiden bunu kasiyer
-- elle İkram işaretleyerek yapıyordu. Artık odul_kullan HANGİ kalemin bedava
-- olacağını parametre alıp SUNUCUDA işaretler (ayrı odul_karsiligi işareti,
-- ikram'dan bağımsız). Böylece ikram'a hiç gerek kalmadan ödül çalışır.
--
-- GÜVENLİ SIRA: yeni 3-arg odul_kullan EKLENİR, eski 2-arg SİLİNMEZ (eski
-- MasaYonetimPaneli Step 2'de silinene kadar çalışsın). Eski 2-arg ve manuel
-- ikram yazma yolu 0053'te (cari ile birlikte) kaldırılacak.
-- ============================================================================

-- odul_karsiligi: kalem ödül karşılığı bedava (ciro dışı). Yalnız odul_kullan
-- RPC'si (DEFINER) set eder; istemci doğrudan değiştiremez (aşağıda guard).
alter table public.siparis_kalemi
  add column if not exists odul_karsiligi boolean not null default false;

-- adisyon_tutarlari: ödül karşılığı kalemler de ciro dışı (ikram gibi).
create or replace view public.adisyon_tutarlari as
 SELECT a.id AS adisyon_id,
    a.cafe_id,
    a.masa_id,
    a.durum,
    a.acilis,
    a.kapanis,
    a.cari_id,
    a.odeme_turu,
    GREATEST(0::numeric, COALESCE(sum(
        CASE
            WHEN (s.durum = ANY (ARRAY['iptal'::siparis_durum, 'reddedildi'::siparis_durum])) OR k.reddedildi OR k.ikram OR k.odul_karsiligi THEN 0::numeric
            ELSE (k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet::numeric
        END), 0::numeric) - a.iskonto_tutar) AS tutar,
    a.iskonto_tutar,
    COALESCE(sum(
        CASE
            WHEN (s.durum = ANY (ARRAY['iptal'::siparis_durum, 'reddedildi'::siparis_durum])) OR k.reddedildi OR NOT k.ikram THEN 0::numeric
            ELSE (k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet::numeric
        END), 0::numeric) AS ikram_tutar
   FROM adisyon a
     LEFT JOIN siparis s ON s.adisyon_id = a.id
     LEFT JOIN siparis_kalemi k ON k.siparis_id = s.id
  GROUP BY a.id;

-- Guard: odul_karsiligi de fiyat/kimlik alanları gibi istemciden değişemez
-- (yalnız odul_kullan DEFINER'ı set eder). 0051 gövdesine tek satır eklenir.
create or replace function public.kalem_kolon_bekcisi() returns trigger
language plpgsql set search_path = public as
$$
begin
  if current_user not in ('authenticated', 'anon') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Sipariş kalemi yalnız sipariş RPC''leriyle eklenebilir';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Sipariş kalemi silinemez; kalem reddi (reddedildi) kullanılır';
  end if;
  if new.birim_fiyat        is distinct from old.birim_fiyat
     or new.opsiyon_ek_fiyat is distinct from old.opsiyon_ek_fiyat
     or new.adet             is distinct from old.adet
     or new.urun_id          is distinct from old.urun_id
     or new.urun_ad          is distinct from old.urun_ad
     or new.secilen_opsiyonlar is distinct from old.secilen_opsiyonlar
     or new.odul_karsiligi   is distinct from old.odul_karsiligi then
    raise exception 'Kalem fiyat/ürün alanları buradan değiştirilemez';
  end if;
  if new.ikram is distinct from old.ikram
     and public.aktif_rol() not in ('admin', 'kasa') then
    raise exception 'İkram yalnız kasa/admin tarafından işaretlenebilir';
  end if;
  return new;
end
$$;

-- Yeni odul_kullan: puanı düşer VE seçilen kalemi sunucuda bedava işaretler.
create function public.odul_kullan(p_musteri_kod text, p_odul_id uuid, p_kalem_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  v_cafe_id uuid;
  v_musteri public.kullanici%rowtype;
  v_odul public.odul%rowtype;
  v_hesap_id uuid;
  v_mevcut int;
  v_bakiye int;
  v_kalem_var boolean;
begin
  if not public.rol_var(array['admin','kasa']::public.kullanici_rol[]) then
    raise exception 'Bu işlem için kasa yetkisi gerekli';
  end if;
  if not public.yetki_var('odul') then
    raise exception 'Ödül kullanma yetkiniz kapalı — yöneticinize başvurun';
  end if;
  v_cafe_id := public.aktif_cafe_id();

  select * into v_odul from public.odul
    where id = p_odul_id and cafe_id = v_cafe_id and aktif;
  if not found then
    raise exception 'Ödül bulunamadı veya pasif';
  end if;

  -- Kalem bu kafenin AÇIK bir adisyonunda, henüz bedava/red değil
  select true into v_kalem_var
  from public.siparis_kalemi k
  join public.siparis s on s.id = k.siparis_id
  join public.adisyon a on a.id = s.adisyon_id
  where k.id = p_kalem_id and k.cafe_id = v_cafe_id and a.durum = 'acik'
    and not k.reddedildi and not k.ikram and not k.odul_karsiligi;
  if not found then
    raise exception 'Uygun kalem bulunamadı (açık adisyonda, ödenmemiş, bedava olmayan bir ürün seçin)';
  end if;

  select * into v_musteri from public.kullanici
    where musteri_kod = upper(trim(p_musteri_kod)) and rol = 'musteri' and aktif;
  if not found then
    raise exception 'Müşteri kodu bulunamadı: %', upper(trim(p_musteri_kod));
  end if;

  v_hesap_id := public.sadakat_hesap_bul(v_cafe_id, v_musteri.id);
  select puan_bakiye into v_mevcut from public.sadakat_hesabi where id = v_hesap_id;
  if coalesce(v_mevcut, 0) < v_odul.puan_bedeli then
    raise exception 'Puan yetersiz (bakiye: %, gereken: %)',
      coalesce(v_mevcut, 0), v_odul.puan_bedeli;
  end if;

  insert into public.puan_hareketi
    (cafe_id, sadakat_hesabi_id, odul_id, tur, puan, aciklama, olusturan_id)
  values
    (v_cafe_id, v_hesap_id, v_odul.id, 'harcama', -v_odul.puan_bedeli,
     'Ödül: ' || v_odul.ad, auth.uid());

  update public.sadakat_hesabi
    set puan_bakiye = puan_bakiye - v_odul.puan_bedeli
    where id = v_hesap_id
    returning puan_bakiye into v_bakiye;

  -- Kalemi ödül karşılığı bedava işaretle (DEFINER → guard muaf)
  update public.siparis_kalemi set odul_karsiligi = true where id = p_kalem_id;

  return jsonb_build_object(
    'musteri_ad', v_musteri.ad,
    'odul_ad', v_odul.ad,
    'harcanan', v_odul.puan_bedeli,
    'yeni_bakiye', v_bakiye
  );
end
$$;

grant execute on function public.odul_kullan(text, uuid, uuid) to authenticated;
