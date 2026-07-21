-- Garson/personel siparişi ödeme onayı BEKLEMEZ: personel güvenilir olduğu için
-- sipariş doğrudan mutfağa düşer (fiş anında basılır); ödeme, adisyon kasada
-- kapatılırken alınır. QR (müşteri) siparişi için önce-ödeme kuralı değişmedi.

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

    select coalesce(sum((o->>'ek_fiyat')::numeric), 0) into v_ek_fiyat
      from jsonb_array_elements(coalesce(v_kalem->'opsiyonlar', '[]'::jsonb)) o;

    insert into public.siparis_kalemi
      (cafe_id, siparis_id, urun_id, urun_ad, birim_fiyat, adet, secilen_opsiyonlar, opsiyon_ek_fiyat, kalem_notu)
    values (
      v_masa.cafe_id, v_siparis_id, v_urun.id, v_urun.ad, v_urun.fiyat, v_adet,
      coalesce(v_kalem->'opsiyonlar', '[]'::jsonb), v_ek_fiyat,
      nullif(trim(coalesce(v_kalem->>'not', '')), '')
    );
  end loop;

  return v_siparis_id;
end
$$;
