-- Yazarkasa (ÖKC) bağlantısı — SofraKur tarafı: kafedeki yazarkasa POS'un
-- çağıracağı güvenli arayüz. Cihaz, kafeye özel bir anahtarla kimliğini
-- doğrular; /api/okc/hesaplar ile açık hesapları çeker, /api/okc/ode ile
-- ödemeyi bildirir. Cihaz üzerindeki uygulama SofraKur dışıdır (marka/entegratör).

create extension if not exists pgcrypto;

alter table public.cafe add column if not exists okc_anahtar text;
create unique index if not exists cafe_okc_anahtar_key
  on public.cafe (okc_anahtar) where okc_anahtar is not null;

-- Admin, kafe için ÖKC bağlantı anahtarı üretir (cihaza girilecek değer)
create or replace function public.okc_anahtar_uret() returns text
language plpgsql security definer set search_path = public as
$$
declare
  v_cafe uuid := public.aktif_cafe_id();
  v_anahtar text;
begin
  if v_cafe is null or not (public.aktif_rol() = 'admin') then
    raise exception 'Bu işlem için admin girişi gerekli';
  end if;
  v_anahtar := 'okc_' || encode(gen_random_bytes(18), 'hex');
  update public.cafe set okc_anahtar = v_anahtar where id = v_cafe;
  return v_anahtar;
end
$$;
revoke execute on function public.okc_anahtar_uret() from public;
grant execute on function public.okc_anahtar_uret() to authenticated;

-- Anahtarın tanımlı olup olmadığını (maskeli) admin'e gösteren yardımcı
create or replace function public.okc_durum() returns table (tanimli boolean, son4 text)
language sql stable security invoker set search_path = public as
$$
  select (okc_anahtar is not null), right(coalesce(okc_anahtar, ''), 4)
  from public.cafe where id = public.aktif_cafe_id()
$$;
