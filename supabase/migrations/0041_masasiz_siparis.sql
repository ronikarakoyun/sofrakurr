-- ============================================================================
-- 0041: Masasız sipariş + kafe modu (Faz 5 — M2)
--
-- Self-servis kafede sipariş masaya değil numaraya bağlıdır:
--   cafe.masa_duzeni = true  → bugünkü masalı akış AYNEN (BUTİKEK)
--   cafe.masa_duzeni = false → masa adımı yok; müşteri uygulamadan
--     musteri_siparis_olustur ile, kasiyer personel_siparis_olustur'u
--     masasız (p_masa_id null) çağırarak sipariş açar. Her masasız sipariş
--     kendi adisyonunu açar (self-serviste açık hesap biriktirme yok) —
--     adisyon_kapat / gün sonu / raporlar / sadakat sıfır değişiklikle çalışır.
--
-- QR akışı (siparis_olustur) HİÇ DEĞİŞMEZ.
-- ============================================================================

alter table public.adisyon alter column masa_id drop not null;
alter table public.siparis alter column masa_id drop not null;

-- Masasız kafe açık hesapla çalışamaz (ödeme kasada peşin alınır)
alter table public.cafe add column masa_duzeni boolean not null default true;
alter table public.cafe add constraint cafe_masasiz_once_odeme
  check (masa_duzeni or odeme_modu = 'once_odeme');
-- Not: anon vitrin policy'si (anon_cafe_okuma) tüm kolonları açar —
-- masa_duzeni müşteri uygulamasına otomatik görünür, ayrı policy gerekmez.

-- ---------------------------------------------------------------------------
-- Yeni RPC: müşteri uygulamadan masasız sipariş (0032 gövdesinin uyarlaması)
-- Rate limit masa yerine MÜŞTERİ bazlı. Durum modeli aynı: once_odeme →
-- odeme_bekliyor (kasada ödeme onaylanana dek mutfağa düşmez).
-- ---------------------------------------------------------------------------
create function public.musteri_siparis_olustur(
  p_cafe_id uuid,
  p_kalemler jsonb,
  p_musteri_notu text default null
) returns uuid
language plpgsql security definer set search_path = public as
$$
declare
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
  select id into v_musteri_id from public.kullanici
    where id = auth.uid() and rol = 'musteri' and aktif;
  if v_musteri_id is null then
    raise exception 'Sipariş için uygulamadan giriş yapmalısınız';
  end if;

  select * into v_cafe from public.cafe where id = p_cafe_id and aktif;
  if not found then
    raise exception 'Kafe aktif değil';
  end if;
  if v_cafe.masa_duzeni then
    raise exception 'Bu kafede sipariş için masa seçimi gerekli';
  end if;

  if p_kalemler is null or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'Sipariş boş olamaz';
  end if;

  select count(*) into v_son_dakika from public.siparis
    where musteri_id = v_musteri_id and created_at > now() - interval '60 seconds';
  if v_son_dakika >= 3 then
    raise exception 'Çok sık sipariş; lütfen biraz bekleyin';
  end if;

  -- self-serviste her sipariş kendi adisyonunu açar (masasız)
  insert into public.adisyon (cafe_id) values (v_cafe.id)
  returning id into v_adisyon_id;

  insert into public.siparis
    (cafe_id, adisyon_id, durum, musteri_notu, musteri_id, siparis_no)
  values (
    v_cafe.id, v_adisyon_id,
    case when v_cafe.odeme_modu = 'once_odeme' then 'odeme_bekliyor'::public.siparis_durum
         else 'bekliyor'::public.siparis_durum end,
    p_musteri_notu,
    v_musteri_id,
    public.siparis_no_al(v_cafe.id)
  ) returning id into v_siparis_id;

  for v_kalem in select * from jsonb_array_elements(p_kalemler) loop
    select * into v_urun from public.urun
      where id = (v_kalem->>'urun_id')::uuid and cafe_id = v_cafe.id and aktif;
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
      v_cafe.id, v_siparis_id, v_urun.id, v_urun.ad, v_urun.fiyat, v_adet,
      v_opsiyonlar, v_ek_fiyat,
      nullif(trim(coalesce(v_kalem->>'not', '')), '')
    );
  end loop;

  return v_siparis_id;
end
$$;

grant execute on function public.musteri_siparis_olustur(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- personel_siparis_olustur: p_masa_id artık null olabilir (self-servis tezgah
-- satışı). Null'da kasiyerin kendi kafesi + masa_duzeni=false şartı aranır,
-- sipariş kendi adisyonunu açar. Masalı yol birebir aynı (0040 gövdesi).
-- ---------------------------------------------------------------------------
create or replace function public.personel_siparis_olustur(
  p_masa_id uuid,
  p_kalemler jsonb,
  p_musteri_notu text default null
) returns uuid
language plpgsql security invoker set search_path = public as
$$
declare
  v_cafe_id uuid;
  v_masa public.masa%rowtype;
  v_adisyon_id uuid;
  v_siparis_id uuid;
  v_kalem jsonb;
  v_urun public.urun%rowtype;
  v_ek_fiyat numeric(10,2);
  v_opsiyonlar jsonb;
  v_adet int;
begin
  if p_kalemler is null or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'Sipariş boş olamaz';
  end if;

  if p_masa_id is null then
    -- masasız tezgah satışı: yalnız self-servis kafede
    v_cafe_id := public.aktif_cafe_id();
    if v_cafe_id is null then
      raise exception 'Kafe bulunamadı';
    end if;
    if (select masa_duzeni from public.cafe where id = v_cafe_id) then
      raise exception 'Bu kafede sipariş için masa seçimi gerekli';
    end if;
    insert into public.adisyon (cafe_id) values (v_cafe_id)
    returning id into v_adisyon_id;
  else
    select * into v_masa from public.masa where id = p_masa_id;
    if not found then
      raise exception 'Masa bulunamadı';
    end if;
    v_cafe_id := v_masa.cafe_id;

    select id into v_adisyon_id from public.adisyon
      where masa_id = p_masa_id and durum = 'acik'
      order by acilis desc limit 1;
    if v_adisyon_id is null then
      insert into public.adisyon (cafe_id, masa_id)
      values (v_cafe_id, p_masa_id)
      returning id into v_adisyon_id;
    end if;
  end if;

  insert into public.siparis
    (cafe_id, adisyon_id, masa_id, olusturan_id, durum, musteri_notu, siparis_no)
  values (v_cafe_id, v_adisyon_id, p_masa_id, auth.uid(), 'bekliyor', p_musteri_notu,
          public.personel_siparis_no_al(v_cafe_id))
  returning id into v_siparis_id;

  for v_kalem in select * from jsonb_array_elements(p_kalemler) loop
    select * into v_urun from public.urun
      where id = (v_kalem->>'urun_id')::uuid and cafe_id = v_cafe_id and aktif;
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
      v_cafe_id, v_siparis_id, v_urun.id, v_urun.ad, v_urun.fiyat, v_adet,
      v_opsiyonlar, v_ek_fiyat,
      nullif(trim(coalesce(v_kalem->>'not', '')), '')
    );
  end loop;

  return v_siparis_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Masa sıfırlama zinciri (0015): masasız kayıtlarda devre dışı
-- ---------------------------------------------------------------------------
create or replace function public.masa_bosaldiysa_sifirla(p_masa_id uuid)
returns void
language plpgsql security definer set search_path = public as
$$
begin
  if p_masa_id is null then
    return;
  end if;
  if exists (select 1 from public.adisyon where masa_id = p_masa_id and durum = 'acik') then
    return;
  end if;
  if exists (
    select 1 from public.siparis
    where masa_id = p_masa_id
      and durum in ('odeme_bekliyor', 'bekliyor', 'hazirlaniyor', 'hazir')
  ) then
    return;
  end if;
  update public.masa_oturumu
    set bitis = now()
    where masa_id = p_masa_id and bitis > now();
end
$$;

create or replace function public.adisyon_kapaninca_sifirla() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if new.masa_id is not null and new.durum in ('odendi', 'iptal') and old.durum = 'acik' then
    perform public.masa_bosaldiysa_sifirla(new.masa_id);
  end if;
  return new;
end
$$;

create or replace function public.siparis_bitince_sifirla() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if new.masa_id is not null
     and new.durum in ('teslim', 'iptal', 'reddedildi')
     and old.durum not in ('teslim', 'iptal', 'reddedildi') then
    perform public.masa_bosaldiysa_sifirla(new.masa_id);
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Masa taşıma/birleştirme (0025): masasız hesapta anlamlı değil — net hata
-- ---------------------------------------------------------------------------
create or replace function public.adisyon_tasi(p_adisyon_id uuid, p_hedef_masa_id uuid)
returns void language plpgsql security invoker set search_path = public as
$$
declare
  v_adisyon public.adisyon%rowtype;
  v_hedef public.masa%rowtype;
  v_hedef_adisyon_id uuid;
begin
  select * into v_adisyon from public.adisyon where id = p_adisyon_id and durum = 'acik';
  if not found then raise exception 'Açık adisyon bulunamadı'; end if;
  if v_adisyon.masa_id is null then
    raise exception 'Bu hesap bir masaya bağlı değil (self-servis siparişi taşınamaz)';
  end if;
  select * into v_hedef from public.masa where id = p_hedef_masa_id and aktif;
  if not found or v_hedef.cafe_id <> v_adisyon.cafe_id then
    raise exception 'Hedef masa bulunamadı';
  end if;
  if v_hedef.id = v_adisyon.masa_id then raise exception 'Hesap zaten bu masada'; end if;

  select id into v_hedef_adisyon_id from public.adisyon
    where masa_id = p_hedef_masa_id and durum = 'acik' order by acilis desc limit 1;

  if v_hedef_adisyon_id is not null then
    update public.siparis set adisyon_id = v_hedef_adisyon_id, masa_id = p_hedef_masa_id
      where adisyon_id = p_adisyon_id;
    -- kaynak iskontosunu hedefe ekle (yoksa müşteri fazla öderdi)
    update public.adisyon set iskonto_tutar = iskonto_tutar + v_adisyon.iskonto_tutar
      where id = v_hedef_adisyon_id;
    update public.adisyon set durum = 'iptal', kapanis = now() where id = p_adisyon_id;
  else
    update public.adisyon set masa_id = p_hedef_masa_id where id = p_adisyon_id;
    update public.siparis set masa_id = p_hedef_masa_id where adisyon_id = p_adisyon_id;
  end if;
end
$$;

create or replace function public.kalem_tasi(p_kalem_id uuid, p_hedef_masa_id uuid)
returns void language plpgsql security invoker set search_path = public as
$$
declare
  v_kalem public.siparis_kalemi%rowtype;
  v_hedef public.masa%rowtype;
  v_kaynak_sip public.siparis%rowtype;
  v_kaynak_adisyon public.adisyon%rowtype;
  v_hedef_adisyon_id uuid;
  v_tasima_siparis_id uuid;
begin
  select * into v_kalem from public.siparis_kalemi where id = p_kalem_id and not reddedildi;
  if not found then raise exception 'Kalem bulunamadı'; end if;

  select * into v_kaynak_sip from public.siparis where id = v_kalem.siparis_id;
  select * into v_kaynak_adisyon from public.adisyon where id = v_kaynak_sip.adisyon_id;
  if v_kaynak_adisyon.durum <> 'acik' then
    raise exception 'Kapalı hesaptan kalem taşınamaz';
  end if;
  if v_kaynak_adisyon.masa_id is null then
    raise exception 'Bu hesap bir masaya bağlı değil (self-servis kalemi taşınamaz)';
  end if;
  if v_kaynak_sip.durum = 'odeme_bekliyor' then
    raise exception 'Ödeme onayı bekleyen kalem taşınamaz';
  end if;

  select * into v_hedef from public.masa where id = p_hedef_masa_id and aktif;
  if not found or v_hedef.cafe_id <> v_kalem.cafe_id then
    raise exception 'Hedef masa bulunamadı';
  end if;

  select id into v_hedef_adisyon_id from public.adisyon
    where masa_id = p_hedef_masa_id and durum = 'acik' order by acilis desc limit 1;
  if v_hedef_adisyon_id is null then
    insert into public.adisyon (cafe_id, masa_id)
    values (v_kalem.cafe_id, p_hedef_masa_id) returning id into v_hedef_adisyon_id;
  end if;

  insert into public.siparis (cafe_id, adisyon_id, masa_id, olusturan_id, durum, musteri_notu)
  values (v_kalem.cafe_id, v_hedef_adisyon_id, p_hedef_masa_id, auth.uid(), 'teslim', 'Masa transferi')
  returning id into v_tasima_siparis_id;

  update public.siparis_kalemi set siparis_id = v_tasima_siparis_id where id = p_kalem_id;
end
$$;

-- ---------------------------------------------------------------------------
-- musteri_siparislerim: masa artık opsiyonel (left join; masa_ad null olabilir)
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
      left join public.masa m on m.id = s.masa_id
      where s.musteri_id = auth.uid()
      order by s.created_at desc
      limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) son
  ), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- _rapor_iptaller: masasız iptallerde kimlik "#N" (0005 gövdesi; 0026'daki
-- guard'lı sarmalayıcı değişmeden bu iç fonksiyonu çağırmaya devam eder)
-- ---------------------------------------------------------------------------
create or replace function public._rapor_iptaller(p_baslangic timestamptz, p_bitis timestamptz)
returns table (zaman timestamptz, masa_ad text, durum public.siparis_durum, tutar numeric, kalemler text)
language sql stable security invoker set search_path = public as
$$
  select
    s.updated_at,
    coalesce('#' || s.siparis_no::text, m.ad, 'Sipariş'),
    s.durum,
    coalesce((
      select sum((k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet)
      from siparis_kalemi k where k.siparis_id = s.id
    ), 0),
    (
      select string_agg(k.adet || '× ' || k.urun_ad, ', ' order by k.id)
      from siparis_kalemi k where k.siparis_id = s.id
    )
  from siparis s
  left join masa m on m.id = s.masa_id
  where s.durum in ('iptal', 'reddedildi')
    and s.updated_at >= p_baslangic and s.updated_at < p_bitis
  order by s.updated_at desc
$$;
