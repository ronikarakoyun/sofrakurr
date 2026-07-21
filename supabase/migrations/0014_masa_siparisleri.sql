-- Siparişlerim artık MASA bazlı: masanın açık hesabındaki tüm aktif siparişler
-- görünür (aynı masadaki arkadaşınki dahil). Düzenle/iptal yetkisi ise yalnız
-- siparişi veren oturuma aittir ('benim' alanı). Kapanmış eski adisyonlar
-- görünmez (önceki müşterinin dökümü sızmaz).
drop function if exists public.oturum_siparisleri(text);

create function public.oturum_siparisleri(p_token text)
returns table (
  siparis_id uuid,
  durum public.siparis_durum,
  created_at timestamptz,
  kalemler jsonb,
  toplam numeric,
  benim boolean
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
    (s.masa_oturumu_id = v_oturum.id)
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
