-- ============================================================================
-- 0054: Entegrasyon api anahtar/secret'ı düz metin OKUNAMAZ (güvenlik — düşük)
--
-- cafe_entegrasyon.api_secret / api_anahtar, admin'e entegrasyon_admin policy'si
-- üzerinden tam SELECT açıktı → admin kendi kafesinin sırrını doğrudan API'den
-- düz metin çekebiliyordu (uygulama zaten maskeli view kullanıyor; bu yalnız
-- doğrudan-API yolunu kapatır — kiracı-içi, defense-in-depth).
--
-- Çözüm: kolon-seviyesi SELECT revoke + maskeli özet view'ı definer yap
-- (revoke edilen kolonları maskelemek için okuyabilsin) + açık kiracı filtresi
-- (definer RLS'i atladığından). Yazma (upsert) etkilenmez — yalnız SELECT.
-- okc_anahtar (0035) zaten policy'siz cafe_gizli'de; bu, entegrasyon için de
-- aynı "sır istemciye inmez" güvencesini kurar.
-- ============================================================================

-- Tablo-seviyesi SELECT tüm kolonları kapsar; kolon-revoke onu EZMEZ. Doğru
-- yol: tablo SELECT'i kaldır, yalnız sır-olmayan kolonlara SELECT ver.
-- (INSERT/UPDATE dokunulmaz → upsert ile yazma sürer)
revoke select on public.cafe_entegrasyon from authenticated;
grant select (cafe_id, platform, satici_no, aktif, updated_at)
  on public.cafe_entegrasyon to authenticated;

create or replace view public.cafe_entegrasyon_ozet with (security_invoker = false) as
select
  cafe_id,
  platform,
  satici_no,
  (api_anahtar is not null and length(api_anahtar) > 0) as anahtar_var,
  (api_secret is not null and length(api_secret) > 0) as secret_var,
  right(coalesce(api_anahtar, ''), 4) as anahtar_son4,
  aktif,
  updated_at
from public.cafe_entegrasyon
where cafe_id = public.aktif_cafe_id();
