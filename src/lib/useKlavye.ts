"use client";

import { useEffect, useState } from "react";

// Sanal klavyenin kapladığı yükseklik (px). iOS/Android'de klavye açılınca
// visualViewport küçülür; aradaki fark klavye yüksekliğidir. Paneller bu
// değeri alt boşluk olarak kullanır → içerik klavyenin ÜSTÜNDE kalır,
// "klavye ekranı kapatıyormuş gibi" yukarı kayar.
export function useKlavyeYuksekligi(): number {
  const [yukseklik, setYukseklik] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const olc = () => {
      const fark = window.innerHeight - vv.height - vv.offsetTop;
      setYukseklik(Math.max(0, Math.round(fark)));
    };
    olc();
    vv.addEventListener("resize", olc);
    vv.addEventListener("scroll", olc);
    return () => {
      vv.removeEventListener("resize", olc);
      vv.removeEventListener("scroll", olc);
    };
  }, []);

  return yukseklik;
}
