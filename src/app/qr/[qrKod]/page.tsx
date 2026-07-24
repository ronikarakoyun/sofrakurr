import Link from "next/link";

// QR menü emekli edildi (app-only self-servis): masalardaki basılı QR kodları
// 404 vermesin diye bu sayfa müşteriyi uygulamaya yönlendirir.
export default function QrYonlendirme() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-krem p-8 text-center text-metin">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt="SofraKur logosu"
        className="h-16 w-16 rounded-2xl shadow-[0_6px_18px_rgba(138,75,31,0.3)]"
      />
      <div>
        <h1 className="font-serif text-2xl font-semibold text-metin-baslik">
          Sipariş artık uygulamada 📱
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-metin-soluk">
          QR menü yerini <span className="font-bold text-metin">SofraKur uygulamasına</span>{" "}
          bıraktı. Uygulamayı indir, <span className="font-bold text-metin">Kafeler</span>{" "}
          sekmesinden bu kafeyi seç — siparişin doğrudan mutfağa düşer, hazır olunca
          bildirim gelir.
        </p>
      </div>
      <p className="rounded-xl bg-uyari-zemin px-4 py-2.5 text-[12.5px] font-semibold text-uyari">
        Uygulama çok yakında App Store ve Google Play&apos;de.
      </p>
      <Link href="/" className="text-xs text-metin-silik underline">
        sofrakur.com
      </Link>
    </main>
  );
}
