"use client";

// 80mm termal yazıcı fişi. Ekranda gizlidir; yalnız yazdırmada görünür.
// Chrome'u --kiosk-printing ile açarsanız diyalog çıkmadan sessiz basar.
export interface FisVerisi {
  masaAd: string;
  istasyon: string; // "MUTFAK", "BAR", "TÜMÜ" ...
  saat: string;
  kalemler: { adet: number; ad: string; opsiyonlar: string; not?: string; }[];
  not?: string | null;
}

export function SiparisFisi({ fis }: { fis: FisVerisi | null }) {
  if (!fis) return null;
  return (
    <>
      <style>{`
        @page { size: 80mm auto; margin: 3mm; }
        @media print {
          body * { visibility: hidden; }
          #fis-alani, #fis-alani * { visibility: visible; }
          #fis-alani { display: block !important; position: absolute; left: 0; top: 0; width: 72mm; }
        }
      `}</style>
      <div id="fis-alani" className="hidden font-mono text-black">
        <div style={{ textAlign: "center", fontWeight: 800, fontSize: "13px", letterSpacing: "1px" }}>
          ── {fis.istasyon} ──
        </div>
        <div style={{ marginTop: "6px", textAlign: "center", fontWeight: 800, fontSize: "26px" }}>
          {fis.masaAd}
        </div>
        <div style={{ textAlign: "center", fontSize: "12px" }}>{fis.saat}</div>
        <div style={{ margin: "6px 0", borderTop: "1px dashed #000" }} />
        {fis.kalemler.map((k, i) => (
          <div key={i} style={{ fontSize: "15px", fontWeight: 700, marginTop: "4px" }}>
            {k.adet} x {k.ad}
            {k.opsiyonlar && (
              <div style={{ fontSize: "12px", fontWeight: 400, paddingLeft: "14px" }}>
                → {k.opsiyonlar}
              </div>
            )}
            {k.not && (
              <div style={{ fontSize: "12px", fontWeight: 700, paddingLeft: "14px" }}>
                ✎ {k.not}
              </div>
            )}
          </div>
        ))}
        {fis.not && (
          <div style={{ marginTop: "6px", fontSize: "13px", fontWeight: 700 }}>
            NOT: {fis.not}
          </div>
        )}
        <div style={{ margin: "8px 0 2px", borderTop: "1px dashed #000" }} />
        <div style={{ textAlign: "center", fontSize: "10px" }}>SofraKur</div>
      </div>
    </>
  );
}
