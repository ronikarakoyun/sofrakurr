-- ============================================================================
-- 0058 — Masa katmanı + kasa RPC'lerinin kaldırılması (Faz 7 M4)
--
-- GERİ ALINAMAZ. Web teardown (M3) canlıda doğrulandıktan sonra koşulur.
-- QR/token sipariş yolu, masa seçimi, garson çağrısı, kasa ödeme RPC'si ve
-- ÖKC bağlantısı sistemden çıkar. Uygulama yalnız musteri_siparis_olustur
-- kullanır; KDS yalnız siparis_hazir_ver + doğrudan durum güncellemesi.
--
-- BİLİNÇLİ KORUNANLAR:
--  - masa + bolum tabloları ve siparis/adisyon.masa_id kolonları (tarihsel
--    kayıtların bütünlüğü; ölü veri, hiçbir ekran/RPC artık dokunmuyor)
--  - yazdirma_kuyrugu/basilan_fis (KDS ileride ajan baskısı isteyebilir)
--  - push_abonelik (KDS yeni-sipariş bildirimi kullanıyor)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) QR/token sipariş yolu: oturum RPC'leri + trigger zinciri
-- ---------------------------------------------------------------------------
drop function if exists public.siparis_olustur(text, jsonb, text);
drop function if exists public.masa_oturumu_ac(text);
drop function if exists public.masa_sec(uuid);
drop function if exists public.masa_durumlari(uuid);
drop function if exists public.masa_listesi(uuid);
drop function if exists public.oturum_siparisleri(text);
drop function if exists public.oturum_siparis_iptal(text, uuid);
drop function if exists public.garson_cagir(text, public.cagri_tur);

-- masa doluluk sıfırlama zinciri (masa haritası emekli)
drop trigger if exists adisyon_masa_sifirla on public.adisyon;
drop trigger if exists siparis_masa_sifirla on public.siparis;
drop function if exists public.adisyon_kapaninca_sifirla();
drop function if exists public.siparis_bitince_sifirla();
drop function if exists public.masa_bosaldiysa_sifirla(uuid);

-- ---------------------------------------------------------------------------
-- 2) Kasa/personel yolu: sipariş girişi + ödeme kaydı RPC'leri
-- ---------------------------------------------------------------------------
drop function if exists public.personel_siparis_olustur(uuid, jsonb, text);
drop function if exists public.adisyon_kapat(uuid, public.odeme_turu_tip);

-- ---------------------------------------------------------------------------
-- 3) ÖKC (yazarkasa) bağlantısı: rotalar M3'te silindi, DB tarafı da kalkar
-- ---------------------------------------------------------------------------
drop function if exists public.okc_anahtar_uret();
drop function if exists public.okc_durum();
drop table if exists public.cafe_gizli;

-- ---------------------------------------------------------------------------
-- 4) _rapor_personel: düşecek masa_oturumu_id kolonunu okuyordu — kanal
--    ayrımı artık musteri_id ile (uygulama siparişi / personel / bilinmiyor)
-- ---------------------------------------------------------------------------
create or replace function public._rapor_personel(p_baslangic timestamptz, p_bitis timestamptz)
returns table (kanal text, siparis_sayisi bigint)
language plpgsql stable security definer set search_path = public as
$$
#variable_conflict use_column
begin
  perform public.rapor_yetki();
  return query
  select
    coalesce(ku.ad, case when s.musteri_id is not null then 'Uygulama (müşteri)' else 'Bilinmiyor' end) as kanal,
    count(*) as siparis_sayisi
  from siparis s
  left join kullanici ku on ku.id = s.olusturan_id
  where s.created_at >= p_baslangic and s.created_at < p_bitis
    and s.durum not in ('iptal', 'reddedildi')
  group by 1
  order by 2 desc;
end
$$;

-- ---------------------------------------------------------------------------
-- 5) Oturum ve çağrı tabloları düşer (geçici operasyonel veriydi)
-- ---------------------------------------------------------------------------
alter table public.siparis drop column if exists masa_oturumu_id;
drop table if exists public.masa_oturumu;
drop table if exists public.garson_cagri;
drop type if exists public.cagri_tur; -- yalnız garson_cagri kullanıyordu

-- ---------------------------------------------------------------------------
-- 6) bakim_temizlik v4: ölen tabloların satırları çıkar
-- ---------------------------------------------------------------------------
create or replace function public.bakim_temizlik() returns void
language plpgsql security definer set search_path = public as
$$
begin
  update public.siparis set durum = 'iptal'
    where durum in ('bekliyor', 'hazirlaniyor')
      and created_at < now() - interval '24 hours';
  update public.siparis set durum = 'teslim'
    where durum = 'hazir' and updated_at < now() - interval '24 hours';
  delete from public.yazdirma_kuyrugu where durum = 'basildi' and created_at < now() - interval '7 days';
  delete from public.basilan_fis where basildi_at < now() - interval '7 days';
  delete from public.hata_log where created_at < now() - interval '30 days';
end
$$;
