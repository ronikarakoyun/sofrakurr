"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CikisButonu } from "@/components/CikisButonu";
import { useKullanici } from "@/lib/useKullanici";

const NAV = [
  { href: "/admin", ad: "Genel Bakış" },
  { href: "/admin/menu", ad: "Menü" },
  { href: "/admin/stok", ad: "Stok" },
  { href: "/admin/sayim", ad: "Sayım" },
  { href: "/admin/raporlar", ad: "Raporlar" },
  { href: "/admin/sadakat", ad: "Sadakat" },
  { href: "/admin/kampanyalar", ad: "Kampanyalar" },
  { href: "/admin/tedarikci", ad: "Tedarikçi" },
  { href: "/admin/personel", ad: "Personel" },
  { href: "/admin/entegrasyonlar", ad: "Entegrasyonlar" },
];

export function AdminKabuk({ children }: { children: React.ReactNode }) {
  const yol = usePathname();
  // Kafe adını başlıkta göstermek için (guard'ı admin sayfası zaten yapıyor;
  // buradaki çağrı yalnız efektif kafe adını çeker).
  const { kullanici } = useKullanici(["admin"]);
  return (
    <div className="flex min-h-dvh flex-wrap bg-krem text-metin">
      {/* Yan menü */}
      <aside className="flex w-full flex-shrink-0 flex-col border-b border-[#eee2d2] bg-kart p-4 sm:min-h-dvh sm:w-[232px] sm:border-b-0 sm:border-r sm:px-3.5 sm:py-5">
        <div className="flex items-center gap-3 px-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="SofraKur logosu" className="h-10 w-10 rounded-xl" />
          <div>
            <div className="text-[15.5px] font-extrabold leading-tight">SofraKur</div>
            <div className="text-xs text-metin-soluk">{kullanici?.cafe_ad ?? "…"} · Yönetim</div>
          </div>
        </div>

        <nav className="kaydirmasiz -mx-4 mt-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:mt-6 sm:flex-col sm:overflow-visible sm:px-0">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={
                "flex-shrink-0 whitespace-nowrap rounded-[11px] px-3 py-2.5 text-sm font-bold " +
                (yol === n.href
                  ? "marka-gradyan text-white"
                  : "text-metin-orta hover:bg-krem")
              }
            >
              {n.ad}
            </Link>
          ))}
        </nav>

        <div className="hidden flex-1 sm:block" />
        <div className="mt-2 sm:mt-0">
          <CikisButonu />
        </div>
      </aside>

      {/* İçerik */}
      <main className="min-w-[320px] flex-1 px-5 pb-12 pt-6 sm:px-8">
        {/* Sağ üst: mutfak ekranına hızlı geçiş (admin oturumu KDS'e de erişir) */}
        <div className="-mt-1 mb-3 flex justify-end">
          <Link
            href="/kds"
            className="rounded-[10px] border border-cizgi-koyu bg-kart px-3 py-2 text-[13px] font-bold text-metin-orta hover:border-marka"
          >
            Mutfak Ekranı →
          </Link>
        </div>
        {children}
      </main>
    </div>
  );
}
