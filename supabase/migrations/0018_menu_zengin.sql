-- Zengin menü: ürün fotoğrafı deposu, kampanya işareti ve ürün (kalem) bazlı
-- müşteri notu. urun.aciklama ve urun.gorsel_url 0001'den beri vardı; bu
-- migration kampanya bayrağını, kalem notunu ve fotoğraf yükleme iznini ekler.

-- 1) Kampanya: işaretli ürünler QR menünün en üstünde vitrin olarak çıkar
alter table public.urun
  add column if not exists kampanya boolean not null default false;

-- 2) Ürüne özel not ("az şekerli olsun" gibi; sipariş notu ayrıca duruyor)
alter table public.siparis_kalemi
  add column if not exists kalem_notu text;

-- 3) Müşteri sipariş RPC'si: kalemlerde "not" alanını kabul et
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
      (cafe_id, siparis_id, urun_id, urun_ad, birim_fiyat, adet, secilen_opsiyonlar, opsiyon_ek_fiyat, kalem_notu)
    values (
      v_oturum.cafe_id, v_siparis_id, v_urun.id, v_urun.ad, v_urun.fiyat, v_adet,
      coalesce(v_kalem->'opsiyonlar', '[]'::jsonb), v_ek_fiyat,
      nullif(trim(coalesce(v_kalem->>'not', '')), '')
    );
  end loop;

  return v_siparis_id;
end
$$;

-- 4) Personel sipariş RPC'si: aynı "not" desteği
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

-- 5) Oturum siparişleri: kalem notu da dönsün (Düzenle akışında sepete geri yüklenir)
create or replace function public.oturum_siparisleri(p_token text)
returns table (
  siparis_id uuid,
  durum public.siparis_durum,
  created_at timestamptz,
  kalemler jsonb,
  toplam numeric,
  benim boolean
)
language plpgsql stable security definer set search_path = public as
$$
declare
  v_oturum public.masa_oturumu%rowtype;
begin
  select * into v_oturum from public.masa_oturumu
    where token = p_token and bitis > now();
  if not found then
    raise exception 'Oturum geçersiz veya süresi dolmuş; QR kodu yeniden okutun';
  end if;

  return query
  select
    s.id,
    s.durum,
    s.created_at,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'ad', k.urun_ad,
            'adet', k.adet,
            'tutar', (k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet,
            'urun_id', k.urun_id,
            'opsiyonlar', k.secilen_opsiyonlar,
            'not', k.kalem_notu
          ) order by k.id
        )
        from public.siparis_kalemi k
        where k.siparis_id = s.id and not k.reddedildi
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select sum((k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet)
        from public.siparis_kalemi k
        where k.siparis_id = s.id and not k.reddedildi
      ),
      0
    ),
    (s.masa_oturumu_id = v_oturum.id)
  from public.siparis s
  left join public.adisyon a on a.id = s.adisyon_id
  where s.masa_id = v_oturum.masa_id
    and s.durum not in ('iptal', 'reddedildi')
    and (a.durum = 'acik' or s.durum in ('odeme_bekliyor', 'bekliyor', 'hazirlaniyor', 'hazir'))
  order by s.created_at desc;
end
$$;

-- 6) Fotoğraf deposu: herkese açık okunur, yalnız admin kendi kafesinin
--    klasörüne (cafe_id/...) yükleyebilir/silebilir
insert into storage.buckets (id, name, public)
values ('urun-foto', 'urun-foto', true)
on conflict (id) do nothing;

create policy urun_foto_okuma on storage.objects
  for select using (bucket_id = 'urun-foto');

create policy urun_foto_yukleme on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'urun-foto'
    and (storage.foldername(name))[1] = public.aktif_cafe_id()::text
    and exists (select 1 from public.kullanici where id = auth.uid() and rol = 'admin' and aktif)
  );

create policy urun_foto_degistirme on storage.objects
  for update to authenticated
  using (
    bucket_id = 'urun-foto'
    and (storage.foldername(name))[1] = public.aktif_cafe_id()::text
    and exists (select 1 from public.kullanici where id = auth.uid() and rol = 'admin' and aktif)
  );

create policy urun_foto_silme on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'urun-foto'
    and (storage.foldername(name))[1] = public.aktif_cafe_id()::text
    and exists (select 1 from public.kullanici where id = auth.uid() and rol = 'admin' and aktif)
  );
