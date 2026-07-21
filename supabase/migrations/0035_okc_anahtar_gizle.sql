-- ============================================================================
-- 0035: ÖKC anahtarını gizli tabloya taşı (GÜVENLİK DÜZELTMESİ)
--   0029 anahtarı cafe tablosuna koymuştu; cafe'de anonim vitrin okuma
--   policy'si olduğu için (QR menü akışı) anahtar üretildiği an herkese
--   açık olacaktı. Anahtar, hiçbir RLS policy'si olmayan cafe_gizli
--   tablosuna taşınır: yalnız security definer RPC'ler ve servis anahtarı
--   (API route'ları) erişebilir — app_ayar/webhook_secret deseniyle aynı.
-- ============================================================================

create table public.cafe_gizli (
  cafe_id     uuid primary key references public.cafe(id) on delete cascade,
  okc_anahtar text unique
);

alter table public.cafe_gizli enable row level security;
-- policy YOK + doğrudan erişim yetkisi YOK: anon/authenticated hiçbir şekilde okuyamaz
revoke all on public.cafe_gizli from anon, authenticated;

-- Üretilmiş anahtar varsa taşı (bugün itibarıyla yok; yine de güvenli davran)
insert into public.cafe_gizli (cafe_id, okc_anahtar)
  select id, okc_anahtar from public.cafe where okc_anahtar is not null
  on conflict (cafe_id) do update set okc_anahtar = excluded.okc_anahtar;

-- Açık kolonu kaldır (bağlı unique index de birlikte düşer)
alter table public.cafe drop column if exists okc_anahtar;

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
  insert into public.cafe_gizli (cafe_id, okc_anahtar)
  values (v_cafe, v_anahtar)
  on conflict (cafe_id) do update set okc_anahtar = excluded.okc_anahtar;
  return v_anahtar;
end
$$;
revoke execute on function public.okc_anahtar_uret() from public;
grant execute on function public.okc_anahtar_uret() to authenticated;

-- Maskeli durum: yalnız admin görür (gizli tabloyu definer okur)
create or replace function public.okc_durum() returns table (tanimli boolean, son4 text)
language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.rol_var(array['admin']::public.kullanici_rol[]) then
    raise exception 'Bu işlem için admin girişi gerekli';
  end if;
  return query
    select (g.okc_anahtar is not null), right(coalesce(g.okc_anahtar, ''), 4)
    from public.cafe c
    left join public.cafe_gizli g on g.cafe_id = c.id
    where c.id = public.aktif_cafe_id();
end
$$;
revoke execute on function public.okc_durum() from public;
grant execute on function public.okc_durum() to authenticated;
