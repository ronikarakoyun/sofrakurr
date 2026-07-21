-- Masa seçim sayfası (eski jenerik QR köprüsü): masa bilgisi taşımayan eski
-- QR'ları okutan müşteri, masasını listeden seçer. Anonim erişilebilir; yalnız
-- aktif kafenin aktif masalarının adı + QR kodu döner.

create or replace function public.masa_listesi(p_cafe_id uuid)
returns table (bolum_ad text, masa_ad text, qr_kod text)
language sql stable security definer set search_path = public as
$$
  select b.ad, m.ad, m.qr_kod
  from public.masa m
  left join public.bolum b on b.id = m.bolum_id
  join public.cafe c on c.id = m.cafe_id
  where m.cafe_id = p_cafe_id and m.aktif and c.aktif
  order by b.sira nulls last, m.ad;
$$;

revoke execute on function public.masa_listesi(uuid) from public;
grant execute on function public.masa_listesi(uuid) to anon, authenticated;
