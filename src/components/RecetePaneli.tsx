"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Birim = "gr" | "ml" | "adet";

interface Hammadde {
  id: string;
  ad: string;
  birim: Birim;
}

interface ReceteSatiri {
  id: string;
  miktar: number;
  hammadde: Hammadde;
}

// Bir ürünün reçetesini yönetir: Latte = 200 ml süt + 18 gr çekirdek.
// Her siparişte bu miktarlar hammadde stoğundan otomatik düşer.
export function RecetePaneli({
  urunId,
  urunAd,
  cafeId,
  kapat,
}: {
  urunId: string;
  urunAd: string;
  cafeId: string;
  kapat: () => void;
}) {
  const [satirlar, setSatirlar] = useState<ReceteSatiri[]>([]);
  const [hammaddeler, setHammaddeler] = useState<Hammadde[]>([]);
  const [seciliHammadde, setSeciliHammadde] = useState("");
  const [miktar, setMiktar] = useState("");
  const [yuklendi, setYuklendi] = useState(false);

  const yenile = useCallback(async () => {
    const supabase = createClient();
    const [r, h] = await Promise.all([
      supabase
        .from("recete")
        .select("id, miktar, hammadde(id, ad, birim)")
        .eq("urun_id", urunId),
      supabase.from("hammadde").select("id, ad, birim").eq("cafe_id", cafeId).order("ad"),
    ]);
    setSatirlar((r.data ?? []) as unknown as ReceteSatiri[]);
    setHammaddeler((h.data ?? []) as Hammadde[]);
    setYuklendi(true);
  }, [urunId, cafeId]);

  useEffect(() => {
    yenile();
  }, [yenile]);

  async function ekle() {
    const m = parseFloat(miktar.replace(",", "."));
    if (!seciliHammadde || isNaN(m) || m <= 0) return;
    const supabase = createClient();
    await supabase.from("recete").insert({
      cafe_id: cafeId,
      urun_id: urunId,
      hammadde_id: seciliHammadde,
      miktar: m,
    });
    setSeciliHammadde("");
    setMiktar("");
    yenile();
  }

  async function sil(id: string) {
    const supabase = createClient();
    await supabase.from("recete").delete().eq("id", id);
    yenile();
  }

  const eklenebilirler = hammaddeler.filter(
    (h) => !satirlar.some((s) => s.hammadde.id === h.id)
  );
  const seciliBirim = hammaddeler.find((h) => h.id === seciliHammadde)?.birim;
  const inputStil =
    "rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2 text-sm outline-none focus:border-marka";

  return (
    <div
      className="anim-fade fixed inset-0 z-30 flex items-end justify-center bg-[rgba(43,28,16,0.45)] sm:items-center"
      onClick={kapat}
    >
      <div
        className="anim-sheet kaydirmasiz max-h-[85dvh] w-full max-w-lg overflow-auto rounded-t-3xl bg-kart px-5 pb-10 pt-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2.5">
          <div className="flex-1">
            <div className="font-serif text-[19px] font-semibold text-metin-baslik">
              {urunAd} — Reçete
            </div>
            <p className="mt-1 text-[12.5px] text-metin-soluk">
              Her siparişte bu miktarlar hammadde stoğundan otomatik düşer; iptal/redde iade
              edilir.
            </p>
          </div>
          <button
            onClick={kapat}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-krem-koyu text-[17px] text-marka-koyu"
          >
            ×
          </button>
        </div>

        {yuklendi && hammaddeler.length === 0 ? (
          <p className="mt-4 rounded-xl bg-uyari-zemin px-3.5 py-3 text-sm text-uyari">
            Önce Stok sayfasından hammadde ekle (süt, çekirdek vb.), sonra buradan reçeteye bağla.
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-1.5">
              {satirlar.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2.5 rounded-[10px] bg-krem px-3 py-2 text-sm"
                >
                  <span className="flex-1 font-semibold">{s.hammadde.ad}</span>
                  <span className="tabular-nums text-metin-orta">
                    {Number(s.miktar).toLocaleString("tr-TR")} {s.hammadde.birim}
                  </span>
                  <button
                    onClick={() => sil(s.id)}
                    className="text-xs font-bold text-tehlike-yumusak hover:underline"
                  >
                    Sil
                  </button>
                </div>
              ))}
              {yuklendi && satirlar.length === 0 && (
                <p className="text-sm text-metin-soluk">Bu ürünün reçetesi henüz boş.</p>
              )}
            </div>

            {eklenebilirler.length > 0 && (
              <div className="mt-3.5 flex gap-2">
                <select
                  value={seciliHammadde}
                  onChange={(e) => setSeciliHammadde(e.target.value)}
                  className={inputStil + " flex-1"}
                >
                  <option value="">Hammadde seç…</option>
                  {eklenebilirler.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.ad} ({h.birim})
                    </option>
                  ))}
                </select>
                <input
                  value={miktar}
                  onChange={(e) => setMiktar(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && ekle()}
                  placeholder={seciliBirim ? `miktar (${seciliBirim})` : "miktar"}
                  inputMode="decimal"
                  className={inputStil + " w-32"}
                />
                <button
                  onClick={ekle}
                  className="rounded-[10px] bg-basari px-3.5 text-sm font-extrabold text-white"
                >
                  ✓
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
