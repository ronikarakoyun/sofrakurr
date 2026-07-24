-- ============================================================================
-- 0055: Hata izleme — kendi Supabase log'u (hata_log)
--
-- Canlıda kasa/KDS/admin bir hata alınca panelde görünür. İstemci hataları
-- /api/hata route'undan (service_role), sunucu hataları instrumentation.ts
-- onRequestError'dan yazılır. İstemci DOĞRUDAN yazamaz (yalnız service_role).
--
-- Okuma: super_admin tümünü (giriş öncesi cafe_id=null hatalar dahil), kafe
-- yöneticisi yalnız kendi kafesininkini görür.
-- ============================================================================

create table public.hata_log (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid references public.cafe(id) on delete set null, -- giriş öncesi null
  kullanici_id uuid,          -- auth.uid (varsa)
  ortam        text,          -- kasa|kds|admin|panel|qr|giris|api|sunucu
  tur          text,          -- client|unhandledrejection|boundary|server
  mesaj        text not null,
  yig          text,          -- stack trace
  url          text,
  tarayici     text,          -- user agent
  created_at   timestamptz not null default now()
);

create index on public.hata_log (created_at desc);
create index on public.hata_log (cafe_id, created_at desc);

alter table public.hata_log enable row level security;

-- Yazma yalnız service_role (API + instrumentation) — istemci doğrudan yazamaz
revoke insert, update, delete on public.hata_log from authenticated, anon;

-- Okuma: super_admin hepsi; kafe yöneticisi (admin + maskeli franchise/super)
-- kendi efektif kafesininki
create policy hata_super on public.hata_log
  for select using (public.gercek_rol() = 'super_admin');
create policy hata_kafe on public.hata_log
  for select using (cafe_id = public.aktif_cafe_id());

grant select on public.hata_log to authenticated;

-- Panel görünümü: rol kapsamlı hata listesi (kafe/kullanıcı adıyla). super_admin
-- başka kafelerin adını RLS join'le çözemeyeceğinden definer RPC kullanılır.
create function public.hata_listesi(p_limit int default 100)
returns table (
  id uuid, cafe_ad text, kullanici_ad text, ortam text, tur text,
  mesaj text, yig text, url text, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as
$$
declare
  v_rol public.kullanici_rol := public.gercek_rol();
  v_zincir uuid;
begin
  if v_rol not in ('super_admin', 'franchise', 'admin') then
    raise exception 'Bu işlem için yönetici girişi gerekli';
  end if;
  if v_rol = 'franchise' then
    select zincir_id into v_zincir from public.kullanici where id = auth.uid();
  end if;
  return query
  select h.id, c.ad, k.ad, h.ortam, h.tur, h.mesaj, h.yig, h.url, h.created_at
  from public.hata_log h
  left join public.cafe c on c.id = h.cafe_id
  left join public.kullanici k on k.id = h.kullanici_id
  where
    v_rol = 'super_admin'
    or (v_rol = 'franchise' and c.zincir_id = v_zincir)
    or (v_rol = 'admin' and h.cafe_id = public.aktif_cafe_id())
  order by h.created_at desc
  limit least(coalesce(p_limit, 100), 500);
end
$$;

grant execute on function public.hata_listesi(int) to authenticated;

-- Bakım: 30 günden eski hata kayıtlarını temizle (tablo sınırsız büyümesin)
create or replace function public.bakim_temizlik() returns void
language plpgsql security definer set search_path = public as
$$
begin
  update public.siparis set durum = 'iptal'
    where durum = 'odeme_bekliyor' and created_at < now() - interval '12 hours';
  update public.siparis set durum = 'teslim'
    where durum = 'hazir' and updated_at < now() - interval '24 hours';
  delete from public.masa_oturumu where bitis < now() - interval '2 days';
  delete from public.garson_cagri where not acik and created_at < now() - interval '2 days';
  delete from public.yazdirma_kuyrugu where durum = 'basildi' and created_at < now() - interval '7 days';
  delete from public.basilan_fis where basildi_at < now() - interval '7 days';
  delete from public.hata_log where created_at < now() - interval '30 days';
end
$$;
