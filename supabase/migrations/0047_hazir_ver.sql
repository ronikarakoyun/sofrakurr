-- ============================================================================
-- 0047: "Hazır" tek adım (Faz 6 — M2)
--
-- Kasa şeridinde "Teslim Edildi" adımı kalkıyor: barista tek dokunuşla
-- "Hazır" der, sipariş listeden düşer.
--
-- İki aşamalı yazma ŞART:
--   1) durum = 'hazir'  → 0042 trigger'ı müşteriye "Siparişin hazır · #N"
--                         push'unu atar. Atlanırsa müşteri bildirimsiz kalır.
--   2) masa_id null ise → 'teslim'. Self-serviste müşteri tezgahtan alır,
--      sipariş kapanır. MASALI kafede sipariş 'hazir'de KALIR — garson masaya
--      götürecek; masa haritasının yeşil uyarısı ve bildirim listesi buna bağlı.
--
-- 0023 durum bekçisi terminal durumdan çıkışı engeller; hazir→teslim serbest.
-- ============================================================================

create function public.siparis_hazir_ver(p_siparis_id uuid) returns void
language plpgsql security invoker set search_path = public as
$$
declare
  v_masa uuid;
begin
  update public.siparis
    set durum = 'hazir'
    where id = p_siparis_id and durum in ('bekliyor', 'hazirlaniyor')
    returning masa_id into v_masa;

  if not found then
    -- zaten hazır/teslim edilmiş ya da iptal olmuş: sessizce çık (çift dokunuş)
    return;
  end if;

  -- Masasız (self-servis) sipariş tezgahtan teslim alınır → hemen kapanır
  if v_masa is null then
    update public.siparis set durum = 'teslim' where id = p_siparis_id;
  end if;
end
$$;

grant execute on function public.siparis_hazir_ver(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Güvenlik ağı: masalı kafede unutulan 'hazir' siparişler birikmesin
-- (0025'teki bakım işine tek satır; pg_cron zaten her gün 04:00'te çalışıyor)
-- ---------------------------------------------------------------------------
create or replace function public.bakim_temizlik() returns void
language plpgsql security definer set search_path = public as
$$
begin
  -- 12 saatten eski, hâlâ onay bekleyen QR siparişleri (müşteri kalkmış) iptal
  update public.siparis set durum = 'iptal'
    where durum = 'odeme_bekliyor' and created_at < now() - interval '12 hours';
  -- 24 saattir 'hazir'de bekleyen sipariş: teslim edilmiş sayılır
  update public.siparis set durum = 'teslim'
    where durum = 'hazir' and updated_at < now() - interval '24 hours';
  delete from public.masa_oturumu where bitis < now() - interval '2 days';
  delete from public.garson_cagri where not acik and created_at < now() - interval '2 days';
  delete from public.yazdirma_kuyrugu where durum = 'basildi' and created_at < now() - interval '7 days';
  delete from public.basilan_fis where basildi_at < now() - interval '7 days';
end
$$;
