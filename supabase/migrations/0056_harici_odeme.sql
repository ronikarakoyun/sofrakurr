-- ============================================================================
-- 0056 — 'harici' ödeme türü (Faz 7 M1)
--
-- App-only dönüşümün ilk adımı: kasadan ödeme kalkıyor; adisyonlar teslimde
-- otomatik kapanacak ve tahsilat sistem DIŞINDA yapıldığı için ödeme türü
-- 'harici' olarak işaretlenecek (0057'deki trigger kullanır). İleride online
-- ödeme geldiğinde 'online' kardeş değeri eklenecek.
--
-- DİKKAT: ALTER TYPE ... ADD VALUE, eklendiği transaction içinde
-- KULLANILAMAZ. Bu yüzden bu migration tek başına bir dosyadır — 0057 ile
-- birleştirilirse zincir taze kurulumda patlar.
-- ============================================================================

alter type public.odeme_turu_tip add value if not exists 'harici';
