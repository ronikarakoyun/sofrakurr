-- ============================================================================
-- Faz 2 ek: Reçete bazlı stok
--   hammadde        : süt (ml), kahve çekirdeği (gr) gibi bileşenler
--   hammadde_giris  : faturadan alış kaydı -> stok artar, birim maliyet tutulur
--   recete          : ürün başına bileşen miktarları (Latte = 200 ml süt + 18 gr çekirdek)
-- Sipariş kalemi yazıldığında reçetedeki miktarlar otomatik düşer; iptal/redde iade.
-- Hammadde stoğu uyarı amaçlıdır: eksiye düşebilir, satışı engellemez
-- (vitrin ürünlerindeki adet takibi ise satışı keser — iki sistem birlikte çalışır).
-- ============================================================================

create type public.hammadde_birim as enum ('gr', 'ml', 'adet');

create table public.hammadde (
  id             uuid primary key default gen_random_uuid(),
  cafe_id        uuid not null references public.cafe(id) on delete cascade,
  ad             text not null,
  birim          public.hammadde_birim not null default 'gr',
  stok_miktar    numeric(12,2) not null default 0,
  kritik_seviye  numeric(12,2) not null default 0,
  -- son alıştan türetilen birim maliyet (₺/gr, ₺/ml, ₺/adet)
  son_birim_fiyat numeric(12,4),
  created_at     timestamptz not null default now()
);

create index on public.hammadde (cafe_id);

create table public.hammadde_giris (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references public.cafe(id) on delete cascade,
  hammadde_id  uuid not null references public.hammadde(id) on delete cascade,
  miktar       numeric(12,2) not null check (miktar > 0),
  toplam_tutar numeric(12,2) not null default 0 check (toplam_tutar >= 0),
  aciklama     text,
  created_at   timestamptz not null default now()
);

create index on public.hammadde_giris (cafe_id, hammadde_id);

create table public.recete (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references public.cafe(id) on delete cascade,
  urun_id      uuid not null references public.urun(id) on delete cascade,
  hammadde_id  uuid not null references public.hammadde(id) on delete cascade,
  miktar       numeric(12,2) not null check (miktar > 0),
  unique (urun_id, hammadde_id)
);

create index on public.recete (urun_id);

alter table public.hammadde enable row level security;
alter table public.hammadde_giris enable row level security;
alter table public.recete enable row level security;

create policy personel_hammadde on public.hammadde
  for all using (cafe_id = public.aktif_cafe_id());
create policy personel_hammadde_giris on public.hammadde_giris
  for all using (cafe_id = public.aktif_cafe_id());
create policy personel_recete on public.recete
  for all using (cafe_id = public.aktif_cafe_id());

-- Alış girişi kaydedilince stok artar, birim maliyet güncellenir
create function public.hammadde_giris_isle() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  update public.hammadde
  set stok_miktar = stok_miktar + new.miktar,
      son_birim_fiyat = case
        when new.toplam_tutar > 0 then round(new.toplam_tutar / new.miktar, 4)
        else son_birim_fiyat
      end
  where id = new.hammadde_id;
  return new;
end
$$;

create trigger hammadde_giris_stok
  after insert on public.hammadde_giris
  for each row execute function public.hammadde_giris_isle();

-- Sipariş kalemi -> reçete düşüşü (mevcut adet-bazlı stok_dus trigger'ı ile birlikte çalışır)
create function public.recete_dus() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  update public.hammadde h
  set stok_miktar = h.stok_miktar - r.miktar * new.adet
  from public.recete r
  where r.urun_id = new.urun_id and r.hammadde_id = h.id;
  return new;
end
$$;

create trigger siparis_kalemi_recete_dus
  after insert on public.siparis_kalemi
  for each row execute function public.recete_dus();

-- Kalem reddi -> reçete iadesi
create function public.recete_iade_kalem() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if new.reddedildi and not old.reddedildi then
    update public.hammadde h
    set stok_miktar = h.stok_miktar + r.miktar * new.adet
    from public.recete r
    where r.urun_id = new.urun_id and r.hammadde_id = h.id;
  end if;
  return new;
end
$$;

create trigger siparis_kalemi_recete_iade
  after update of reddedildi on public.siparis_kalemi
  for each row execute function public.recete_iade_kalem();

-- Sipariş iptal/red -> reddedilmemiş kalemlerin reçetesi iade edilir
create function public.recete_iade_siparis() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if new.durum in ('iptal', 'reddedildi') and old.durum not in ('iptal', 'reddedildi') then
    update public.hammadde h
    set stok_miktar = h.stok_miktar + t.toplam
    from (
      select r.hammadde_id, sum(r.miktar * k.adet) as toplam
      from public.siparis_kalemi k
      join public.recete r on r.urun_id = k.urun_id
      where k.siparis_id = new.id and not k.reddedildi
      group by r.hammadde_id
    ) t
    where h.id = t.hammadde_id;
  end if;
  return new;
end
$$;

create trigger siparis_recete_iade
  after update of durum on public.siparis
  for each row execute function public.recete_iade_siparis();
