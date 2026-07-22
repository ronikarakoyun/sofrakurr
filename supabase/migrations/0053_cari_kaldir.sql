-- ============================================================================
-- 0053: Cari (veresiye) tamamen kaldırılır + taşıma RPC'leri + eski ödül yolu
-- (Faz 6 M4/M5 — GERİ DÖNÜŞSÜZ)
--
-- ⚠️ GERİ DÖNÜŞSÜZ: cari + cari_hareket tabloları ve adisyon.cari_id DÜŞER.
-- Çalıştırmadan ÖNCE canlıdan yedek alınmış olmalı. Canlıda yalnız disposable
-- test cari verisi olduğu teyit edildi (silinebilir).
--
-- Sıra (bağımlılık zinciri):
--  1. cari'ye bağlı fonksiyon/view'ları düşür (adisyon_cariye_kapat, cari_bakiye)
--  2. rapor_ozet + _rapor_ozet'i düşür (cari_hareket + cari_id kullanıyorlar)
--  3. cari'siz 10-kolon _rapor_ozet + rapor_ozet'i yeniden kur
--  4. adisyon_tutarlari'nı cari_id'siz yeniden kur
--  5. adisyon.cari_id kolonunu düşür
--  6. cari_hareket + cari tablolarını düşür
--  7. masa/kalem taşıma RPC'lerini düşür (Açık Masalar ile birlikte kalktı)
--  8. eski 2-arg odul_kullan'ı düşür (0052 yeni 3-arg'ı canlıda)
--
-- Enum'a DOKUNULMAZ: odeme_turu_tip'te 'cari' değeri kalır (gider aynı enuma
-- bağlı + tarihsel kapanmış adisyonlar odeme_turu='cari' taşıyabilir). İstemci
-- artık 'cari' göndermez.
-- ============================================================================

-- 1) cari'ye bağlı fonksiyon + view
drop function if exists public.adisyon_cariye_kapat(uuid, uuid);
drop view if exists public.cari_bakiye;

-- 2) rapor özetini düşür (cari referanslı)
drop function if exists public.rapor_ozet(timestamptz, timestamptz);
drop function if exists public._rapor_ozet(timestamptz, timestamptz);

-- 3) cari'siz _rapor_ozet (10 kolon) — cariye_yazilan + cari_tahsilat çıkarıldı
create function public._rapor_ozet(p_baslangic timestamptz, p_bitis timestamptz)
returns table (ciro numeric, nakit_ciro numeric, kart_ciro numeric, adisyon_sayisi bigint,
  siparis_sayisi bigint, ortalama_adisyon numeric, iptal_sayisi bigint, iptal_tutar numeric,
  ikram_tutar numeric, iskonto_tutar numeric)
language plpgsql stable set search_path = public as
$$
#variable_conflict use_column
begin
  perform public.rapor_yetki();
  return query
  with kapanan as (
    select tutar, iskonto_tutar, ikram_tutar, odeme_turu from adisyon_tutarlari
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
    coalesce((select sum(t.tutar) from kapanan t), 0),
    coalesce((select sum(t.tutar) from kapanan t where t.odeme_turu = 'nakit'), 0),
    coalesce((select sum(t.tutar) from kapanan t where t.odeme_turu = 'kart'), 0),
    (select count(*) from kapanan),
    (select count(*) from gecerli_siparis),
    coalesce((select round(avg(t.tutar), 2) from kapanan t), 0),
    (select count(*) from iptaller),
    coalesce((select sum(i.tutar) from iptaller i), 0),
    coalesce((select sum(t.ikram_tutar) from kapanan t), 0),
    coalesce((select sum(t.iskonto_tutar) from kapanan t), 0);
end
$$;

create function public.rapor_ozet(p_baslangic timestamptz, p_bitis timestamptz)
returns table (ciro numeric, nakit_ciro numeric, kart_ciro numeric, adisyon_sayisi bigint,
  siparis_sayisi bigint, ortalama_adisyon numeric, iptal_sayisi bigint, iptal_tutar numeric,
  ikram_tutar numeric, iskonto_tutar numeric)
language plpgsql stable security invoker set search_path = public as
$$ begin perform public.rapor_yetki();
   return query select * from public._rapor_ozet(p_baslangic, p_bitis); end $$;

grant execute on function public.rapor_ozet(timestamptz, timestamptz) to authenticated;

-- 4) adisyon_tutarlari'nı cari_id kolonu olmadan yeniden kur (odul_karsiligi 0052'den korunur)
drop view if exists public.adisyon_tutarlari;
create view public.adisyon_tutarlari as
 SELECT a.id AS adisyon_id,
    a.cafe_id,
    a.masa_id,
    a.durum,
    a.acilis,
    a.kapanis,
    a.odeme_turu,
    GREATEST(0::numeric, COALESCE(sum(
        CASE
            WHEN (s.durum = ANY (ARRAY['iptal'::siparis_durum, 'reddedildi'::siparis_durum])) OR k.reddedildi OR k.ikram OR k.odul_karsiligi THEN 0::numeric
            ELSE (k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet::numeric
        END), 0::numeric) - a.iskonto_tutar) AS tutar,
    a.iskonto_tutar,
    COALESCE(sum(
        CASE
            WHEN (s.durum = ANY (ARRAY['iptal'::siparis_durum, 'reddedildi'::siparis_durum])) OR k.reddedildi OR NOT k.ikram THEN 0::numeric
            ELSE (k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet::numeric
        END), 0::numeric) AS ikram_tutar
   FROM adisyon a
     LEFT JOIN siparis s ON s.adisyon_id = a.id
     LEFT JOIN siparis_kalemi k ON k.siparis_id = s.id
  GROUP BY a.id;

-- 5) adisyon.cari_id kolonunu düşür (FK dahil)
alter table public.adisyon drop column if exists cari_id;

-- 6) cari tablolarını düşür (test verisi disposable — DROP satırları da siler)
drop table if exists public.cari_hareket;
drop table if exists public.cari;

-- 7) masa/kalem taşıma RPC'leri (Açık Masalar paneli ile birlikte kalktı)
drop function if exists public.kalem_tasi(uuid, uuid);
drop function if exists public.adisyon_tasi(uuid, uuid);

-- 8) eski 2-arg odul_kullan (0052 yeni 3-arg'ı canlıda; eski panel silindi)
drop function if exists public.odul_kullan(text, uuid);
