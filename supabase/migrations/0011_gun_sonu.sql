-- Gün sonu kasası: gün içi giderler + günlük kapanış (mutabakat) kaydı.

-- Kasadan yapılan harcamalar (sütçüye nakit, sarf malzeme vb.)
create table public.gider (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references public.cafe(id) on delete cascade,
  tutar        numeric(10,2) not null check (tutar > 0),
  aciklama     text not null,
  odeme_turu   public.odeme_turu_tip not null default 'nakit',
  kullanici_id uuid references public.kullanici(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index on public.gider (cafe_id, created_at);

-- Günlük kapanış kaydı: o günün beklenen/sayılan anlık görüntüsü donar
create table public.gun_sonu (
  id             uuid primary key default gen_random_uuid(),
  cafe_id        uuid not null references public.cafe(id) on delete cascade,
  tarih          date not null,
  acilis_nakit   numeric(10,2) not null default 0,
  beklenen_nakit numeric(10,2) not null default 0,
  beklenen_kart  numeric(10,2) not null default 0,
  sayilan_nakit  numeric(10,2) not null default 0,
  sayilan_kart   numeric(10,2) not null default 0,
  devir_nakit    numeric(10,2) not null default 0,
  notu           text,
  created_at     timestamptz not null default now(),
  unique (cafe_id, tarih)
);

alter table public.gider enable row level security;
alter table public.gun_sonu enable row level security;
create policy personel_gider on public.gider
  for all using (cafe_id = public.aktif_cafe_id());
create policy personel_gun_sonu on public.gun_sonu
  for all using (cafe_id = public.aktif_cafe_id());
