-- Adisyon yazdırma kuyruğu: kasadan "Adisyon Yazdır" denince buraya bir satır
-- düşer; kafedeki yazıcı ajanı canlı dinler, tezgah/hesap yazıcısından fişi
-- basar ve satırı 'basildi' yapar. (Fiş bilgi fişidir — mali değeri yoktur.)

create table public.yazdirma_kuyrugu (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references public.cafe(id) on delete cascade,
  adisyon_id   uuid not null references public.adisyon(id) on delete cascade,
  tip          text not null default 'adisyon' check (tip in ('adisyon')),
  durum        text not null default 'bekliyor' check (durum in ('bekliyor', 'basildi')),
  kullanici_id uuid references public.kullanici(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index on public.yazdirma_kuyrugu (cafe_id, durum, created_at);

alter table public.yazdirma_kuyrugu enable row level security;
create policy personel_yazdirma on public.yazdirma_kuyrugu
  for all using (cafe_id = public.aktif_cafe_id());

alter publication supabase_realtime add table public.yazdirma_kuyrugu;
