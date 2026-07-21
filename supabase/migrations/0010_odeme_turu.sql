-- Ödeme türü: hesap kapanışında Nakit / Kart (POS) / Cari ayrımı.
-- Gün sonu kasa sayımı ve Z raporu mutabakatı için nakit/kart kırılımı raporlara eklenir.

create type public.odeme_turu_tip as enum ('nakit', 'kart', 'cari');

alter table public.adisyon
  add column if not exists odeme_turu public.odeme_turu_tip;

alter table public.cari_hareket
  add column if not exists odeme_turu public.odeme_turu_tip;

-- Cariye kapatma artık ödeme türünü de işaretler
create or replace function public.adisyon_cariye_kapat(p_adisyon_id uuid, p_cari_id uuid)
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
    set durum = 'odendi', kapanis = now(), cari_id = p_cari_id, odeme_turu = 'cari'
    where id = p_adisyon_id;

  insert into public.cari_hareket (cafe_id, cari_id, tutar, aciklama, adisyon_id)
  values (v_adisyon.cafe_id, p_cari_id, v_tutar, 'Hesap cariye yazıldı', p_adisyon_id);
end
$$;

-- Görünüme ödeme türü eklenir
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
  a.odeme_turu,
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

-- Rapor özeti: nakit/kart kırılımı eklendi
drop function if exists public.rapor_ozet(timestamptz, timestamptz);
create function public.rapor_ozet(p_baslangic timestamptz, p_bitis timestamptz)
returns table (
  ciro numeric,
  nakit_ciro numeric,
  kart_ciro numeric,
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
    select tutar, iskonto_tutar, ikram_tutar, cari_id, odeme_turu from adisyon_tutarlari
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
    coalesce((select sum(tutar) from kapanan where odeme_turu = 'nakit'), 0),
    coalesce((select sum(tutar) from kapanan where odeme_turu = 'kart'), 0),
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
