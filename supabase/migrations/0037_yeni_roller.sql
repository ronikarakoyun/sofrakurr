-- ============================================================================
-- 0037: Yeni roller — franchise (zincir sahibi) ve super_admin (platform sahibi)
-- NOT: Postgres kuralı gereği enum'a değer ekleme AYRI çalıştırılmalıdır;
-- bu dosyayı tek başına Run'layın, ardından 0038'i ayrıca Run'layın.
-- ============================================================================

alter type public.kullanici_rol add value if not exists 'franchise';
alter type public.kullanici_rol add value if not exists 'super_admin';
