-- Siparişi kimin girdiği fişte görünecek: yazıcı ajanı (mutfak hesabı) ve diğer
-- personel, aynı kafedeki çalışma arkadaşlarının adını okuyabilmeli. Mevcut
-- politika yalnız kendi kaydını + admin'e her şeyi açıyordu.

create policy personel_ayni_kafe_okuma on public.kullanici
  for select using (cafe_id = public.aktif_cafe_id());
