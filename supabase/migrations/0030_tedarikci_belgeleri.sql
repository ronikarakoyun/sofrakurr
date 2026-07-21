-- ============================================================================
-- 0030: Tedarikçi belgeleri (gelen fatura girişi, kasadan)
--   tedarikci_fatura : belge başlığı (tedarikçi adı, fatura no, tarih)
--   Kalemler mevcut hammadde_giris tablosuna bağlanır — stok artışı ve
--   birim maliyet güncellemesi 0004'teki hammadde_giris_isle trigger'ında
--   zaten var, bu yüzden fatura kalemi girildiğinde stok otomatik artar.
--   Ayrıca kasa rolüne hammadde okuma/yazma yetkisi verilir (0025 yalnız
--   admin yapmıştı); sayım admin'de kalır.
-- ============================================================================

create table public.tedarikci_fatura (
  id            uuid primary key default gen_random_uuid(),
  cafe_id       uuid not null references public.cafe(id) on delete cascade,
  tedarikci_ad  text not null,
  fatura_no     text,
  tarih         date not null default current_date,
  aciklama      text,
  created_at    timestamptz not null default now()
);

create index on public.tedarikci_fatura (cafe_id, tarih desc);

alter table public.tedarikci_fatura enable row level security;

create policy tedarikci_fatura_kasa on public.tedarikci_fatura
  for all
  using (cafe_id = public.aktif_cafe_id()
         and public.rol_var(array['admin','kasa']::public.kullanici_rol[]))
  with check (cafe_id = public.aktif_cafe_id()
              and public.rol_var(array['admin','kasa']::public.kullanici_rol[]));

-- Fatura kalemi = hammadde_giris satırı. Belge silinmesi yanlışlıkla stok
-- kaydırmasın diye restrict (arşiv belgesi silinmez).
alter table public.hammadde_giris
  add column tedarikci_fatura_id uuid references public.tedarikci_fatura(id) on delete restrict;

create index on public.hammadde_giris (tedarikci_fatura_id)
  where tedarikci_fatura_id is not null;

-- Hammadde: okuma tüm kafe personeli, yazma admin + kasa
do $$
declare t text;
begin
  foreach t in array array['hammadde','hammadde_giris'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format($f$create policy %I on public.%I for select
      using (cafe_id = public.aktif_cafe_id())$f$,
      t || '_oku', t);
    execute format($f$create policy %I on public.%I for all
      using (cafe_id = public.aktif_cafe_id()
             and public.rol_var(array['admin','kasa']::public.kullanici_rol[]))
      with check (cafe_id = public.aktif_cafe_id()
                  and public.rol_var(array['admin','kasa']::public.kullanici_rol[]))$f$,
      t || '_yaz', t);
  end loop;
end $$;
