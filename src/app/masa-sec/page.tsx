"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface MasaSecenek {
  bolum_ad: string | null;
  masa_ad: string;
  qr_kod: string;
}

// Eski jenerik QR köprüsü: masa bilgisi taşımayan QR'ı okutan müşteri buraya
// düşer, masasını seçer, o masanın tam işlevli menüsüne geçer.
function MasaSecIcerik() {
  const router = useRouter();
  const arama = useSearchParams();
  const cafeId = arama.get("kafe");
  const [masalar, setMasalar] = useState<MasaSecenek[] | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  useEffect(() => {
    if (!cafeId) {
      setHata("Kafe bilgisi eksik. Lütfen masadaki QR kodu okutun.");
      return;
    }
    const supabase = createClient();
    supabase.rpc("masa_listesi", { p_cafe_id: cafeId }).then(({ data, error }) => {
      if (error || !data?.length) {
        setHata("Masalar yüklenemedi. Lütfen garsona haber verin.");
        return;
      }
      setMasalar(data as MasaSecenek[]);
    });
  }, [cafeId]);

  if (hata) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-krem p-8 text-center">
        <p className="text-lg text-metin-orta">{hata}</p>
      </main>
    );
  }
  if (!masalar) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-krem p-8">
        <p className="animate-pulse text-lg text-metin-soluk">Masalar yükleniyor…</p>
      </main>
    );
  }

  const bolumler = [...new Set(masalar.map((m) => m.bolum_ad ?? ""))];

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg bg-krem text-metin">
      <header className="marka-gradyan px-5 pb-4 pt-6 text-white">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="SofraKur" className="h-10 w-10 rounded-xl" />
          <div>
            <div className="font-serif text-[21px] font-bold">Hoş geldiniz 👋</div>
            <div className="text-[12.5px] opacity-85">Menü için masanızı seçin</div>
          </div>
        </div>
      </header>

      <div className="px-4 pb-12 pt-4">
        <p className="mb-3 rounded-xl bg-uyari-zemin px-3.5 py-2.5 text-[12.5px] leading-relaxed text-uyari">
          Hangi masada oturuyorsanız onu seçin — siparişiniz o masaya yazılır ve garson
          onayıyla hazırlanmaya başlar.
        </p>
        {bolumler.map((b) => (
          <section key={b} className="mb-4">
            {b && (
              <h2 className="mb-2 font-serif text-[17px] font-semibold text-metin-baslik">{b}</h2>
            )}
            <div className="grid grid-cols-3 gap-2.5">
              {masalar
                .filter((m) => (m.bolum_ad ?? "") === b)
                .map((m) => (
                  <button
                    key={m.qr_kod}
                    onClick={() => router.push(`/qr/${m.qr_kod}`)}
                    className="anim-kart flex min-h-[64px] items-center justify-center rounded-[15px] border border-cizgi bg-kart px-2 py-3 text-[15px] font-extrabold text-metin-baslik shadow-[0_1px_3px_rgba(90,58,29,0.05)] active:bg-krem-koyu"
                  >
                    {m.masa_ad}
                  </button>
                ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

export default function MasaSecPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-krem p-8">
          <p className="animate-pulse text-lg text-metin-soluk">Yükleniyor…</p>
        </main>
      }
    >
      <MasaSecIcerik />
    </Suspense>
  );
}
