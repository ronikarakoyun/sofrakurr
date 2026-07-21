-- ============================================================================
-- SofraKur — Faz 0: Çok-kiracılı temel şema
-- Her tablo cafe_id taşır; RLS ile her kafe yalnız kendi verisini görür.
-- Sipariş akışı (once_odeme modu):
--   müşteri QR'dan sipariş verir -> 'odeme_bekliyor' (mutfak GÖRMEZ)
--   kasiyer POS'tan tahsil edip "Ödendi" der -> 'bekliyor' -> KDS'e düşer
-- acik_hesap modunda sipariş doğrudan 'bekliyor' başlar, adisyon kasada kapanır.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enum'lar
-- ---------------------------------------------------------------------------
create type public.kullanici_rol as enum ('admin', 'garson', 'mutfak', 'musteri');
create type public.odeme_modu as enum ('once_odeme', 'acik_hesap');
create type public.adisyon_durum as enum ('acik', 'odendi', 'iptal');
create type public.siparis_durum as enum (
  'odeme_bekliyor', -- once_odeme modunda kasiyer onayı bekliyor; mutfak görmez
  'bekliyor',       -- mutfağın kuyruğunda
  'hazirlaniyor',
  'hazir',
  'teslim',
  'iptal',          -- kasa/garson iptali
  'reddedildi'      -- mutfak reddi (ör. ürün bitti)
);

-- ---------------------------------------------------------------------------
-- Kiracı kökü
-- ---------------------------------------------------------------------------
create table public.cafe (
  id            uuid primary key default gen_random_uuid(),
  ad            text not null,
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  odeme_modu    public.odeme_modu not null default 'once_odeme',
  -- açıksa QR siparişi mutfağa düşmeden önce garson onayı da ister (Faz 1 ayarı)
  garson_onayi  boolean not null default false,
  aktif         boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.bolum (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references public.cafe(id) on delete cascade,
  ad         text not null,
  sira       int not null default 0,
  created_at timestamptz not null default now()
);

create table public.masa (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references public.cafe(id) on delete cascade,
  bolum_id   uuid references public.bolum(id) on delete set null,
  ad         text not null, -- "Masa 7", "Bahçe 3" vb.
  -- QR etiketine basılan kalıcı kod; URL'de kullanılır (/qr/<qr_kod>)
  qr_kod     text not null unique default encode(gen_random_bytes(12), 'hex'),
  aktif      boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Kullanıcılar (personel + kayıtlı müşteri) — auth.users'a birebir bağlı
-- ---------------------------------------------------------------------------
create table public.kullanici (
  id         uuid primary key references auth.users(id) on delete cascade,
  -- personelde zorunlu; müşteri (Faz 4) kafeye bağlı olmadığı için null olabilir
  cafe_id    uuid references public.cafe(id) on delete cascade,
  rol        public.kullanici_rol not null default 'musteri',
  ad         text,
  aktif      boolean not null default true,
  created_at timestamptz not null default now(),
  check (rol = 'musteri' or cafe_id is not null)
);

-- RLS yardımcıları: giriş yapmış kullanıcının kafesi ve rolü
create function public.aktif_cafe_id() returns uuid
language sql stable security definer set search_path = public as
$$ select cafe_id from public.kullanici where id = auth.uid() and aktif $$;

create function public.aktif_rol() returns public.kullanici_rol
language sql stable security definer set search_path = public as
$$ select rol from public.kullanici where id = auth.uid() and aktif $$;

-- ---------------------------------------------------------------------------
-- Menü
-- ---------------------------------------------------------------------------
create table public.kategori (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references public.cafe(id) on delete cascade,
  ad         text not null,
  sira       int not null default 0,
  aktif      boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.urun (
  id          uuid primary key default gen_random_uuid(),
  cafe_id     uuid not null references public.cafe(id) on delete cascade,
  kategori_id uuid not null references public.kategori(id) on delete cascade,
  ad          text not null,
  aciklama    text,
  fiyat       numeric(10,2) not null check (fiyat >= 0),
  gorsel_url  text,
  -- "ürün bitti" -> pasife çek; QR menüde anında kaybolur
  aktif       boolean not null default true,
  sira        int not null default 0,
  created_at  timestamptz not null default now()
);

-- Opsiyon grupları: ör. urun=Latte, grup=Süt (zorunlu, tek seçim), grup=Shot (0-2)
create table public.opsiyon_grubu (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references public.cafe(id) on delete cascade,
  urun_id    uuid not null references public.urun(id) on delete cascade,
  ad         text not null,
  min_secim  int not null default 0 check (min_secim >= 0),
  max_secim  int not null default 1 check (max_secim >= 1),
  sira       int not null default 0,
  check (max_secim >= min_secim)
);

create table public.opsiyon (
  id               uuid primary key default gen_random_uuid(),
  cafe_id          uuid not null references public.cafe(id) on delete cascade,
  opsiyon_grubu_id uuid not null references public.opsiyon_grubu(id) on delete cascade,
  ad               text not null,
  ek_fiyat         numeric(10,2) not null default 0 check (ek_fiyat >= 0),
  aktif            boolean not null default true,
  sira             int not null default 0
);

-- ---------------------------------------------------------------------------
-- Masa oturumu: QR okutulunca açılan kısa ömürlü oturum.
-- Anonim müşteri bu token ile sipariş yazar; süresi dolan token sipariş veremez.
-- ---------------------------------------------------------------------------
create table public.masa_oturumu (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references public.cafe(id) on delete cascade,
  masa_id    uuid not null references public.masa(id) on delete cascade,
  token      text not null unique default encode(gen_random_bytes(24), 'hex'),
  bitis      timestamptz not null default now() + interval '3 hours',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Adisyon & Sipariş
-- acik_hesap: masanın açık adisyonu sipariş turlarını biriktirir, kasa kapatır.
-- once_odeme: her sipariş için adisyon açılır ve "Ödendi" ile birlikte kapanır.
-- ---------------------------------------------------------------------------
create table public.adisyon (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references public.cafe(id) on delete cascade,
  masa_id    uuid not null references public.masa(id) on delete restrict,
  durum      public.adisyon_durum not null default 'acik',
  acilis     timestamptz not null default now(),
  kapanis    timestamptz
);

create table public.siparis (
  id               uuid primary key default gen_random_uuid(),
  cafe_id          uuid not null references public.cafe(id) on delete cascade,
  adisyon_id       uuid not null references public.adisyon(id) on delete cascade,
  masa_id          uuid not null references public.masa(id) on delete restrict,
  -- QR kanalından geldiyse dolu; garson manuel girdiyse null
  masa_oturumu_id  uuid references public.masa_oturumu(id) on delete set null,
  -- garson manuel girdiyse dolu
  olusturan_id     uuid references public.kullanici(id) on delete set null,
  durum            public.siparis_durum not null default 'odeme_bekliyor',
  musteri_notu     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.siparis_kalemi (
  id                 uuid primary key default gen_random_uuid(),
  cafe_id            uuid not null references public.cafe(id) on delete cascade,
  siparis_id         uuid not null references public.siparis(id) on delete cascade,
  urun_id            uuid not null references public.urun(id) on delete restrict,
  -- fiyat/ad anlık kopyalanır; menü sonradan değişse de adisyon bozulmaz
  urun_ad            text not null,
  birim_fiyat        numeric(10,2) not null,
  adet               int not null default 1 check (adet > 0),
  -- [{"grup":"Süt","secim":"Yulaf","ek_fiyat":10}, ...]
  secilen_opsiyonlar jsonb not null default '[]',
  opsiyon_ek_fiyat   numeric(10,2) not null default 0,
  -- mutfak reddi (ör. ürün bitti); sipariş bütünüyle reddedilmeden tek kalem düşülebilir
  reddedildi         boolean not null default false,
  red_nedeni         text
);

-- updated_at tetikleyicisi
create function public.set_updated_at() returns trigger
language plpgsql as
$$ begin new.updated_at = now(); return new; end $$;

create trigger siparis_updated_at before update on public.siparis
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- İndeksler
-- ---------------------------------------------------------------------------
create index on public.bolum (cafe_id);
create index on public.masa (cafe_id);
create index on public.kullanici (cafe_id);
create index on public.kategori (cafe_id);
create index on public.urun (cafe_id, kategori_id);
create index on public.opsiyon_grubu (urun_id);
create index on public.opsiyon (opsiyon_grubu_id);
create index on public.masa_oturumu (cafe_id, masa_id);
create index on public.adisyon (cafe_id, masa_id) where durum = 'acik';
create index on public.siparis (cafe_id, durum);
create index on public.siparis (adisyon_id);
create index on public.siparis_kalemi (siparis_id);

-- ---------------------------------------------------------------------------
-- RLS: her kafe kendi verisi; anonim müşteri yalnız menü okur,
-- sipariş yazma yalnız aşağıdaki security definer RPC'lerden geçer.
-- ---------------------------------------------------------------------------
alter table public.cafe            enable row level security;
alter table public.bolum           enable row level security;
alter table public.masa            enable row level security;
alter table public.kullanici       enable row level security;
alter table public.kategori        enable row level security;
alter table public.urun            enable row level security;
alter table public.opsiyon_grubu   enable row level security;
alter table public.opsiyon         enable row level security;
alter table public.masa_oturumu    enable row level security;
alter table public.adisyon         enable row level security;
alter table public.siparis         enable row level security;
alter table public.siparis_kalemi  enable row level security;

-- Personel yalnız kendi kafesinin satırlarını görür/işler
create policy personel_cafe on public.cafe
  for select using (id = public.aktif_cafe_id());
create policy admin_cafe_guncelle on public.cafe
  for update using (id = public.aktif_cafe_id() and public.aktif_rol() = 'admin');

-- Menü herkese açık okunur (QR menü anonim erişir)
create policy menu_kategori_okuma on public.kategori for select using (aktif);
create policy menu_urun_okuma on public.urun for select using (aktif);
create policy menu_opsiyon_grubu_okuma on public.opsiyon_grubu for select using (true);
create policy menu_opsiyon_okuma on public.opsiyon for select using (aktif);
create policy anon_cafe_okuma on public.cafe for select using (aktif);

-- Personelin kendi kafesi içindeki tam görünürlüğü
create policy personel_bolum on public.bolum
  for all using (cafe_id = public.aktif_cafe_id());
create policy personel_masa on public.masa
  for all using (cafe_id = public.aktif_cafe_id());
create policy personel_kategori on public.kategori
  for all using (cafe_id = public.aktif_cafe_id());
create policy personel_urun on public.urun
  for all using (cafe_id = public.aktif_cafe_id());
create policy personel_opsiyon_grubu on public.opsiyon_grubu
  for all using (cafe_id = public.aktif_cafe_id());
create policy personel_opsiyon on public.opsiyon
  for all using (cafe_id = public.aktif_cafe_id());
create policy personel_masa_oturumu on public.masa_oturumu
  for all using (cafe_id = public.aktif_cafe_id());
create policy personel_adisyon on public.adisyon
  for all using (cafe_id = public.aktif_cafe_id());
create policy personel_kalem on public.siparis_kalemi
  for all using (cafe_id = public.aktif_cafe_id());

-- Kullanıcı kendi kaydını okur; admin kafesinin personelini yönetir
create policy kendi_kaydi on public.kullanici
  for select using (id = auth.uid());
create policy admin_personel on public.kullanici
  for all using (cafe_id = public.aktif_cafe_id() and public.aktif_rol() = 'admin');

-- SİPARİŞ: mutfak, ödemesi tamamlanmamış siparişi GÖRMEZ
create policy personel_siparis_okuma on public.siparis
  for select using (
    cafe_id = public.aktif_cafe_id()
    and (public.aktif_rol() <> 'mutfak' or durum <> 'odeme_bekliyor')
  );
create policy personel_siparis_yazma on public.siparis
  for insert with check (cafe_id = public.aktif_cafe_id());
create policy personel_siparis_guncelleme on public.siparis
  for update using (
    cafe_id = public.aktif_cafe_id()
    and (public.aktif_rol() <> 'mutfak' or durum <> 'odeme_bekliyor')
  );

-- ---------------------------------------------------------------------------
-- Anonim QR akışı için RPC'ler (security definer: RLS'i kontrollü aşar)
-- ---------------------------------------------------------------------------

-- QR okutulunca çağrılır: masayı doğrular, oturum açar, token döner.
create function public.masa_oturumu_ac(p_qr_kod text)
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

-- Müşteri siparişi: oturum token'ı doğrular, adisyonu bulur/açar, siparişi yazar.
-- Kalem formatı: [{"urun_id":"...","adet":2,"opsiyonlar":[{"grup":"Süt","secim":"Yulaf","ek_fiyat":10}]}]
create function public.siparis_olustur(
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

  -- hız limiti: aynı masadan son 60 saniyede en fazla 3 sipariş
  select count(*) into v_son_dakika from public.siparis
    where masa_id = v_oturum.masa_id and created_at > now() - interval '60 seconds';
  if v_son_dakika >= 3 then
    raise exception 'Çok sık sipariş; lütfen biraz bekleyin';
  end if;

  -- masanın açık adisyonunu bul ya da aç
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

    select coalesce(sum((o->>'ek_fiyat')::numeric), 0) into v_ek_fiyat
      from jsonb_array_elements(coalesce(v_kalem->'opsiyonlar', '[]'::jsonb)) o;

    insert into public.siparis_kalemi
      (cafe_id, siparis_id, urun_id, urun_ad, birim_fiyat, adet, secilen_opsiyonlar, opsiyon_ek_fiyat)
    values (
      v_oturum.cafe_id, v_siparis_id, v_urun.id, v_urun.ad, v_urun.fiyat,
      greatest(coalesce((v_kalem->>'adet')::int, 1), 1),
      coalesce(v_kalem->'opsiyonlar', '[]'::jsonb),
      v_ek_fiyat
    );
  end loop;

  return v_siparis_id;
end
$$;

-- Müşteri kendi oturumunun sipariş durumlarını sorgular ("hazırlanıyor mu?")
create function public.oturum_siparisleri(p_token text)
returns table (siparis_id uuid, durum public.siparis_durum, created_at timestamptz)
language sql stable security definer set search_path = public as
$$
  select s.id, s.durum, s.created_at
  from public.siparis s
  join public.masa_oturumu mo on mo.id = s.masa_oturumu_id
  where mo.token = p_token
  order by s.created_at desc
$$;

-- Anonim istemci yalnız bu RPC'leri çağırabilsin
revoke execute on function public.masa_oturumu_ac(text) from public;
revoke execute on function public.siparis_olustur(text, jsonb, text) from public;
revoke execute on function public.oturum_siparisleri(text) from public;
grant execute on function public.masa_oturumu_ac(text) to anon, authenticated;
grant execute on function public.siparis_olustur(text, jsonb, text) to anon, authenticated;
grant execute on function public.oturum_siparisleri(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: KDS ve kasa ekranları sipariş değişikliklerini canlı izler
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.siparis;
alter publication supabase_realtime add table public.siparis_kalemi;

-- ---------------------------------------------------------------------------
-- Faz 4 notu (şimdi YAZILMAZ): sadakat_hesabi, puan_hareketi, kampanya
-- tabloları online ödeme + Müşteri App fazında bu şemaya eklenecek.
-- ---------------------------------------------------------------------------

-- Örnek tohum (kendi kafen için; değerleri düzenleyip SQL Editor'de çalıştır):
-- insert into public.cafe (ad, slug) values ('Kafem', 'kafem');
-- insert into public.bolum (cafe_id, ad) select id, 'Salon' from public.cafe where slug = 'kafem';
-- insert into public.masa (cafe_id, bolum_id, ad)
--   select c.id, b.id, 'Masa ' || n
--   from public.cafe c, public.bolum b, generate_series(1, 10) n
--   where c.slug = 'kafem' and b.cafe_id = c.id;
