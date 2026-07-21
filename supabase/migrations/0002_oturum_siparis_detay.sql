-- Siparişlerim ekranı için: durumun yanında kalem dökümü ve toplam da dönsün.
drop function if exists public.oturum_siparisleri(text);

create function public.oturum_siparisleri(p_token text)
returns table (
  siparis_id uuid,
  durum public.siparis_durum,
  created_at timestamptz,
  kalemler jsonb,
  toplam numeric
)
language sql stable security definer set search_path = public as
$$
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
            'tutar', (k.birim_fiyat + k.opsiyon_ek_fiyat) * k.adet
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
    )
  from public.siparis s
  join public.masa_oturumu mo on mo.id = s.masa_oturumu_id
  where mo.token = p_token
  order by s.created_at desc
$$;

revoke execute on function public.oturum_siparisleri(text) from public;
grant execute on function public.oturum_siparisleri(text) to anon, authenticated;
