"use client";

import { useEffect, useRef, useState } from "react";

// Sola kaydırınca eylemi tetikleyen kart sarmalayıcısı (kasa numara şeridi).
//
// Tasarım notları:
// • touch-action: pan-y — yön kilidini tarayıcıya devrederiz; dikey kaydırma
//   hiç bozulmaz, JS'te deltaX/deltaY karşılaştırmasına gerek kalmaz.
// • Fare ile sürükleme KAPALI: masaüstünde zaten buton var, sürükleme metin
//   seçimiyle çakışır. Dokunmatik (parmak/kalem) için açıktır.
// • Buton her koşulda görünür kalır — kaydırma yalnız kısayoldur (erişilebilirlik).
export function KaydirilabilirKart({
  onKaydir,
  etiket,
  aktif = true,
  className = "",
  children,
}: {
  onKaydir: () => void;
  etiket: string;
  aktif?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [yaylaniyor, setYaylaniyor] = useState(false);
  const [cikiyor, setCikiyor] = useState(false);
  const kap = useRef<HTMLDivElement>(null);
  const baslangic = useRef<{ x: number; t: number } | null>(null);
  const tetiklendi = useRef(false);
  // Anlık kaydırma mesafesi: hızlı flick'te son "move" ile "up" aynı karede
  // gelebilir ve React state'i henüz güncellenmemiş olur — karar ref'ten okunur.
  const dxRef = useRef(0);

  // Eylem, çıkış animasyonu bitince çalışır. Sekme arka plandayken tarayıcı
  // animasyonları duraklatır (animationend hiç gelmez) — zaman aşımı yedeği
  // baristanın dokunuşunun kaybolmamasını garanti eder. İki yol da tek kez.
  function tamamla() {
    if (tetiklendi.current) return;
    tetiklendi.current = true;
    onKaydir();
  }

  useEffect(() => {
    if (!cikiyor) return;
    const z = setTimeout(tamamla, 260);
    return () => clearTimeout(z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cikiyor]);

  const OLU_BOLGE = 8; // kaza dokunuşlarını yut
  const esik = () => Math.min((kap.current?.offsetWidth ?? 320) * 0.35, 120);
  const ilerleme = Math.min(1, Math.abs(dx) / esik());

  function kaydir(deger: number) {
    dxRef.current = deger;
    setDx(deger);
  }

  function basla(e: React.PointerEvent) {
    if (!aktif || cikiyor || e.pointerType === "mouse") return;
    baslangic.current = { x: e.clientX, t: e.timeStamp };
    setYaylaniyor(false);
  }

  function hareket(e: React.PointerEvent) {
    if (!baslangic.current) return;
    const fark = e.clientX - baslangic.current.x;
    if (fark > 0) return kaydir(0); // yalnız sola
    const mesafe = Math.abs(fark);
    kaydir(mesafe > OLU_BOLGE ? fark + OLU_BOLGE : 0);
  }

  function bitir(e: React.PointerEvent) {
    if (!baslangic.current) return;
    const mesafe = Math.abs(dxRef.current);
    const sure = Math.max(1, e.timeStamp - baslangic.current.t);
    const hiz = mesafe / sure; // px/ms
    baslangic.current = null;

    if (mesafe >= esik() || (mesafe > OLU_BOLGE * 3 && hiz > 0.6)) {
      setCikiyor(true); // animasyon (ya da zaman aşımı) bitince onKaydir()
      return;
    }
    setYaylaniyor(true);
    kaydir(0);
  }

  return (
    <div ref={kap} className="relative overflow-hidden rounded-[16px]">
      {/* Kaydırdıkça arkadan çıkan onay zemini */}
      {dx < 0 && (
        <div
          className="absolute inset-0 flex items-center justify-end rounded-[16px] bg-basari pr-5 text-[15px] font-extrabold text-white"
          style={{ opacity: ilerleme }}
        >
          {etiket}
        </div>
      )}

      <div
        onPointerDown={basla}
        onPointerMove={hareket}
        onPointerUp={bitir}
        onPointerCancel={() => {
          baslangic.current = null;
          setYaylaniyor(true);
          kaydir(0);
        }}
        onAnimationEnd={() => {
          if (cikiyor) tamamla();
        }}
        className={"relative " + (cikiyor ? "anim-kaydir-cik " : "") + className}
        style={{
          transform: `translateX(${dx}px)`,
          transition: yaylaniyor ? "transform 180ms cubic-bezier(0.2,0.8,0.2,1)" : undefined,
          touchAction: "pan-y",
        }}
      >
        {children}
      </div>
    </div>
  );
}
