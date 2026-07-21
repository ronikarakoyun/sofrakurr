import Svg, { Path } from "react-native-svg";

// Tasarım dosyasındaki (Uygulama Ekranı.dc.html) çizgi ikon seti — aynı path'ler
const YOLLAR: Record<string, string[]> = {
  ev: ["M4 11l8-7 8 7", "M6 9.5V20h4.5v-5h3v5H18V9.5"],
  kahve: [
    "M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9z",
    "M16 10h1a2.5 2.5 0 0 1 0 5h-1",
    "M8.5 3.5v2",
    "M12 3.5v2",
  ],
  sepet: [
    "M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h7.6a1.5 1.5 0 0 0 1.5-1.2L20 8H6",
    "M9.5 20.2a0.4 0.4 0 1 0 0.01 0",
    "M17 20.2a0.4 0.4 0 1 0 0.01 0",
  ],
  kisi: [
    "M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    "M4.5 20.5c1.2-3.4 4-5 7.5-5s6.3 1.6 7.5 5",
  ],
  kampanya: [
    "M20.6 13.4L11 3.8a2 2 0 0 0-1.4-.6H4.2a1 1 0 0 0-1 1v5.4c0 .5.2 1 .6 1.4l9.6 9.6a2 2 0 0 0 2.8 0l4.4-4.4a2 2 0 0 0 0-2.8z",
    "M7.5 7.5l.01 0",
  ],
  hediye: [
    "M3 8h18v4H3z",
    "M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8",
    "M12 8v13",
    "M12 8s-1.5-4.5-4-4.5a2 2 0 0 0 0 4H12z",
    "M12 8s1.5-4.5 4-4.5a2 2 0 0 1 0 4H12z",
  ],
  elmas: [
    "M12 3.5l6.5 8.5-6.5 8.5L5.5 12z",
    "M12 7.5l3.4 4.5-3.4 4.5L8.6 12z",
  ],
  kart: ["M2.5 5h19v14h-19z", "M2.5 9.5h19"],
};

import type { ColorValue } from "react-native";

export function Ikon({
  ad,
  boyut = 22,
  renk = "#8a4b1f",
  kalinlik = 1.8,
}: {
  ad: keyof typeof YOLLAR | string;
  boyut?: number;
  renk?: ColorValue;
  kalinlik?: number;
}) {
  const yollar = YOLLAR[ad] ?? YOLLAR.kahve;
  return (
    <Svg width={boyut} height={boyut} viewBox="0 0 24 24" fill="none">
      {yollar.map((d, i) => (
        <Path
          key={i}
          d={d}
          stroke={renk}
          strokeWidth={kalinlik}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}
