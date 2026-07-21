-- ============================================================================
-- Kasa profesyonel paket:
--   ikram (kalem bedava, stok düşer, raporda görünür)
--   iskonto (adisyon kapanışında TL tutarı)
--   masa taşıma / birleştirme, ürün (kalem) transferi
--   cari hesaplar (veresiye): hesabı cariye yazma, cari tahsilat
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Kolonlar
-- ---------------------------------------------------------------------------
alter table public.siparis_kalemi
  add column if not exists ikram boolean not null default false;

alter table public.adisyon
  add column if not exists iskonto_tutar numeric(10,2) not null default 0,
  add column if not exists iskonto_neden text,
  add column if not exists cari_id uuid;

-- ---------------------------------------------------------------------------
-- 2) Cari hesaplar
-- ---------------------------------------------------------------------------
create table public.cari (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references public.cafe(id) on delete cascade,
  ad         text not null,
  telefon    text,
  notu       text,
  aktif      boolean not null default true,
  created_at timestamptz not null default now()
);

-- tutar > 0: borç (hesap cariye yazıldı) · tutar < 0: tahsilat (ödeme alındı)
create table public.cari_hareket (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references public.cafe(id) on delete cascade,
  cari_id    uuid not null references public.cari(id) on delete cascade,
  tutar      numeric(10,2) not null,
  aciklama   text,
  adisyon_id uuid references public.adisyon(id) on delete set null,
  created_at timestamptz not null default now()
);

create index on public.cari (cafe_id);
create index on public.cari_hareket (cari_id);

alter table public.adisyon
  add constraint adisyon_cari_fk foreign key (cari_id) references public.cari(id) on delete set null;

alter table public.cari enable row level security;
alter table public.cari_hareket enable row level security;
create policy personel_cari on public.cari
  for all using (cafe_id = public.aktif_cafe_id());
create policy personel_cari_hareket on public.cari_hareket
  for all using (cafe_id = public.aktif_cafe_id());

-- ---------------------------------------------------------------------------
-- 3) Masa taşıma / birleştirme (personel; kendi RLS yetkisiyle)
-- ---------------------------------------------------------------------------
create function public.adisyon_tasi(p_adisyon_id uuid, p_hedef_masa_id uuid)
returns void
language plpgsql security invoker set search_path = public as
$$
declare
  v_adisyon public.adisyon%rowtype;
  v_hedef public.masa%rowtype;
  v_hedef_adisyon_id uuid;
begin
  select * into v_adisyon from public.adisyon where id = p_adisyon_id and durum = 'acik';
  if not found then
    raise exception 'Açık adisyon bulunamadı';
  end if;
  select * into v_hedef from public.masa where id = p_hedef_masa_id and aktif;
  if not found or v_hedef.cafe_id <> v_adisyon.cafe_id then
    raise exception 'Hedef masa bulunamadı';
  end if;
  if v_hedef.id = v_adisyon.masa_id then
    raise exception 'Hesap zaten bu masada';
  end if;

  select id into v_hedef_adisyon_id from public.adisyon
    where masa_id = p_hedef_masa_id and durum = 'acik'
    order by acilis desc limit 1;

  if v_hedef_adisyon_id is not null then
    -- hedefte açık hesap var: birleştir
    update public.siparis
      set adisyon_id = v_hedef_adisyon_id, masa_id = p_hedef_masa_id
      where adisyon_id = p_adisyon_id;
    update public.adisyon set durum = 'iptal', kapanis = now() where id = p_adisyon_id;
  else
    update public.adisyon set masa_id = p_hedef_masa_id where id = p_adisyon_id;
    update public.siparis set masa_id = p_hedef_masa_id where adisyon_id = p_adisyon_id;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4) Ürün (kalem) transferi: kalem hedef masanın adisyonuna geçer
-- ---------------------------------------------------------------------------
create function public.kalem_tasi(p_kalem_id uuid, p_hedef_masa_id uuid)
returns void
language plpgsql security invoker set search_path = public as
$$
declare
  v_kalem public.siparis_kalemi%rowtype;
  v_hedef public.masa%rowtype;
  v_hedef_adisyon_id uuid;
  v_tasima_siparis_id uuid;
begin
  select * into v_kalem from public.siparis_kalemi where id = p_kalem_id and not reddedildi;
  if not found then
    raise exception 'Kalem bulunamadı';
  end if;
  select * into v_hedef from public.masa where id = p_hedef_masa_id and aktif;
  if not found or v_hedef.cafe_id <> v_kalem.cafe_id then
    raise exception 'Hedef masa bulunamadı';
  end if;

  select id into v_hedef_adisyon_id from public.adisyon
    where masa_id = p_hedef_masa_id and durum = 'acik'
    order by acilis desc limit 1;
  if v_hedef_adisyon_id is null then
    insert into public.adisyon (cafe_id, masa_id)
    values (v_kalem.cafe_id, p_hedef_masa_id)
    returning id into v_hedef_adisyon_id;
  end if;

  -- transfer kaydı: mutfağa düşmeyen (teslim) bir taşıma siparişi
  insert into public.siparis (cafe_id, adisyon_id, masa_id, olusturan_id, durum, musteri_notu)
  values (v_kalem.cafe_id, v_hedef_adisyon_id, p_hedef_masa_id, auth.uid(), 'teslim', 'Masa transferi')
  returning id into v_tasima_siparis_id;

  update public.siparis_kalemi set siparis_id = v_tasima_siparis_id where id = p_kalem_id;
end
$$;

-- ---------------------------------------------------------------------------
-- 5) Hesabı cariye yazarak kapatma
-- ---------------------------------------------------------------------------
create function public.adisyon_cariye_kapat(p_adisyon_id uuid, p_cari_id uuid)
returns void
language plpgsql security invoker set search_path = public as
$$
declare
  v_adisyon public.adisyon%rowtype;
  v_cari public.cari%rowtype;
  v_tutar numeric;
begin
  select * into v_adisyon from public.adisyon where id = p_adisyon_id and durum = 'acik';
  if not found then
    raise exception 'Açık adisyon bulunamadı';
  end if;
  select * into v_cari from public.cari where id = p_cari_id and aktif;
  if not found or v_cari.cafe_id <> v_adisyon.cafe_id then
    raise exception 'Cari hesap bulunamadı';
  end if;

  -- bekleyen ödeme onayları da tahsil edilmiş sayılır (mutfağa gider)
  update public.siparis set durum = 'bekliyor'
    where adisyon_id = p_adisyon_id and durum = 'odeme_bekliyor';

  select greatest(0, coalesce(sum(
      case when s.durum in ('iptal','reddedildi') or k.reddedildi or k.ikram then 0
           else (k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet end
    ), 0) - v_adisyon.iskonto_tutar)
  into v_tutar
  from public.siparis s
  join public.siparis_kalemi k on k.siparis_id = s.id
  where s.adisyon_id = p_adisyon_id;

  update public.adisyon
    set durum = 'odendi', kapanis = now(), cari_id = p_cari_id
    where id = p_adisyon_id;

  insert into public.cari_hareket (cafe_id, cari_id, tutar, aciklama, adisyon_id)
  values (v_adisyon.cafe_id, p_cari_id, v_tutar, 'Hesap cariye yazıldı', p_adisyon_id);
end
$$;

revoke execute on function public.adisyon_tasi(uuid, uuid) from public;
revoke execute on function public.kalem_tasi(uuid, uuid) from public;
revoke execute on function public.adisyon_cariye_kapat(uuid, uuid) from public;
grant execute on function public.adisyon_tasi(uuid, uuid) to authenticated;
grant execute on function public.kalem_tasi(uuid, uuid) to authenticated;
grant execute on function public.adisyon_cariye_kapat(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Tutar görünümü ve raporlar: ikram 0 sayılır, iskonto düşülür
-- ---------------------------------------------------------------------------
drop view if exists public.adisyon_tutarlari;
create view public.adisyon_tutarlari
with (security_invoker = true) as
select
  a.id as adisyon_id,
  a.cafe_id,
  a.masa_id,
  a.durum,
  a.acilis,
  a.kapanis,
  a.cari_id,
  greatest(0, coalesce(sum(
    case
      when s.durum in ('iptal', 'reddedildi') or k.reddedildi or k.ikram then 0
      else (k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet
    end
  ), 0) - a.iskonto_tutar) as tutar,
  a.iskonto_tutar,
  coalesce(sum(
    case
      when s.durum in ('iptal', 'reddedildi') or k.reddedildi or not k.ikram then 0
      else (k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet
    end
  ), 0) as ikram_tutar
from public.adisyon a
left join public.siparis s on s.adisyon_id = a.id
left join public.siparis_kalemi k on k.siparis_id = s.id
group by a.id;

drop function if exists public.rapor_ozet(timestamptz, timestamptz);
create function public.rapor_ozet(p_baslangic timestamptz, p_bitis timestamptz)
returns table (
  ciro numeric,
  adisyon_sayisi bigint,
  siparis_sayisi bigint,
  ortalama_adisyon numeric,
  iptal_sayisi bigint,
  iptal_tutar numeric,
  ikram_tutar numeric,
  iskonto_tutar numeric,
  cariye_yazilan numeric,
  cari_tahsilat numeric
)
language sql stable security invoker set search_path = public as
$$
  with kapanan as (
    select tutar, iskonto_tutar, ikram_tutar, cari_id from adisyon_tutarlari
    where durum = 'odendi' and kapanis >= p_baslangic and kapanis < p_bitis
  ),
  gecerli_siparis as (
    select id from siparis
    where created_at >= p_baslangic and created_at < p_bitis
      and durum not in ('iptal', 'reddedildi')
  ),
  iptaller as (
    select s.id,
      coalesce((
        select sum((k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet)
        from siparis_kalemi k where k.siparis_id = s.id
      ), 0) as tutar
    from siparis s
    where s.durum in ('iptal', 'reddedildi')
      and s.updated_at >= p_baslangic and s.updated_at < p_bitis
  )
  select
    coalesce((select sum(tutar) from kapanan), 0),
    (select count(*) from kapanan),
    (select count(*) from gecerli_siparis),
    coalesce((select round(avg(tutar), 2) from kapanan), 0),
    (select count(*) from iptaller),
    coalesce((select sum(tutar) from iptaller), 0),
    coalesce((select sum(ikram_tutar) from kapanan), 0),
    coalesce((select sum(iskonto_tutar) from kapanan), 0),
    coalesce((select sum(tutar) from kapanan where cari_id is not null), 0),
    coalesce((
      select -sum(h.tutar) from cari_hareket h
      where h.tutar < 0 and h.created_at >= p_baslangic and h.created_at < p_bitis
    ), 0)
$$;
grant execute on function public.rapor_ozet(timestamptz, timestamptz) to authenticated;
revoke execute on function public.rapor_ozet(timestamptz, timestamptz) from anon;

drop function if exists public.rapor_urun(timestamptz, timestamptz);
create function public.rapor_urun(p_baslangic timestamptz, p_bitis timestamptz)
returns table (urun_ad text, adet bigint, ciro numeric, maliyet numeric, ikram_adet bigint)
language sql stable security invoker set search_path = public as
$$
  select
    k.urun_ad,
    sum(k.adet) filter (where not k.ikram) as adet,
    coalesce(sum((k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet) filter (where not k.ikram), 0) as ciro,
    case
      when max(rm.birim_maliyet) is null then null
      else round(sum(k.adet * coalesce(rm.birim_maliyet, 0)), 2)
    end as maliyet,
    coalesce(sum(k.adet) filter (where k.ikram), 0) as ikram_adet
  from siparis_kalemi k
  join siparis s on s.id = k.siparis_id
  join adisyon a on a.id = s.adisyon_id
  left join lateral (
    select sum(r.miktar * h.son_birim_fiyat) as birim_maliyet
    from recete r
    join hammadde h on h.id = r.hammadde_id
    where r.urun_id = k.urun_id and h.son_birim_fiyat is not null
  ) rm on true
  where a.durum = 'odendi'
    and a.kapanis >= p_baslangic and a.kapanis < p_bitis
    and s.durum not in ('iptal', 'reddedildi')
    and not k.reddedildi
  group by k.urun_ad
  order by ciro desc
$$;
grant execute on function public.rapor_urun(timestamptz, timestamptz) to authenticated;
revoke execute on function public.rapor_urun(timestamptz, timestamptz) from anon;
