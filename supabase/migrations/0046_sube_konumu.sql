-- ============================================================================
-- 0046: Şube konumu (Faz 5 — M7)
--
-- 100 şubeli zincirde müşteri doğru şubeyi bulabilmeli: uygulamada arama,
-- il/ilçe grubu ve (izin verirse) mesafeye göre sıralama.
--
-- Konum bilgisi vitrin verisidir — anon_cafe_okuma policy'si zaten tüm
-- kolonları açar, ayrı policy gerekmez (hassas veri cafe_gizli'de durur).
-- ============================================================================

alter table public.cafe
  add column il     text,
  add column ilce   text,
  add column adres  text,
  add column enlem  numeric(9,6),
  add column boylam numeric(9,6);

-- Uygulamanın "şehrimdeki şubeler" listesi için
create index cafe_il_idx on public.cafe (il) where aktif;
