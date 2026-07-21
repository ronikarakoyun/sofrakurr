-- ============================================================================
-- 0049: Rapor indeksleri (Faz 6 M6)
--
-- Raporların ana filtreleri için eksik indeksler. Bugün BUTİKEK tek kafe ve
-- tablolar küçük; ama zincir büyüdükçe (Gua ölçeği) rapor sorguları
-- adisyon/siparis üzerinde tam tarama yapardı. Ölçek kararı (plan K8):
-- ilk turda YALNIZ indeks; ön-toplama (materialized/rollup) ertelendi.
--
-- Not: rapor_urun sarmalayıcısının 5-kolon düzeltmesi (denetimin 3. bulgusu)
-- 0048'de (G7) yapıldı; burada tekrar edilmez.
--
-- create index if not exists → idempotent. Küçük tabloda kilit önemsiz;
-- büyük tabloda gerekirse ayrıca CONCURRENTLY ile elle kurulabilir.
-- ============================================================================

-- rapor_ozet (kapanan ciro) + rapor_gunluk + rapor_urun: hepsi
-- "durum='odendi' and kapanis in [aralık]" filtreler — bugün indekssiz.
create index if not exists idx_adisyon_odendi_kapanis
  on public.adisyon (cafe_id, kapanis)
  where durum = 'odendi';

-- rapor_saatlik + rapor_personel + rapor_ozet (geçerli sipariş sayısı):
-- "created_at in [aralık]" filtreler.
create index if not exists idx_siparis_cafe_created
  on public.siparis (cafe_id, created_at);

-- rapor_iptaller + rapor_ozet (iptal tutarı): iptal/red siparişlerini
-- updated_at ile tarar; kısmi indeks yalnız bu küçük alt kümeyi tutar.
create index if not exists idx_siparis_iptal_updated
  on public.siparis (cafe_id, updated_at)
  where durum in ('iptal', 'reddedildi');

-- rapor_urun: siparis_kalemi'ni siparis_id ile join eder, cafe_id ile RLS
-- filtreler. Mevcut (siparis_id) indeksine cafe_id öncüsü eklenir.
create index if not exists idx_kalem_cafe_siparis
  on public.siparis_kalemi (cafe_id, siparis_id);
