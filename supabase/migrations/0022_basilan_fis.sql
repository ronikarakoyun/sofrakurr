-- Fiş baskı durumunu kalıcı ve istasyon bazında tut: yazıcı ajanı hangi
-- siparişin hangi istasyonunu bastığını buradan bilir. Böylece (a) ajan yeniden
-- başlasa da kaçan fiş basılır, (b) bir yazıcı arızalıysa sadece o istasyon
-- tekrar denenir (çalışan yazıcıya duplikat çıkmaz), (c) geçici sorgu hatası
-- fişi kalıcı yutmaz.

create table public.basilan_fis (
  siparis_id uuid not null references public.siparis(id) on delete cascade,
  istasyon   text not null,
  cafe_id    uuid not null references public.cafe(id) on delete cascade,
  basildi_at timestamptz not null default now(),
  primary key (siparis_id, istasyon)
);

create index on public.basilan_fis (cafe_id, basildi_at);

alter table public.basilan_fis enable row level security;
-- Yalnız kafenin personeli (ajan = mutfak hesabı) kendi kayıtlarını görür/yazar
create policy personel_basilan_fis on public.basilan_fis
  for all using (cafe_id = public.aktif_cafe_id());
