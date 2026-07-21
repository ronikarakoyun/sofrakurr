-- ============================================================================
-- 0039: Süper admin araçları — platform raporu + zincir yönetimi
--
-- Kafe ve franchise HESABI açma auth kullanıcısı gerektirdiğinden
-- /api/platform route'unda servis anahtarıyla yapılır. Buradaki RPC'ler:
--   platform_rapor       : kafe başına ciro (super: tümü, franchise: zinciri)
--   zincir_listesi       : zincirler + kafe/franchise sayıları (super)
--   zincir_olustur       : yeni zincir (super)
--   kafe_zincire_ata     : kafeyi zincire bağla/çöz (super)
--   kafe_zincir_listesi  : atama ekranı için kafe→zincir eşlemesi (super)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Platform raporu. Ciro tanımı raporlardaki (0005) ile aynı: kapanmış
-- (odendi) adisyonların geçerli kalem toplamı, kapanış tarihi aralıkta.
-- Yetkisiz çağrıda boş döner (cross join yetkili). security definer:
-- kafe-dışı veriye RLS izin vermez, kapsam sorgu içinde daraltılır.
-- ---------------------------------------------------------------------------
create function public.platform_rapor(p_baslangic timestamptz, p_bitis timestamptz)
returns table (
  cafe_id uuid,
  cafe_ad text,
  zincir_ad text,
  cafe_aktif boolean,
  ciro numeric,
  adisyon_sayisi bigint,
  siparis_sayisi bigint
)
language sql stable security definer set search_path = public as
$$
  with yetkili as (
    select u.rol, u.zincir_id
    from kullanici u
    where u.id = auth.uid() and u.aktif
      and u.rol in ('super_admin', 'franchise')
  )
  select
    c.id, c.ad, z.ad, c.aktif,
    coalesce(t.ciro, 0), coalesce(t.adisyon_sayisi, 0), coalesce(s.siparis_sayisi, 0)
  from cafe c
  cross join yetkili y
  left join zincir z on z.id = c.zincir_id
  left join lateral (
    select sum(at.tutar) as ciro, count(*) as adisyon_sayisi
    from adisyon_tutarlari at
    where at.cafe_id = c.id and at.durum = 'odendi'
      and at.kapanis >= p_baslangic and at.kapanis < p_bitis
  ) t on true
  left join lateral (
    select count(*) as siparis_sayisi
    from siparis sp
    where sp.cafe_id = c.id
      and sp.created_at >= p_baslangic and sp.created_at < p_bitis
      and sp.durum not in ('iptal', 'reddedildi')
  ) s on true
  where y.rol = 'super_admin'
     or (y.zincir_id is not null and c.zincir_id = y.zincir_id)
  order by coalesce(t.ciro, 0) desc, c.ad
$$;

grant execute on function public.platform_rapor(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Zincir yönetimi (yalnız süper admin)
-- ---------------------------------------------------------------------------
create function public.zincir_listesi()
returns table (id uuid, ad text, kafe_sayisi bigint, franchise_adlari text)
language sql stable security definer set search_path = public as
$$
  select
    z.id, z.ad,
    (select count(*) from cafe c where c.zincir_id = z.id),
    (select string_agg(u.ad, ', ' order by u.ad)
     from kullanici u where u.zincir_id = z.id and u.rol = 'franchise')
  from zincir z
  cross join (
    select 1 from kullanici
    where id = auth.uid() and aktif and rol = 'super_admin'
  ) g
  order by z.ad
$$;

grant execute on function public.zincir_listesi() to authenticated;

create function public.zincir_olustur(p_ad text) returns uuid
language plpgsql security definer set search_path = public as
$$
declare
  v_id uuid;
begin
  if public.gercek_rol() is distinct from 'super_admin' then
    raise exception 'Bu işlem için platform yöneticisi girişi gerekli';
  end if;
  if coalesce(trim(p_ad), '') = '' then
    raise exception 'Zincir adı gerekli';
  end if;
  insert into public.zincir (ad) values (trim(p_ad)) returning id into v_id;
  return v_id;
end
$$;

grant execute on function public.zincir_olustur(text) to authenticated;

-- p_zincir_id null → kafe zincirden çözülür (bağımsız kalır)
create function public.kafe_zincire_ata(p_cafe_id uuid, p_zincir_id uuid)
returns void
language plpgsql security definer set search_path = public as
$$
begin
  if public.gercek_rol() is distinct from 'super_admin' then
    raise exception 'Bu işlem için platform yöneticisi girişi gerekli';
  end if;
  if p_zincir_id is not null
     and not exists (select 1 from public.zincir where id = p_zincir_id) then
    raise exception 'Zincir bulunamadı';
  end if;
  update public.cafe set zincir_id = p_zincir_id where id = p_cafe_id;
  if not found then
    raise exception 'Kafe bulunamadı';
  end if;
end
$$;

grant execute on function public.kafe_zincire_ata(uuid, uuid) to authenticated;

-- Atama ekranı: kafe → zincir eşlemesi (id'li; erisilebilir_kafeler yalnız ad verir)
create function public.kafe_zincir_listesi()
returns table (cafe_id uuid, cafe_ad text, cafe_aktif boolean, zincir_id uuid)
language sql stable security definer set search_path = public as
$$
  select c.id, c.ad, c.aktif, c.zincir_id
  from cafe c
  cross join (
    select 1 from kullanici
    where id = auth.uid() and aktif and rol = 'super_admin'
  ) g
  order by c.ad
$$;

grant execute on function public.kafe_zincir_listesi() to authenticated;

-- ---------------------------------------------------------------------------
-- Temizlik: prod'da kalan onaysız test kaydı
-- ---------------------------------------------------------------------------
delete from auth.users where email = 'sofrakur.apptest@gmail.com';
