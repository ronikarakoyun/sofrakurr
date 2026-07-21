-- ============================================================================
-- 0040: Sipariş numarası (Faz 5 — M1, self-servis çekirdeği)
--
-- Sipariş kimliği artık kafe başına günlük sıra numarası (#1, #2, ...).
-- Masalı kafede masa adının YANINA eklenir ("Salon 3 · #12"); self-servis
-- kafede (M2'den itibaren) tek kimlik numara olur. Eski kayıtlar null kalır
-- (backfill yok) — gösterim kuralı: siparis_no varsa "#N", yoksa masa adı.
--
-- Sayaç: satır kilidiyle doğal race-safe upsert (iki eşzamanlı sipariş asla
-- aynı numarayı alamaz). Gün sınırı gece yarısı Europe/Istanbul (raporlarla
-- tutarlı).
-- ============================================================================

create table public.siparis_sayac (
  cafe_id uuid not null references public.cafe(id) on delete cascade,
  gun     date not null,
  son_no  int  not null,
  primary key (cafe_id, gun)
);

alter table public.siparis_sayac enable row level security;
-- yalnız sipariş RPC'leri (definer) yazar/okur; istemciye kapalı
revoke all on public.siparis_sayac from anon, authenticated;

alter table public.siparis add column siparis_no int;

-- ---------------------------------------------------------------------------
-- Ortak yardımcı: sıradaki numarayı atomik üretir
-- ---------------------------------------------------------------------------
-- Ham yardımcı: İSTEMCİYE KAPALI (grant yok) — yalnız security definer sipariş
-- RPC'leri (siparis_olustur, ileride musteri_siparis_olustur) sahip yetkisiyle
-- çağırır. Anon QR ve müşteri akışları bu yoldan numara alır.
create function public.siparis_no_al(p_cafe_id uuid) returns int
language sql volatile security definer set search_path = public as
$$
  insert into public.siparis_sayac (cafe_id, gun, son_no)
  values (p_cafe_id, (now() at time zone 'Europe/Istanbul')::date, 1)
  on conflict (cafe_id, gun) do update set son_no = siparis_sayac.son_no + 1
  returning son_no
$$;

revoke execute on function public.siparis_no_al(uuid) from public, anon, authenticated;

-- Personel köprüsü: personel_siparis_olustur security INVOKER olduğundan ham
-- yardımcıyı çağıramaz (grant yok); bu köprü rol guard'ıyla açıktır — müşteri
-- hesabı doğrudan REST'ten sayaç şişiremez, kendi kafesi dışına yazamaz.
create function public.personel_siparis_no_al(p_cafe_id uuid) returns int
language plpgsql volatile security definer set search_path = public as
$$
begin
  if not public.rol_var(array['admin','kasa']::public.kullanici_rol[]) then
    raise exception 'Bu işlem için kasa yetkisi gerekli';
  end if;
  if p_cafe_id is distinct from public.aktif_cafe_id() then
    raise exception 'Yalnız kendi kafeniz için numara üretilebilir';
  end if;
  return public.siparis_no_al(p_cafe_id);
end
$$;

grant execute on function public.personel_siparis_no_al(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- siparis_olustur: 0032 gövdesinin AYNISI + siparis_no ataması (tek ek)
-- ---------------------------------------------------------------------------
create or replace function public.siparis_olustur(
  p_token text,
  p_kalemler jsonb,
  p_musteri_notu text default null
) returns uuid
language plpgsql security definer set search_path = public as
$$
declare
  v_oturum public.masa_oturumu%rowtype;
  v_cafe public.cafe%rowtype;
  v_adisyon_id uuid;
  v_siparis_id uuid;
  v_kalem jsonb;
  v_urun public.urun%rowtype;
  v_ek_fiyat numeric(10,2);
  v_opsiyonlar jsonb;
  v_son_dakika int;
  v_adet int;
  v_musteri_id uuid;
begin
  select * into v_oturum from public.masa_oturumu
    where token = p_token and bitis > now();
  if not found then
    raise exception 'Oturum geçersiz veya süresi dolmuş; QR kodu yeniden okutun';
  end if;

  select * into v_cafe from public.cafe where id = v_oturum.cafe_id and aktif;
  if not found then
    raise exception 'Kafe aktif değil';
  end if;

  if p_kalemler is null or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'Sipariş boş olamaz';
  end if;

  select count(*) into v_son_dakika from public.siparis
    where masa_id = v_oturum.masa_id and created_at > now() - interval '60 seconds';
  if v_son_dakika >= 3 then
    raise exception 'Çok sık sipariş; lütfen biraz bekleyin';
  end if;

  -- Uygulamadan giriş yapmış müşteriyse kimliği damgala (personel/anon → null)
  select id into v_musteri_id from public.kullanici
    where id = auth.uid() and rol = 'musteri' and aktif;

  select id into v_adisyon_id from public.adisyon
    where masa_id = v_oturum.masa_id and durum = 'acik'
    order by acilis desc limit 1;
  if v_adisyon_id is null then
    insert into public.adisyon (cafe_id, masa_id)
    values (v_oturum.cafe_id, v_oturum.masa_id)
    returning id into v_adisyon_id;
  end if;

  insert into public.siparis
    (cafe_id, adisyon_id, masa_id, masa_oturumu_id, durum, musteri_notu, musteri_id, siparis_no)
  values (
    v_oturum.cafe_id, v_adisyon_id, v_oturum.masa_id, v_oturum.id,
    case when v_cafe.odeme_modu = 'once_odeme' then 'odeme_bekliyor'::public.siparis_durum
         else 'bekliyor'::public.siparis_durum end,
    p_musteri_notu,
    v_musteri_id,
    public.siparis_no_al(v_oturum.cafe_id)
  ) returning id into v_siparis_id;

  for v_kalem in select * from jsonb_array_elements(p_kalemler) loop
    select * into v_urun from public.urun
      where id = (v_kalem->>'urun_id')::uuid and cafe_id = v_oturum.cafe_id and aktif;
    if not found then
      raise exception 'Ürün bulunamadı veya pasif: %', v_kalem->>'urun_id';
    end if;

    v_adet := greatest(coalesce((v_kalem->>'adet')::int, 1), 1);
    if v_urun.stok_takip and coalesce(v_urun.stok_adet, 0) < v_adet then
      raise exception '"%" tükenmek üzere; kalan adet: %', v_urun.ad, coalesce(v_urun.stok_adet, 0);
    end if;

    -- Ek fiyat ve seçim listesi SUNUCUDA opsiyon tablosundan kurulur (fiyat güvenliği)
    select
      coalesce(sum(o.ek_fiyat), 0),
      coalesce(jsonb_agg(jsonb_build_object('grup', g.ad, 'secim', o.ad, 'ek_fiyat', o.ek_fiyat)), '[]'::jsonb)
    into v_ek_fiyat, v_opsiyonlar
    from jsonb_array_elements(coalesce(v_kalem->'opsiyonlar', '[]'::jsonb)) sec
    join public.opsiyon o on o.ad = (sec->>'secim') and o.aktif
    join public.opsiyon_grubu g on g.id = o.opsiyon_grubu_id
      and g.ad = (sec->>'grup') and g.urun_id = v_urun.id;

    insert into public.siparis_kalemi
      (cafe_id, siparis_id, urun_id, urun_ad, birim_fiyat, adet, secilen_opsiyonlar, opsiyon_ek_fiyat, kalem_notu)
    values (
      v_oturum.cafe_id, v_siparis_id, v_urun.id, v_urun.ad, v_urun.fiyat, v_adet,
      v_opsiyonlar, v_ek_fiyat,
      nullif(trim(coalesce(v_kalem->>'not', '')), '')
    );
  end loop;

  return v_siparis_id;
end
$$;

-- ---------------------------------------------------------------------------
-- personel_siparis_olustur: 0023 gövdesinin AYNISI + siparis_no ataması
-- ---------------------------------------------------------------------------
create or replace function public.personel_siparis_olustur(
  p_masa_id uuid,
  p_kalemler jsonb,
  p_musteri_notu text default null
) returns uuid
language plpgsql security invoker set search_path = public as
$$
declare
  v_masa public.masa%rowtype;
  v_adisyon_id uuid;
  v_siparis_id uuid;
  v_kalem jsonb;
  v_urun public.urun%rowtype;
  v_ek_fiyat numeric(10,2);
  v_opsiyonlar jsonb;
  v_adet int;
begin
  select * into v_masa from public.masa where id = p_masa_id;
  if not found then
    raise exception 'Masa bulunamadı';
  end if;

  if p_kalemler is null or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'Sipariş boş olamaz';
  end if;

  select id into v_adisyon_id from public.adisyon
    where masa_id = p_masa_id and durum = 'acik'
    order by acilis desc limit 1;
  if v_adisyon_id is null then
    insert into public.adisyon (cafe_id, masa_id)
    values (v_masa.cafe_id, p_masa_id)
    returning id into v_adisyon_id;
  end if;

  insert into public.siparis
    (cafe_id, adisyon_id, masa_id, olusturan_id, durum, musteri_notu, siparis_no)
  values (v_masa.cafe_id, v_adisyon_id, p_masa_id, auth.uid(), 'bekliyor', p_musteri_notu,
          public.personel_siparis_no_al(v_masa.cafe_id))
  returning id into v_siparis_id;

  for v_kalem in select * from jsonb_array_elements(p_kalemler) loop
    select * into v_urun from public.urun
      where id = (v_kalem->>'urun_id')::uuid and cafe_id = v_masa.cafe_id and aktif;
    if not found then
      raise exception 'Ürün bulunamadı veya pasif';
    end if;

    v_adet := greatest(coalesce((v_kalem->>'adet')::int, 1), 1);
    if v_urun.stok_takip and coalesce(v_urun.stok_adet, 0) < v_adet then
      raise exception '"%" için yeterli stok yok (kalan: %)', v_urun.ad, coalesce(v_urun.stok_adet, 0);
    end if;

    select
      coalesce(sum(o.ek_fiyat), 0),
      coalesce(jsonb_agg(jsonb_build_object('grup', g.ad, 'secim', o.ad, 'ek_fiyat', o.ek_fiyat)), '[]'::jsonb)
    into v_ek_fiyat, v_opsiyonlar
    from jsonb_array_elements(coalesce(v_kalem->'opsiyonlar', '[]'::jsonb)) sec
    join public.opsiyon o on o.ad = (sec->>'secim') and o.aktif
    join public.opsiyon_grubu g on g.id = o.opsiyon_grubu_id
      and g.ad = (sec->>'grup') and g.urun_id = v_urun.id;

    insert into public.siparis_kalemi
      (cafe_id, siparis_id, urun_id, urun_ad, birim_fiyat, adet, secilen_opsiyonlar, opsiyon_ek_fiyat, kalem_notu)
    values (
      v_masa.cafe_id, v_siparis_id, v_urun.id, v_urun.ad, v_urun.fiyat, v_adet,
      v_opsiyonlar, v_ek_fiyat,
      nullif(trim(coalesce(v_kalem->>'not', '')), '')
    );
  end loop;

  return v_siparis_id;
end
$$;

-- ---------------------------------------------------------------------------
-- musteri_siparislerim: çıktıya siparis_no eklendi (0032 gövdesi)
-- ---------------------------------------------------------------------------
create or replace function public.musteri_siparislerim(p_limit int default 30)
returns jsonb
language plpgsql security definer set search_path = public as
$$
begin
  if auth.uid() is null then
    raise exception 'Giriş gerekli';
  end if;

  return coalesce((
    select jsonb_agg(x) from (
      select jsonb_build_object(
        'siparis_id', s.id,
        'siparis_no', s.siparis_no,
        'cafe_ad', c.ad,
        'masa_ad', m.ad,
        'durum', s.durum,
        'tarih', s.created_at,
        'kalemler', coalesce((
          select jsonb_agg(jsonb_build_object(
            'urun_id', k.urun_id,
            'urun_ad', k.urun_ad,
            'adet', k.adet,
            'birim_fiyat', k.birim_fiyat,
            'opsiyon_ek_fiyat', k.opsiyon_ek_fiyat,
            'opsiyonlar', k.secilen_opsiyonlar,
            'kalem_notu', k.kalem_notu,
            'reddedildi', k.reddedildi
          ))
          from public.siparis_kalemi k where k.siparis_id = s.id
        ), '[]'::jsonb)
      ) as x
      from public.siparis s
      join public.cafe c on c.id = s.cafe_id
      join public.masa m on m.id = s.masa_id
      where s.musteri_id = auth.uid()
      order by s.created_at desc
      limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) son
  ), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- oturum_siparisleri: dönüş tablosuna siparis_no eklendi (0014 gövdesi;
-- dönüş tipi değiştiği için drop + create + yeniden grant gerekir)
-- ---------------------------------------------------------------------------
drop function if exists public.oturum_siparisleri(text);

create function public.oturum_siparisleri(p_token text)
returns table (
  siparis_id uuid,
  durum public.siparis_durum,
  created_at timestamptz,
  kalemler jsonb,
  toplam numeric,
  benim boolean,
  siparis_no int
)
language plpgsql stable security definer set search_path = public as
$$
declare
  v_oturum public.masa_oturumu%rowtype;
begin
  select * into v_oturum from public.masa_oturumu
    where token = p_token and bitis > now();
  if not found then
    raise exception 'Oturum geçersiz veya süresi dolmuş; QR kodu yeniden okutun';
  end if;

  return query
  select
    s.id,
    s.durum,
    s.created_at,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'ad', k.urun_ad,
            'adet', k.adet,
            'tutar', (k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet,
            'urun_id', k.urun_id,
            'opsiyonlar', k.secilen_opsiyonlar
          ) order by k.id
        )
        from public.siparis_kalemi k
        where k.siparis_id = s.id and not k.reddedildi
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select sum((k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet)
        from public.siparis_kalemi k
        where k.siparis_id = s.id and not k.reddedildi
      ),
      0
    ),
    (s.masa_oturumu_id = v_oturum.id),
    s.siparis_no
  from public.siparis s
  left join public.adisyon a on a.id = s.adisyon_id
  where s.masa_id = v_oturum.masa_id
    and s.durum not in ('iptal', 'reddedildi')
    and (a.durum = 'acik' or s.durum in ('odeme_bekliyor', 'bekliyor', 'hazirlaniyor', 'hazir'))
  order by s.created_at desc;
end
$$;

revoke execute on function public.oturum_siparisleri(text) from public;
grant execute on function public.oturum_siparisleri(text) to anon, authenticated;
