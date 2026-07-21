"use client";

import { useState } from "react";

export interface Cubuk {
  etiket: string; // eksen etiketi (kısa)
  deger: number;
  vurgu?: boolean; // bugünü/aktif dönemi koyu tonla ayırır
  ipucu?: string; // hover'da gösterilen tam metin
}

// Tek serili, marka renkli basit çubuk grafik.
// Kurallar: ince çubuklar, 4px yuvarak veri ucu, 2px aralık, seçici etiket
// (yalnız en yüksek değer + vurgulu çubuk), hover'da tam değer.
export function BarGrafik({
  veriler,
  formatla = (n) => String(n),
  yukseklik = 128,
}: {
  veriler: Cubuk[];
  formatla?: (n: number) => string;
  yukseklik?: number;
}) {
  const [aktif, setAktif] = useState<number | null>(null);
  const enYuksek = Math.max(...veriler.map((v) => v.deger), 1);
  const maxIndex = veriler.findIndex((v) => v.deger === enYuksek);

  return (
    <div>
      <div className="flex items-end gap-[2px]" style={{ height: yukseklik }}>
        {veriler.map((v, i) => {
          const oran = v.deger / enYuksek;
          const etiketli = aktif === i || (aktif === null && (i === maxIndex || v.vurgu) && v.deger > 0);
          return (
            <div
              key={i}
              className="relative flex h-full flex-1 flex-col items-center justify-end"
              onMouseEnter={() => setAktif(i)}
              onMouseLeave={() => setAktif(null)}
            >
              {etiketli && (
                <span className="pointer-events-none absolute -top-1 z-10 -translate-y-full whitespace-nowrap rounded-md bg-metin px-1.5 py-0.5 text-[10.5px] font-bold text-white">
                  {v.ipucu ?? formatla(v.deger)}
                </span>
              )}
              <div
                className="w-full max-w-[26px] rounded-t"
                style={{
                  height: `${Math.max(oran * 100, v.deger > 0 ? 3 : 1)}%`,
                  background: v.vurgu ? "#8a4b1f" : "#c86f2c",
                  opacity: aktif === null || aktif === i ? 1 : 0.45,
                  transition: "opacity 0.12s",
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-[2px] border-t border-cizgi pt-1">
        {veriler.map((v, i) => (
          <span
            key={i}
            className={
              "flex-1 text-center text-[10px] font-semibold " +
              (v.vurgu ? "text-metin-baslik" : "text-metin-silik")
            }
          >
            {v.etiket}
          </span>
        ))}
      </div>
    </div>
  );
}
