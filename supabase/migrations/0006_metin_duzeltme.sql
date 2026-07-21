-- Türkçe metin düzeltmesi: önceki yapıştırmada bozulan karakterler için
-- fonksiyonlar aynı içerikle yeniden tanımlanıyor.

-- QR okutulunca çağrılır: masayı doğrular, oturum açar, token döner.
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

  insert into public.masa_oturumu (cafe_id, masa_id)
  values (v_masa.cafe_id, v_masa.id)
  returning token into v_token;

  return query select v_token, v_cafe.id, v_cafe.ad, v_masa.id, v_masa.ad;
end
$$;

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

    select coalesce(sum((o->>'ek_fiyat')::numeric), 0) into v_ek_fiyat
      from jsonb_array_elements(coalesce(v_kalem->'opsiyonlar', '[]'::jsonb)) o;

    insert into public.siparis_kalemi
      (cafe_id, siparis_id, urun_id, urun_ad, birim_fiyat, adet, secilen_opsiyonlar, opsiyon_ek_fiyat)
    values (
      v_oturum.cafe_id, v_siparis_id, v_urun.id, v_urun.ad, v_urun.fiyat, v_adet,
      coalesce(v_kalem->'opsiyonlar', '[]'::jsonb), v_ek_fiyat
    );
  end loop;

  return v_siparis_id;
end
$$;

create or replace function public.personel_siparis_olustur(
  p_masa_id uuid,
  p_kalemler jsonb,
  p_musteri_notu text default null
) returns uuid
language plpgsql security invoker set search_path = public as
$$
declare
  v_cafe public.cafe%rowtype;
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
  select * into v_cafe from public.cafe where id = v_masa.cafe_id;

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
  values (
    v_masa.cafe_id, v_adisyon_id, p_masa_id, auth.uid(),
    case when v_cafe.odeme_modu = 'once_odeme' then 'odeme_bekliyor'::public.siparis_durum
         else 'bekliyor'::public.siparis_durum end,
    p_musteri_notu
  ) returning id into v_siparis_id;

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
      (cafe_id, siparis_id, urun_id, urun_ad, birim_fiyat, adet, secilen_opsiyonlar, opsiyon_ek_fiyat)
    values (
      v_masa.cafe_id, v_siparis_id, v_urun.id, v_urun.ad, v_urun.fiyat, v_adet,
      coalesce(v_kalem->'opsiyonlar', '[]'::jsonb), v_ek_fiyat
    );
  end loop;

  return v_siparis_id;
end
$$;

create or replace function public.garson_cagir(p_token text, p_tur public.cagri_tur default 'garson')
returns void
language plpgsql security definer set search_path = public as
$$
declare
  v_oturum public.masa_oturumu%rowtype;
begin
  select * into v_oturum from public.masa_oturumu
    where token = p_token and bitis > now();
  if not found then
    raise exception 'Oturum geçersiz veya süresi dolmuş; QR kodu yeniden okutun';
  end if;

  if exists (
    select 1 from public.garson_cagri
    where masa_id = v_oturum.masa_id and tur = p_tur and acik
  ) then
    return; -- zaten açık bir çağrı var
  end if;

  insert into public.garson_cagri (cafe_id, masa_id, tur)
  values (v_oturum.cafe_id, v_oturum.masa_id, p_tur);
end
$$;

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
