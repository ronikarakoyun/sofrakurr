-- ============================================================================
-- 0031: Sadakat programı (Müşteri Uygulaması Faz 4 — M1)
--   sadakat_hesabi  : kafe × müşteri puan bakiyesi
--   puan_hareketi   : kazanım / harcama / düzeltme kayıtları
--                     (adisyon başına TEK kazanım — çift puan guard'ı)
--   odul            : puanla alınabilen ödüller (admin tanımlar)
--   kampanya        : push kampanya kayıtları (gönderim M5'te)
--   expo_push_token : müşteri cihaz push token'ları
-- Kasiyer müşteriyi RLS ile göremez (müşterinin cafe_id'si yok) — bu yüzden
-- puan RPC'leri security definer olup rolü İÇERİDE doğrular.
-- adisyon_kapat imzasına BİLEREK dokunulmaz; puan işleme ayrı, additive RPC.
-- ============================================================================

-- Kafe ayarları: sadakat açık mı, 1 TL kaç puan
alter table public.cafe
  add column sadakat_aktif boolean not null default true,
  add column puan_carpani numeric(6,2) not null default 1.0
    check (puan_carpani >= 0);

-- Müşterinin kasada okutacağı kişisel kod (uygulamadaki QR'ın içeriği).
-- 8 hex karakter; unique kısıtı olası (çok düşük) çakışmayı yakalar.
alter table public.kullanici
  add column musteri_kod text unique
    default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

-- ---------------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------------
create table public.sadakat_hesabi (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references public.cafe(id) on delete cascade,
  kullanici_id uuid not null references public.kullanici(id) on delete cascade,
  puan_bakiye  int not null default 0 check (puan_bakiye >= 0),
  created_at   timestamptz not null default now(),
  unique (cafe_id, kullanici_id)
);

create index on public.sadakat_hesabi (kullanici_id);

create table public.odul (
  id          uuid primary key default gen_random_uuid(),
  cafe_id     uuid not null references public.cafe(id) on delete cascade,
  ad          text not null,
  puan_bedeli int not null check (puan_bedeli > 0),
  urun_id     uuid references public.urun(id) on delete set null,
  aktif       boolean not null default true,
  sira        int not null default 0
);

create index on public.odul (cafe_id);

create type public.puan_hareket_tur as enum ('kazanim', 'harcama', 'duzeltme');

create table public.puan_hareketi (
  id                uuid primary key default gen_random_uuid(),
  cafe_id           uuid not null references public.cafe(id) on delete cascade,
  sadakat_hesabi_id uuid not null references public.sadakat_hesabi(id) on delete cascade,
  adisyon_id        uuid references public.adisyon(id) on delete set null,
  odul_id           uuid references public.odul(id) on delete set null,
  tur               public.puan_hareket_tur not null,
  puan              int not null, -- kazanım +, harcama −
  aciklama          text,
  olusturan_id      uuid references public.kullanici(id) on delete set null, -- kasiyer
  created_at        timestamptz not null default now()
);

create index on public.puan_hareketi (sadakat_hesabi_id, created_at desc);
create index on public.puan_hareketi (cafe_id, created_at desc);
-- Çift puan guard'ı: bir adisyona yalnız bir kazanım işlenebilir
create unique index puan_tek_kazanim on public.puan_hareketi (adisyon_id)
  where tur = 'kazanim';

create table public.kampanya (
  id              uuid primary key default gen_random_uuid(),
  cafe_id         uuid not null references public.cafe(id) on delete cascade,
  baslik          text not null,
  govde           text not null,
  durum           text not null default 'taslak' check (durum in ('taslak', 'gonderildi')),
  gonderim_zamani timestamptz,
  gonderilen_adet int,
  olusturan_id    uuid references public.kullanici(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index on public.kampanya (cafe_id, created_at desc);

create table public.expo_push_token (
  id           uuid primary key default gen_random_uuid(),
  kullanici_id uuid not null references public.kullanici(id) on delete cascade,
  token        text not null unique, -- ExponentPushToken[...]
  platform     text check (platform in ('ios', 'android')),
  created_at   timestamptz not null default now(),
  son_gorulme  timestamptz not null default now()
);

create index on public.expo_push_token (kullanici_id);

-- ---------------------------------------------------------------------------
-- RLS: müşteri kendi verisini okur; personel kendi kafesini.
-- Puan YAZMA yalnız RPC'lerden (tabloya doğrudan yazma policy'si yok).
-- ---------------------------------------------------------------------------
alter table public.sadakat_hesabi enable row level security;
alter table public.puan_hareketi enable row level security;
alter table public.odul enable row level security;
alter table public.kampanya enable row level security;
alter table public.expo_push_token enable row level security;

create policy sadakat_hesabi_musteri on public.sadakat_hesabi
  for select using (kullanici_id = auth.uid());
create policy sadakat_hesabi_personel on public.sadakat_hesabi
  for select using (cafe_id = public.aktif_cafe_id());

create policy puan_hareketi_musteri on public.puan_hareketi
  for select using (exists (
    select 1 from public.sadakat_hesabi h
    where h.id = sadakat_hesabi_id and h.kullanici_id = auth.uid()
  ));
create policy puan_hareketi_personel on public.puan_hareketi
  for select using (cafe_id = public.aktif_cafe_id());

-- Ödülleri uygulamadaki her müşteri görebilir (menü gibi vitrin verisi)
create policy odul_okuma on public.odul
  for select to authenticated using (aktif);
create policy odul_admin on public.odul
  for all using (cafe_id = public.aktif_cafe_id()
                 and public.rol_var(array['admin']::public.kullanici_rol[]))
  with check (cafe_id = public.aktif_cafe_id()
              and public.rol_var(array['admin']::public.kullanici_rol[]));

create policy kampanya_admin on public.kampanya
  for all using (cafe_id = public.aktif_cafe_id()
                 and public.rol_var(array['admin']::public.kullanici_rol[]))
  with check (cafe_id = public.aktif_cafe_id()
              and public.rol_var(array['admin']::public.kullanici_rol[]));

create policy push_token_sahibi on public.expo_push_token
  for all using (kullanici_id = auth.uid())
  with check (kullanici_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RPC: musteri_kayit — ilk Google/Apple girişinden sonra uygulama çağırır.
-- auth.users trigger'ı BİLEREK kullanılmıyor (/api/personel kendi insert'ini
-- yapıyor; trigger onunla yarışırdı). on conflict: personel hesabıyla app'e
-- girilse bile rol EZİLMEZ.
-- ---------------------------------------------------------------------------
create function public.musteri_kayit() returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  v_ad text;
  v_kayit public.kullanici%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Giriş gerekli';
  end if;

  select coalesce(
      raw_user_meta_data->>'full_name',
      raw_user_meta_data->>'name',
      split_part(email, '@', 1)
    ) into v_ad
  from auth.users where id = auth.uid();

  insert into public.kullanici (id, rol, ad)
  values (auth.uid(), 'musteri', v_ad)
  on conflict (id) do nothing;

  select * into v_kayit from public.kullanici where id = auth.uid();
  if v_kayit.aktif = false then
    raise exception 'Hesap pasif';
  end if;
  return jsonb_build_object(
    'ad', v_kayit.ad,
    'rol', v_kayit.rol,
    'musteri_kod', v_kayit.musteri_kod
  );
end
$$;

grant execute on function public.musteri_kayit() to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: sadakat_puan_isle — kasiyer, adisyon kapanırken müşteri kodunu okutur.
-- Tutar adisyon_tutarlari view'ından (ikram 0, iskonto düşülmüş) alınır.
-- ---------------------------------------------------------------------------
create function public.sadakat_puan_isle(p_adisyon_id uuid, p_musteri_kod text)
returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  v_cafe public.cafe%rowtype;
  v_musteri public.kullanici%rowtype;
  v_hesap_id uuid;
  v_tutar numeric(10,2);
  v_puan int;
  v_bakiye int;
begin
  if not public.rol_var(array['admin','kasa','garson']::public.kullanici_rol[]) then
    raise exception 'Bu işlem için kasa yetkisi gerekli';
  end if;

  select * into v_cafe from public.cafe where id = public.aktif_cafe_id();
  if not v_cafe.sadakat_aktif then
    raise exception 'Sadakat programı bu kafede kapalı';
  end if;

  select tutar into v_tutar from public.adisyon_tutarlari
    where adisyon_id = p_adisyon_id and cafe_id = v_cafe.id;
  if v_tutar is null then
    raise exception 'Adisyon bulunamadı';
  end if;
  if v_tutar <= 0 then
    raise exception 'Bu hesabın puanlanacak tutarı yok';
  end if;

  select * into v_musteri from public.kullanici
    where musteri_kod = upper(trim(p_musteri_kod)) and rol = 'musteri' and aktif;
  if not found then
    raise exception 'Müşteri kodu bulunamadı: %', upper(trim(p_musteri_kod));
  end if;

  insert into public.sadakat_hesabi (cafe_id, kullanici_id)
  values (v_cafe.id, v_musteri.id)
  on conflict (cafe_id, kullanici_id) do nothing;

  select id into v_hesap_id from public.sadakat_hesabi
    where cafe_id = v_cafe.id and kullanici_id = v_musteri.id;

  v_puan := floor(v_tutar * v_cafe.puan_carpani);
  if v_puan <= 0 then
    raise exception 'Bu tutar için puan oluşmuyor';
  end if;

  begin
    insert into public.puan_hareketi
      (cafe_id, sadakat_hesabi_id, adisyon_id, tur, puan, aciklama, olusturan_id)
    values
      (v_cafe.id, v_hesap_id, p_adisyon_id, 'kazanim', v_puan,
       'Hesap: ' || v_tutar || ' TL', auth.uid());
  exception when unique_violation then
    raise exception 'Bu hesaba puan zaten işlenmiş';
  end;

  update public.sadakat_hesabi
    set puan_bakiye = puan_bakiye + v_puan
    where id = v_hesap_id
    returning puan_bakiye into v_bakiye;

  return jsonb_build_object(
    'musteri_ad', v_musteri.ad,
    'kazanilan', v_puan,
    'yeni_bakiye', v_bakiye
  );
end
$$;

grant execute on function public.sadakat_puan_isle(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: odul_kullan — kasiyer ödülü puan karşılığı düşer; ürünü mevcut İKRAM
-- akışıyla 0 TL hesaba yazar (v1'de otomasyon bilinçli olarak yok).
-- ---------------------------------------------------------------------------
create function public.odul_kullan(p_musteri_kod text, p_odul_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  v_cafe_id uuid;
  v_musteri public.kullanici%rowtype;
  v_odul public.odul%rowtype;
  v_hesap public.sadakat_hesabi%rowtype;
  v_bakiye int;
begin
  if not public.rol_var(array['admin','kasa','garson']::public.kullanici_rol[]) then
    raise exception 'Bu işlem için kasa yetkisi gerekli';
  end if;
  v_cafe_id := public.aktif_cafe_id();

  select * into v_odul from public.odul
    where id = p_odul_id and cafe_id = v_cafe_id and aktif;
  if not found then
    raise exception 'Ödül bulunamadı veya pasif';
  end if;

  select * into v_musteri from public.kullanici
    where musteri_kod = upper(trim(p_musteri_kod)) and rol = 'musteri' and aktif;
  if not found then
    raise exception 'Müşteri kodu bulunamadı: %', upper(trim(p_musteri_kod));
  end if;

  select * into v_hesap from public.sadakat_hesabi
    where cafe_id = v_cafe_id and kullanici_id = v_musteri.id;
  if not found or v_hesap.puan_bakiye < v_odul.puan_bedeli then
    raise exception 'Puan yetersiz (bakiye: %, gereken: %)',
      coalesce(v_hesap.puan_bakiye, 0), v_odul.puan_bedeli;
  end if;

  insert into public.puan_hareketi
    (cafe_id, sadakat_hesabi_id, odul_id, tur, puan, aciklama, olusturan_id)
  values
    (v_cafe_id, v_hesap.id, v_odul.id, 'harcama', -v_odul.puan_bedeli,
     'Ödül: ' || v_odul.ad, auth.uid());

  update public.sadakat_hesabi
    set puan_bakiye = puan_bakiye - v_odul.puan_bedeli
    where id = v_hesap.id
    returning puan_bakiye into v_bakiye;

  return jsonb_build_object(
    'musteri_ad', v_musteri.ad,
    'odul_ad', v_odul.ad,
    'harcanan', v_odul.puan_bedeli,
    'yeni_bakiye', v_bakiye
  );
end
$$;

grant execute on function public.odul_kullan(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: musteri_ozet — uygulama ana ekranı: kod + kafe bazlı bakiyeler +
-- son hareketler. (Müşteri cafe tablosunu RLS'le göremediği için kafe adları
-- burada definer ile join'lenir.)
-- ---------------------------------------------------------------------------
create function public.musteri_ozet() returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  v_kayit public.kullanici%rowtype;
begin
  select * into v_kayit from public.kullanici
    where id = auth.uid() and rol = 'musteri' and aktif;
  if not found then
    raise exception 'Müşteri kaydı bulunamadı';
  end if;

  return jsonb_build_object(
    'ad', v_kayit.ad,
    'musteri_kod', v_kayit.musteri_kod,
    'hesaplar', coalesce((
      select jsonb_agg(jsonb_build_object(
        'cafe_id', h.cafe_id,
        'cafe_ad', c.ad,
        'puan_bakiye', h.puan_bakiye
      ) order by h.created_at)
      from public.sadakat_hesabi h
      join public.cafe c on c.id = h.cafe_id
      where h.kullanici_id = v_kayit.id
    ), '[]'::jsonb),
    'hareketler', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
          'cafe_ad', c.ad,
          'tur', p.tur,
          'puan', p.puan,
          'aciklama', p.aciklama,
          'tarih', p.created_at
        ) as x
        from public.puan_hareketi p
        join public.sadakat_hesabi h on h.id = p.sadakat_hesabi_id
        join public.cafe c on c.id = p.cafe_id
        where h.kullanici_id = v_kayit.id
        order by p.created_at desc
        limit 20
      ) son
    ), '[]'::jsonb)
  );
end
$$;

grant execute on function public.musteri_ozet() to authenticated;
