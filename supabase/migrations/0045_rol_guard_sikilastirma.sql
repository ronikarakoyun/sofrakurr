-- ============================================================================
-- 0045: rol_var() null güvenliği (savunma katmanı sıkılaştırması)
--
-- SORUN: rol_var(), aktif_rol() null döndüğünde (oturumsuz/anon çağrı, pasif
-- hesap) `null = any(...)` → NULL veriyordu. Çağıran taraftaki
--   if not public.rol_var(...) then raise ...
-- kalıbında `not null` = NULL olduğundan guard ATLANIYORDU.
--
-- Pratik sızıntı yok: bu RPC'lerin devamı aktif_cafe_id() üzerinden çalıştığı
-- için oturumsuz çağrı hiçbir kafeye ulaşamıyor ("Adisyon bulunamadı" gibi
-- ikinci savunmaya takılıyordu). Yine de yetki kapısı ilk adımda kapanmalı:
-- coalesce ile null → false.
--
-- Etki: yalnız null durumu değişir; giriş yapmış personelin davranışı aynı.
-- ============================================================================

create or replace function public.rol_var(p_roller public.kullanici_rol[])
returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(public.aktif_rol() = any(p_roller), false) $$;

-- yetki_var da aynı desende: aktif_rol() null iken 'admin' karşılaştırması
-- null vermesin (else dalındaki coalesce zaten false veriyordu, burada
-- ilk daldaki null'ı da kapatıyoruz)
create or replace function public.yetki_var(p_kod text) returns boolean
language sql stable security definer set search_path = public as
$$
  select case
    when coalesce(public.aktif_rol() = 'admin', false) then true
    else coalesce((
      select coalesce((u.yetkiler ->> p_kod)::boolean, true)
      from public.kullanici u where u.id = auth.uid() and u.aktif
    ), false)
  end
$$;
