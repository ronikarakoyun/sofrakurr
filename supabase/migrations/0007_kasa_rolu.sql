-- Kasiyer icin ayri rol: garson kasaya erisemez, kasa garson/mutfak ekranina erisemez.
-- Ekran yetkileri uygulama tarafinda bu role gore ayrilir.
alter type public.kullanici_rol add value if not exists 'kasa';
