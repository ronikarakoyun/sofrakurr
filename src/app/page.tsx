import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 bg-krem p-8 text-metin">
      <div className="flex flex-col items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="SofraKur logosu"
          className="h-16 w-16 rounded-2xl shadow-[0_6px_18px_rgba(138,75,31,0.3)]"
        />
        <h1 className="font-serif text-3xl font-semibold text-metin-baslik">SofraKur</h1>
        <p className="text-sm text-metin-soluk">Kafeni seç, sipariş ver, sıra bekleme.</p>
      </div>

      <div className="anim-kart w-full max-w-md rounded-2xl border border-cizgi bg-kart p-6 text-center shadow-[0_1px_3px_rgba(90,58,29,0.05)]">
        <h2 className="font-serif text-lg font-semibold text-metin-baslik">
          Sipariş vermek için
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-metin-soluk">
          <span className="font-bold text-metin">SofraKur uygulamasını</span> indir,{" "}
          <span className="font-bold text-metin">Kafeler</span> sekmesinden kafeni seç —
          siparişin doğrudan mutfağa düşer, hazır olunca bildirim gelir; kasada sıra
          beklemezsin.
        </p>
        <p className="mt-3 rounded-xl bg-uyari-zemin px-3 py-2 text-[12px] font-semibold text-uyari">
          Uygulama çok yakında App Store ve Google Play&apos;de.
        </p>
      </div>

      <p className="max-w-md text-center text-xs text-metin-silik">
        Kafeniz için SofraKur&apos;u merak mı ettiniz?{" "}
        <a href="mailto:unalronik@gmail.com" className="underline">
          Bize yazın
        </a>
        {" · "}
        <Link href="/giris" className="underline">
          Personel Girişi
        </Link>
      </p>
    </main>
  );
}
