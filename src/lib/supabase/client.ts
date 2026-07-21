import { createBrowserClient } from "@supabase/ssr";

// "Beni hatırla" tercihi: açıkken oturum çerezi 1 yıl yaşar (şifre tekrar
// sorulmaz), kapalıyken 12 saat — vardiya bitince oturum düşer.
export const HATIRLA_ANAHTARI = "sofrakur-hatirla";
const BIR_YIL = 60 * 60 * 24 * 365;
const VARDIYA = 60 * 60 * 12;

// Vercel'de build sırasında prerender worker'ı process.env'i aralıklı olarak
// göremeyebiliyor; tarayıcı bundle'ına ise NEXT_PUBLIC_ değerleri build'de
// gömülüyor. Prerender'da (window yokken) env eksikse sorgu da çalışmadığı
// için yer tutucu değerlerle istemci kurup build'i kırmıyoruz; tarayıcıda
// eksikse bu gerçek bir yapılandırma hatasıdır ve yüksek sesle patlatıyoruz.
function baglantiBilgileri(): { url: string; anahtar: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anahtar = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && anahtar) return { url, anahtar };
  if (typeof window === "undefined") {
    return { url: "https://prerender-yer-tutucu.supabase.co", anahtar: "prerender-yer-tutucu" };
  }
  throw new Error(
    "Supabase ortam değişkenleri eksik: NEXT_PUBLIC_SUPABASE_URL ve NEXT_PUBLIC_SUPABASE_ANON_KEY tanımlı olmalı."
  );
}

export function beniHatirla(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(HATIRLA_ANAHTARI) !== "0";
}

// Tarayıcı tarafı Supabase istemcisi (QR Web, KDS, Kasa canlı ekranları)
export function createClient() {
  const { url, anahtar } = baglantiBilgileri();
  return createBrowserClient(url, anahtar, {
    cookieOptions: { maxAge: beniHatirla() ? BIR_YIL : VARDIYA },
  });
}

// Giriş formu için tekil olmayan istemci: kullanıcı kutucuğu az önce
// değiştirmiş olabilir; önbellekteki istemcinin eski çerez ömrünü kullanmamak
// için tercihe göre taze istemci kurar.
export function createGirisClient(hatirla: boolean) {
  const { url, anahtar } = baglantiBilgileri();
  return createBrowserClient(url, anahtar, {
    isSingleton: false,
    cookieOptions: { maxAge: hatirla ? BIR_YIL : VARDIYA },
  });
}
