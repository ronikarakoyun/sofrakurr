-- Masa dijital sıfırlama: masa tamamen boşaldığında (açık hesap yok + aktif
-- sipariş yok) o masanın tüm QR oturumları anında sonlandırılır. Böylece
-- kalkan müşterinin açık kalan sayfası, sonraki müşterinin siparişlerini göremez.

create function public.masa_bosaldiysa_sifirla(p_masa_id uuid)
returns void
language plpgsql security definer set search_path = public as
$$
begin
  if exists (select 1 from public.adisyon where masa_id = p_masa_id and durum = 'acik') then
    return;
  end if;
  if exists (
    select 1 from public.siparis
    where masa_id = p_masa_id
      and durum in ('odeme_bekliyor', 'bekliyor', 'hazirlaniyor', 'hazir')
  ) then
    return;
  end if;
  update public.masa_oturumu
    set bitis = now()
    where masa_id = p_masa_id and bitis > now();
end
$$;

create function public.adisyon_kapaninca_sifirla() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if new.durum in ('odendi', 'iptal') and old.durum = 'acik' then
    perform public.masa_bosaldiysa_sifirla(new.masa_id);
  end if;
  return new;
end
$$;

create trigger adisyon_masa_sifirla
  after update of durum on public.adisyon
  for each row execute function public.adisyon_kapaninca_sifirla();

create function public.siparis_bitince_sifirla() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if new.durum in ('teslim', 'iptal', 'reddedildi')
     and old.durum not in ('teslim', 'iptal', 'reddedildi') then
    perform public.masa_bosaldiysa_sifirla(new.masa_id);
  end if;
  return new;
end
$$;

create trigger siparis_masa_sifirla
  after update of durum on public.siparis
  for each row execute function public.siparis_bitince_sifirla();
