-- ============================================================================
-- 0036: Uygulamadan manuel masa seçimi (kamera/QR okutma kaldırıldı)
--   masa_durumlari : kafenin masalarını bölüm bölüm, doluluk bilgisiyle döner
--                    (masa tablosu personele kilitli; müşteri bu RPC ile görür,
--                    qr_kod istemciye HİÇ verilmez)
--   masa_sec       : seçilen masa için oturum açar — mevcut masa_oturumu_ac'ın
--                    tüm guard'ları (aktif kafe/masa) aynen geçerli kalır.
-- Not: fiziksel QR kanıtı kalktığı için uzaktan sipariş riski once_odeme
-- akışıyla karşılanır (ödenmeyen sipariş mutfağa düşmez, kasa/garson onayı şart).
-- ============================================================================

create function public.masa_durumlari(p_cafe_id uuid)
returns table (bolum text, masa_id uuid, masa_ad text, dolu boolean)
language sql stable security definer set search_path = public as
$$
  select
    coalesce(b.ad, 'MASALAR'),
    m.id,
    m.ad,
    exists (
      select 1 from public.adisyon a
      where a.masa_id = m.id and a.durum = 'acik'
    )
  from public.masa m
  left join public.bolum b on b.id = m.bolum_id
  join public.cafe c on c.id = m.cafe_id and c.aktif
  where m.cafe_id = p_cafe_id and m.aktif
  order by coalesce(b.ad, 'MASALAR'), m.ad
$$;

grant execute on function public.masa_durumlari(uuid) to anon, authenticated;

create function public.masa_sec(p_masa_id uuid)
returns table (oturum_token text, cafe_id uuid, cafe_ad text, masa_id uuid, masa_ad text)
language plpgsql security definer set search_path = public as
$$
declare
  v_qr text;
begin
  select qr_kod into v_qr from public.masa where id = p_masa_id and aktif;
  if v_qr is null then
    raise exception 'Masa bulunamadı';
  end if;
  return query select * from public.masa_oturumu_ac(v_qr);
end
$$;

grant execute on function public.masa_sec(uuid) to anon, authenticated;
