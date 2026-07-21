-- Rapor RPC'leri artık yalnız admin+kasa çağırabilir (garson konsoldan ciro/kâr
-- raporu okuyamaz). Fonksiyon gövdeleri _rapor_* olarak korunur; guard'lı ince
-- sarmalayıcılar aynı imzayla yeniden oluşturulur.

create or replace function public.rapor_yetki() returns void
language plpgsql stable security definer set search_path = public as
$$
begin
  if not (public.aktif_rol() = any (array['admin','kasa']::public.kullanici_rol[])) then
    raise exception 'Rapor verilerine erişim yetkiniz yok';
  end if;
end
$$;

-- rapor_ozet ------------------------------------------------------------------
alter function public.rapor_ozet(timestamptz, timestamptz) rename to _rapor_ozet;
create function public.rapor_ozet(p_baslangic timestamptz, p_bitis timestamptz)
returns table (
  ciro numeric, nakit_ciro numeric, kart_ciro numeric, adisyon_sayisi bigint,
  siparis_sayisi bigint, ortalama_adisyon numeric, iptal_sayisi bigint,
  iptal_tutar numeric, ikram_tutar numeric, iskonto_tutar numeric,
  cariye_yazilan numeric, cari_tahsilat numeric
) language plpgsql stable security invoker set search_path = public as
$$ begin perform public.rapor_yetki();
   return query select * from public._rapor_ozet(p_baslangic, p_bitis); end $$;

-- rapor_gunluk ----------------------------------------------------------------
alter function public.rapor_gunluk(timestamptz, timestamptz) rename to _rapor_gunluk;
create function public.rapor_gunluk(p_baslangic timestamptz, p_bitis timestamptz)
returns table (gun date, ciro numeric, adisyon_sayisi bigint)
language plpgsql stable security invoker set search_path = public as
$$ begin perform public.rapor_yetki();
   return query select * from public._rapor_gunluk(p_baslangic, p_bitis); end $$;

-- rapor_saatlik ---------------------------------------------------------------
alter function public.rapor_saatlik(timestamptz, timestamptz) rename to _rapor_saatlik;
create function public.rapor_saatlik(p_baslangic timestamptz, p_bitis timestamptz)
returns table (saat int, siparis_sayisi bigint)
language plpgsql stable security invoker set search_path = public as
$$ begin perform public.rapor_yetki();
   return query select * from public._rapor_saatlik(p_baslangic, p_bitis); end $$;

-- rapor_urun ------------------------------------------------------------------
alter function public.rapor_urun(timestamptz, timestamptz) rename to _rapor_urun;
create function public.rapor_urun(p_baslangic timestamptz, p_bitis timestamptz)
returns table (urun_ad text, adet bigint, ciro numeric, maliyet numeric)
language plpgsql stable security invoker set search_path = public as
$$ begin perform public.rapor_yetki();
   return query select * from public._rapor_urun(p_baslangic, p_bitis); end $$;

-- rapor_iptaller --------------------------------------------------------------
alter function public.rapor_iptaller(timestamptz, timestamptz) rename to _rapor_iptaller;
create function public.rapor_iptaller(p_baslangic timestamptz, p_bitis timestamptz)
returns table (zaman timestamptz, masa_ad text, durum public.siparis_durum, tutar numeric, kalemler text)
language plpgsql stable security invoker set search_path = public as
$$ begin perform public.rapor_yetki();
   return query select * from public._rapor_iptaller(p_baslangic, p_bitis); end $$;

-- rapor_personel --------------------------------------------------------------
alter function public.rapor_personel(timestamptz, timestamptz) rename to _rapor_personel;
create function public.rapor_personel(p_baslangic timestamptz, p_bitis timestamptz)
returns table (kanal text, siparis_sayisi bigint)
language plpgsql stable security invoker set search_path = public as
$$ begin perform public.rapor_yetki();
   return query select * from public._rapor_personel(p_baslangic, p_bitis); end $$;

-- İç fonksiyonlar yalnız sarmalayıcı üzerinden çağrılsın
revoke execute on function public._rapor_ozet(timestamptz, timestamptz) from public, authenticated;
revoke execute on function public._rapor_gunluk(timestamptz, timestamptz) from public, authenticated;
revoke execute on function public._rapor_saatlik(timestamptz, timestamptz) from public, authenticated;
revoke execute on function public._rapor_urun(timestamptz, timestamptz) from public, authenticated;
revoke execute on function public._rapor_iptaller(timestamptz, timestamptz) from public, authenticated;
revoke execute on function public._rapor_personel(timestamptz, timestamptz) from public, authenticated;

grant execute on function public.rapor_ozet(timestamptz, timestamptz) to authenticated;
grant execute on function public.rapor_gunluk(timestamptz, timestamptz) to authenticated;
grant execute on function public.rapor_saatlik(timestamptz, timestamptz) to authenticated;
grant execute on function public.rapor_urun(timestamptz, timestamptz) to authenticated;
grant execute on function public.rapor_iptaller(timestamptz, timestamptz) to authenticated;
grant execute on function public.rapor_personel(timestamptz, timestamptz) to authenticated;
