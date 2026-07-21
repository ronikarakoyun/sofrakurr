-- ============================================================================
-- Faz 2: Stok takibi + Garson çağrısı + Personel (manuel) siparişi
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Stok takibi — ürün başına isteğe bağlı
-- ---------------------------------------------------------------------------
alter table public.urun
  add column if not exists stok_takip boolean not null default false,
  add column if not exists stok_adet integer,
  add column if not exists kritik_seviye integer not null default 0;

-- Sipariş kalemi yazıldığı an stok düşer (rezervasyon); stok bitince ürün
-- otomatik pasife alınır ve QR menüden anında kaybolur.
create function public.stok_dus() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  update public.urun
  set stok_adet = stok_adet - new.adet,
      aktif = case when stok_adet - new.adet <= 0 then false else aktif end
  where id = new.urun_id and stok_takip and stok_adet is not null;
  return new;
end
$$;

create trigger siparis_kalemi_stok_dus
  after insert on public.siparis_kalemi
  for each row execute function public.stok_dus();

-- Kalem reddedilirse stok iade edilir (satış gerçekleşmedi)
create function public.stok_iade_kalem() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if new.reddedildi and not old.reddedildi then
    update public.urun
    set stok_adet = stok_adet + new.adet
    where id = new.urun_id and stok_takip and stok_adet is not null;
  end if;
  return new;
end
$$;

create trigger siparis_kalemi_stok_iade
  after update of reddedildi on public.siparis_kalemi
  for each row execute function public.stok_iade_kalem();

-- Sipariş iptal/reddedilirse, (tek tek reddedilmemiş) kalemlerin stoğu iade edilir
create function public.stok_iade_siparis() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if new.durum in ('iptal', 'reddedildi') and old.durum not in ('iptal', 'reddedildi') then
    update public.urun u
    set stok_adet = u.stok_adet + k.toplam_adet
    from (
      select urun_id, sum(adet) as toplam_adet
      from public.siparis_kalemi
      where siparis_id = new.id and not reddedildi
      group by urun_id
    ) k
    where u.id = k.urun_id and u.stok_takip and u.stok_adet is not null;
  end if;
  return new;
end
$$;

create trigger siparis_stok_iade
  after update of durum on public.siparis
  for each row execute function public.stok_iade_siparis();

-- ---------------------------------------------------------------------------
-- 2) Garson çağrısı (müşteri QR'dan çağırır; garson ekranında görünür)
-- ---------------------------------------------------------------------------
create type public.cagri_tur as enum ('garson', 'hesap');

create table public.garson_cagri (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references public.cafe(id) on delete cascade,
  masa_id    uuid not null references public.masa(id) on delete cascade,
  tur        public.cagri_tur not null default 'garson',
  acik       boolean not null default true,
  created_at timestamptz not null default now(),
  kapandi_at timestamptz
);

create index on public.garson_cagri (cafe_id) where acik;

alter table public.garson_cagri enable row level security;
create policy personel_cagri on public.garson_cagri
  for all using (cafe_id = public.aktif_cafe_id());

-- Müşteri çağrısı: oturum token'ı doğrulanır; masada zaten açık çağrı varsa yenilenmez
create function public.garson_cagir(p_token text, p_tur public.cagri_tur default 'garson')
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

revoke execute on function public.garson_cagir(text, public.cagri_tur) from public;
grant execute on function public.garson_cagir(text, public.cagri_tur) to anon, authenticated;

alter publication supabase_realtime add table public.garson_cagri;

-- ---------------------------------------------------------------------------
-- 3) Push abonelikleri (garson cihazları; "X masası hazır" bildirimi)
-- ---------------------------------------------------------------------------
create table public.push_abonelik (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references public.cafe(id) on delete cascade,
  kullanici_id uuid not null references public.kullanici(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  created_at   timestamptz not null default now()
);

alter table public.push_abonelik enable row level security;
create policy kendi_aboneligi on public.push_abonelik
  for all using (kullanici_id = auth.uid());
create policy personel_abonelik_okuma on public.push_abonelik
  for select using (cafe_id = public.aktif_cafe_id());
-- süresi dolmuş abonelikler push gönderilirken temizlenebilsin
create policy personel_abonelik_silme on public.push_abonelik
  for delete using (cafe_id = public.aktif_cafe_id());

-- ---------------------------------------------------------------------------
-- 4) Personel (garson) manuel siparişi — adisyonu bulur/açar, atomik yazar.
--    security invoker: personelin kendi RLS yetkileriyle çalışır.
-- ---------------------------------------------------------------------------
create function public.personel_siparis_olustur(
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

revoke execute on function public.personel_siparis_olustur(uuid, jsonb, text) from public;
grant execute on function public.personel_siparis_olustur(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Müşteri siparişine stok kontrolü ekle (siparis_olustur güncellemesi)
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
