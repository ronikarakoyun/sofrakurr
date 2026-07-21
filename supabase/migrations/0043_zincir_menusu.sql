-- ============================================================================
-- 0043: Zincir menüsü (Faz 5 — M5)
--
-- 100 şubeli zincirde menü BİR KEZ girilir: zincirin "ana şubesi" şablondur,
-- zincir_menu_senkronla şablonu tüm şubelere kopyalar/günceller.
--
-- Model (melez şablon-kopya): şubelerde fiziksel menü satırları durur — mevcut
-- sorgular, RLS, reçete FK'ları, opsiyon doğrulaması HİÇ değişmez. Her şube
-- satırı şablondaki karşılığına kaynak_id ile işaret eder.
--
-- Senkron kuralları:
--   • ad/açıklama/görsel/sıra/istasyon/kampanya/opsiyonlar güncellenir
--   • fiyat güncellenir; şube üründe fiyat_kilit=true ise DOKUNULMAZ
--   • şubenin aktif (bitti) işaretine ASLA dokunulmaz
--   • şablondan silinen ürün/kategori/ödül şubede PASİFE çekilir (geçmiş
--     siparişler güvende); opsiyon grubu/opsiyon ise silinir (kaleme kopyalanır,
--     FK riski yok)
--   • ana şubenin gorsel_url'i aynen kopyalanır (tek dosya, tüm şubeler paylaşır)
-- ============================================================================

alter table public.kategori      add column kaynak_id uuid;
alter table public.urun          add column kaynak_id uuid;
alter table public.opsiyon_grubu add column kaynak_id uuid;
alter table public.opsiyon       add column kaynak_id uuid;
alter table public.odul          add column kaynak_id uuid;

create unique index kategori_kaynak_tekil      on public.kategori (cafe_id, kaynak_id)      where kaynak_id is not null;
create unique index urun_kaynak_tekil          on public.urun (cafe_id, kaynak_id)          where kaynak_id is not null;
create unique index opsiyon_grubu_kaynak_tekil on public.opsiyon_grubu (cafe_id, kaynak_id) where kaynak_id is not null;
create unique index opsiyon_kaynak_tekil       on public.opsiyon (cafe_id, kaynak_id)       where kaynak_id is not null;
create unique index odul_kaynak_tekil          on public.odul (cafe_id, kaynak_id)          where kaynak_id is not null;

-- Şube-özel fiyat: kilitli ürünün fiyatını senkron ezmez
alter table public.urun add column fiyat_kilit boolean not null default false;

alter table public.zincir
  add column menu_kaynak_cafe_id uuid references public.cafe(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Yetki yardımcısı: süper admin her zinciri, franchise yalnız kendi zincirini
-- yönetir. p_zincir_id null → franchise'ın kendi zinciri.
-- ---------------------------------------------------------------------------
create function public._zincir_yetki(p_zincir_id uuid) returns uuid
language plpgsql stable security definer set search_path = public as
$$
declare
  v_rol public.kullanici_rol := public.gercek_rol();
  v_zincir uuid;
begin
  if v_rol = 'super_admin' then
    if p_zincir_id is null then
      raise exception 'Zincir seçimi gerekli';
    end if;
    v_zincir := p_zincir_id;
  elsif v_rol = 'franchise' then
    select zincir_id into v_zincir from public.kullanici where id = auth.uid();
    if v_zincir is null then
      raise exception 'Hesabınız bir zincire bağlı değil';
    end if;
    if p_zincir_id is not null and p_zincir_id <> v_zincir then
      raise exception 'Bu zincir size bağlı değil';
    end if;
  else
    raise exception 'Bu işlem için zincir sahibi veya platform yöneticisi girişi gerekli';
  end if;
  if not exists (select 1 from public.zincir where id = v_zincir) then
    raise exception 'Zincir bulunamadı';
  end if;
  return v_zincir;
end
$$;

revoke execute on function public._zincir_yetki(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ana şube (menü şablonu) ataması
-- ---------------------------------------------------------------------------
create function public.zincir_menu_kaynak_ata(p_cafe_id uuid, p_zincir_id uuid default null)
returns void
language plpgsql security definer set search_path = public as
$$
declare
  v_zincir uuid := public._zincir_yetki(p_zincir_id);
begin
  if not exists (select 1 from public.cafe where id = p_cafe_id and zincir_id = v_zincir) then
    raise exception 'Bu kafe zincire bağlı değil';
  end if;
  update public.zincir set menu_kaynak_cafe_id = p_cafe_id where id = v_zincir;
end
$$;

grant execute on function public.zincir_menu_kaynak_ata(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Menü senkronu: ana şube → zincirin diğer tüm şubeleri
-- ---------------------------------------------------------------------------
create function public.zincir_menu_senkronla(p_zincir_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  v_zincir uuid := public._zincir_yetki(p_zincir_id);
  v_kaynak uuid;
  v_sube record;
  v_sube_sayisi int := 0;
  v_urun_sayisi int := 0;
begin
  select menu_kaynak_cafe_id into v_kaynak from public.zincir where id = v_zincir;
  if v_kaynak is null then
    raise exception 'Önce ana şube (menü şablonu) seçin';
  end if;
  if not exists (select 1 from public.cafe where id = v_kaynak and zincir_id = v_zincir) then
    raise exception 'Ana şube artık bu zincirde değil — yeniden seçin';
  end if;

  for v_sube in
    select id from public.cafe where zincir_id = v_zincir and id <> v_kaynak
  loop
    v_sube_sayisi := v_sube_sayisi + 1;

    -- 1) Kategoriler (şube aktif işaretine dokunulmaz)
    insert into public.kategori (cafe_id, ad, sira, aktif, kaynak_id)
    select v_sube.id, k.ad, k.sira, k.aktif, k.id
    from public.kategori k where k.cafe_id = v_kaynak
    on conflict (cafe_id, kaynak_id) where kaynak_id is not null
    do update set ad = excluded.ad, sira = excluded.sira;

    -- 2) Ürünler (fiyat_kilit'li şube fiyatı korunur; aktif'e dokunulmaz)
    insert into public.urun
      (cafe_id, kategori_id, ad, aciklama, fiyat, gorsel_url, aktif, sira, kampanya, istasyon, kaynak_id)
    select v_sube.id, sk.id, u.ad, u.aciklama, u.fiyat, u.gorsel_url, u.aktif, u.sira, u.kampanya, u.istasyon, u.id
    from public.urun u
    join public.kategori sk on sk.cafe_id = v_sube.id and sk.kaynak_id = u.kategori_id
    where u.cafe_id = v_kaynak
    on conflict (cafe_id, kaynak_id) where kaynak_id is not null
    do update set
      ad = excluded.ad,
      aciklama = excluded.aciklama,
      gorsel_url = excluded.gorsel_url,
      sira = excluded.sira,
      kampanya = excluded.kampanya,
      istasyon = excluded.istasyon,
      kategori_id = excluded.kategori_id,
      fiyat = case when urun.fiyat_kilit then urun.fiyat else excluded.fiyat end;

    get diagnostics v_urun_sayisi = row_count;

    -- 3) Opsiyon grupları
    insert into public.opsiyon_grubu (cafe_id, urun_id, ad, min_secim, max_secim, sira, kaynak_id)
    select v_sube.id, su.id, g.ad, g.min_secim, g.max_secim, g.sira, g.id
    from public.opsiyon_grubu g
    join public.urun su on su.cafe_id = v_sube.id and su.kaynak_id = g.urun_id
    where g.cafe_id = v_kaynak
    on conflict (cafe_id, kaynak_id) where kaynak_id is not null
    do update set ad = excluded.ad, min_secim = excluded.min_secim,
                  max_secim = excluded.max_secim, sira = excluded.sira,
                  urun_id = excluded.urun_id;

    -- 4) Opsiyonlar
    insert into public.opsiyon (cafe_id, opsiyon_grubu_id, ad, ek_fiyat, aktif, sira, kaynak_id)
    select v_sube.id, sg.id, o.ad, o.ek_fiyat, o.aktif, o.sira, o.id
    from public.opsiyon o
    join public.opsiyon_grubu sg on sg.cafe_id = v_sube.id and sg.kaynak_id = o.opsiyon_grubu_id
    where o.cafe_id = v_kaynak
    on conflict (cafe_id, kaynak_id) where kaynak_id is not null
    do update set ad = excluded.ad, ek_fiyat = excluded.ek_fiyat,
                  sira = excluded.sira, opsiyon_grubu_id = excluded.opsiyon_grubu_id;

    -- 5) Ödüller (şube aktif işaretine dokunulmaz)
    insert into public.odul (cafe_id, ad, puan_bedeli, aktif, sira, kaynak_id)
    select v_sube.id, d.ad, d.puan_bedeli, d.aktif, d.sira, d.id
    from public.odul d where d.cafe_id = v_kaynak
    on conflict (cafe_id, kaynak_id) where kaynak_id is not null
    do update set ad = excluded.ad, puan_bedeli = excluded.puan_bedeli, sira = excluded.sira;

    -- 6) Şablondan silinenler: opsiyon/grup silinir (FK riski yok), gerisi pasife
    delete from public.opsiyon o
    where o.cafe_id = v_sube.id and o.kaynak_id is not null
      and not exists (select 1 from public.opsiyon x where x.id = o.kaynak_id and x.cafe_id = v_kaynak);

    delete from public.opsiyon_grubu g
    where g.cafe_id = v_sube.id and g.kaynak_id is not null
      and not exists (select 1 from public.opsiyon_grubu x where x.id = g.kaynak_id and x.cafe_id = v_kaynak);

    update public.urun u set aktif = false
    where u.cafe_id = v_sube.id and u.kaynak_id is not null and u.aktif
      and not exists (select 1 from public.urun x where x.id = u.kaynak_id and x.cafe_id = v_kaynak);

    update public.kategori k set aktif = false
    where k.cafe_id = v_sube.id and k.kaynak_id is not null and k.aktif
      and not exists (select 1 from public.kategori x where x.id = k.kaynak_id and x.cafe_id = v_kaynak);

    update public.odul d set aktif = false
    where d.cafe_id = v_sube.id and d.kaynak_id is not null and d.aktif
      and not exists (select 1 from public.odul x where x.id = d.kaynak_id and x.cafe_id = v_kaynak);
  end loop;

  return jsonb_build_object('sube', v_sube_sayisi, 'son_sube_urun', v_urun_sayisi);
end
$$;

grant execute on function public.zincir_menu_senkronla(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- zincir_listesi: ana şube bilgisi eklendi (dönüş tipi değişti → drop+create)
-- ---------------------------------------------------------------------------
drop function if exists public.zincir_listesi();

create function public.zincir_listesi()
returns table (
  id uuid, ad text, kafe_sayisi bigint, franchise_adlari text,
  menu_kaynak_cafe_id uuid, menu_kaynak_ad text
)
language sql stable security definer set search_path = public as
$$
  select
    z.id, z.ad,
    (select count(*) from cafe c where c.zincir_id = z.id),
    (select string_agg(u.ad, ', ' order by u.ad)
     from kullanici u where u.zincir_id = z.id and u.rol = 'franchise'),
    z.menu_kaynak_cafe_id,
    (select c.ad from cafe c where c.id = z.menu_kaynak_cafe_id)
  from zincir z
  cross join (
    select 1 from kullanici
    where id = auth.uid() and aktif and rol = 'super_admin'
  ) g
  order by z.ad
$$;

grant execute on function public.zincir_listesi() to authenticated;

-- Franchise'ın kendi zinciri için aynı bilgi (panel kartı)
create function public.zincirim()
returns table (id uuid, ad text, menu_kaynak_cafe_id uuid, menu_kaynak_ad text)
language sql stable security definer set search_path = public as
$$
  select z.id, z.ad, z.menu_kaynak_cafe_id,
         (select c.ad from cafe c where c.id = z.menu_kaynak_cafe_id)
  from zincir z
  join kullanici u on u.id = auth.uid() and u.aktif
    and u.rol = 'franchise' and u.zincir_id = z.id
$$;

grant execute on function public.zincirim() to authenticated;
