-- Yemek platformu entegrasyon anahtarları (kafe başına). Şimdilik yalnız
-- saklama + admin giriş ekranı; sipariş çekme webhook'u gerçek anahtar gelince
-- eklenecek. Anahtarlar hassas: RLS yalnız o kafenin admini; okuma için maskeli
-- özet view (tam sır tarayıcıya inmez).

create table public.cafe_entegrasyon (
  cafe_id     uuid not null references public.cafe(id) on delete cascade,
  platform    text not null check (platform in ('trendyol_go', 'yemeksepeti', 'migros')),
  satici_no   text,
  api_anahtar text,
  api_secret  text,
  aktif       boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (cafe_id, platform)
);

alter table public.cafe_entegrasyon enable row level security;
-- Yalnız o kafenin admini görebilir/yazabilir
create policy entegrasyon_admin on public.cafe_entegrasyon
  for all
  using (cafe_id = public.aktif_cafe_id() and public.rol_var(array['admin']::public.kullanici_rol[]))
  with check (cafe_id = public.aktif_cafe_id() and public.rol_var(array['admin']::public.kullanici_rol[]));

-- Maskeli özet: sayfa bunu okur; tam anahtar/secret tarayıcıya inmez
create view public.cafe_entegrasyon_ozet with (security_invoker = true) as
select
  cafe_id,
  platform,
  satici_no,
  (api_anahtar is not null and length(api_anahtar) > 0) as anahtar_var,
  (api_secret is not null and length(api_secret) > 0) as secret_var,
  right(coalesce(api_anahtar, ''), 4) as anahtar_son4,
  aktif,
  updated_at
from public.cafe_entegrasyon;
