-- Müşteri, ödemesi henüz onaylanmamış (odeme_bekliyor) siparişini
-- iptal edebilir ya da düzenleyebilir (düzenleme = iptal + sepete geri yükleme).
-- Kasiyer "Ödendi" dediği andan itibaren sipariş müşteri tarafından değiştirilemez.

-- Siparişlerim: düzenlemeyi mümkün kılmak için kalemlere urun_id ve opsiyonlar eklendi
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
    )
  from public.siparis s
  join public.masa_oturumu mo on mo.id = s.masa_oturumu_id
  where mo.token = p_token
  order by s.created_at desc
$$;

revoke execute on function public.oturum_siparisleri(text) from public;
grant execute on function public.oturum_siparisleri(text) to anon, authenticated;

-- Müşterinin kendi siparişini (yalnız ödeme onayı öncesi) iptali
create function public.oturum_siparis_iptal(p_token text, p_siparis_id uuid)
returns void
language plpgsql security definer set search_path = public as
$$
declare
  v_oturum public.masa_oturumu%rowtype;
begin
  select * into v_oturum from public.masa_oturumu
    where token = p_token and bitis > now();
  if not found then
    raise exception 'Oturum geçersiz veya süresi dolmuş; QR kodu yeniden okutun';
  end if;

  update public.siparis
  set durum = 'iptal'
  where id = p_siparis_id
    and masa_oturumu_id = v_oturum.id
    and durum = 'odeme_bekliyor';

  if not found then
    raise exception 'Bu sipariş artık değiştirilemez; lütfen kasaya danışın';
  end if;
end
$$;

revoke execute on function public.oturum_siparis_iptal(text, uuid) from public;
grant execute on function public.oturum_siparis_iptal(text, uuid) to anon, authenticated;
