-- Düzeltme: 0026'da iç _rapor_* fonksiyonlarının execute yetkisi authenticated'dan
-- alınınca, invoker sarmalayıcılar onları çağıramaz oldu (admin dahil hiç kimse
-- rapor göremiyordu). İç fonksiyonlara execute geri verilir; yetki denetimi
-- sarmalayıcıdaki rapor_yetki() ile sürer (UI ve normal REST çağrısı hep
-- sarmalayıcıya gider). İç fonksiyonlar zaten security invoker + RLS olduğundan
-- doğrudan çağrılsalar bile kiracılar arası veri sızmaz.

grant execute on function public._rapor_ozet(timestamptz, timestamptz) to authenticated;
grant execute on function public._rapor_gunluk(timestamptz, timestamptz) to authenticated;
grant execute on function public._rapor_saatlik(timestamptz, timestamptz) to authenticated;
grant execute on function public._rapor_urun(timestamptz, timestamptz) to authenticated;
grant execute on function public._rapor_iptaller(timestamptz, timestamptz) to authenticated;
grant execute on function public._rapor_personel(timestamptz, timestamptz) to authenticated;
