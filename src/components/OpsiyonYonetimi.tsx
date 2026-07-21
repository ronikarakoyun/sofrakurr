"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { tl, type Urun } from "@/lib/types";

// Bir ürünün opsiyon gruplarını (Süt Tercihi, Ekstra vb.) yöneten panel.
export function OpsiyonYonetimi({
  urun,
  cafeId,
  kapat,
  degisti,
}: {
  urun: Urun;
  cafeId: string;
  kapat: () => void;
  degisti: () => void;
}) {
  const [yeniGrup, setYeniGrup] = useState<{ ad: string; zorunlu: boolean } | null>(null);
  const [yeniOpsiyon, setYeniOpsiyon] = useState<{ grupId: string; ad: string; ekFiyat: string } | null>(null);
  const [silinecekGrup, setSilinecekGrup] = useState<string | null>(null);

  async function grupEkle() {
    if (!yeniGrup?.ad.trim()) return;
    const supabase = createClient();
    await supabase.from("opsiyon_grubu").insert({
      cafe_id: cafeId,
      urun_id: urun.id,
      ad: yeniGrup.ad.trim(),
      min_secim: yeniGrup.zorunlu ? 1 : 0,
      max_secim: 1,
      sira: urun.opsiyon_grubu.length,
    });
    setYeniGrup(null);
    degisti();
  }

  async function grupSil(grupId: string) {
    const supabase = createClient();
    await supabase.from("opsiyon_grubu").delete().eq("id", grupId);
    setSilinecekGrup(null);
    degisti();
  }

  async function opsiyonEkle() {
    if (!yeniOpsiyon?.ad.trim()) return;
    const ek = parseFloat((yeniOpsiyon.ekFiyat || "0").replace(",", "."));
    if (isNaN(ek) || ek < 0) return;
    const grup = urun.opsiyon_grubu.find((g) => g.id === yeniOpsiyon.grupId);
    const supabase = createClient();
    await supabase.from("opsiyon").insert({
      cafe_id: cafeId,
      opsiyon_grubu_id: yeniOpsiyon.grupId,
      ad: yeniOpsiyon.ad.trim(),
      ek_fiyat: ek,
      sira: grup?.opsiyon.length ?? 0,
    });
    setYeniOpsiyon(null);
    degisti();
  }

  async function opsiyonSil(opsiyonId: string) {
    const supabase = createClient();
    await supabase.from("opsiyon").delete().eq("id", opsiyonId);
    degisti();
  }

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
              {urun.ad} — Opsiyonlar
            </div>
            <p className="mt-1 text-[12.5px] text-metin-soluk">
              Zorunlu gruplarda müşteri bir seçim yapmadan sipariş veremez (örn. Türk kahvesinde
              şeker). Ek fiyat 0 olabilir.
            </p>
          </div>
          <button
            onClick={kapat}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-krem-koyu text-[17px] text-marka-koyu"
          >
            ×
          </button>
        </div>

        {urun.opsiyon_grubu.length === 0 && !yeniGrup && (
          <p className="mt-4 text-sm text-metin-soluk">Bu üründe henüz opsiyon grubu yok.</p>
        )}

        {urun.opsiyon_grubu.map((g) => (
          <section key={g.id} className="mt-4 rounded-2xl border border-cizgi p-3.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-extrabold">{g.ad}</span>
              <span
                className={
                  "rounded px-1.5 py-0.5 text-[10.5px] font-extrabold " +
                  (g.min_secim >= 1
                    ? "bg-uyari-zemin text-uyari"
                    : "bg-krem-koyu text-metin-orta")
                }
              >
                {g.min_secim >= 1 ? "zorunlu" : "isteğe bağlı"}
              </span>
              <span className="flex-1" />
              {silinecekGrup === g.id ? (
                <span className="flex items-center gap-1.5">
                  <button
                    onClick={() => setSilinecekGrup(null)}
                    className="px-1.5 text-xs font-bold text-metin-orta"
                  >
                    Vazgeç
                  </button>
                  <button
                    onClick={() => grupSil(g.id)}
                    className="rounded-lg bg-tehlike px-2.5 py-1.5 text-xs font-extrabold text-white"
                  >
                    Grubu sil
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setSilinecekGrup(g.id)}
                  className="px-1.5 text-xs font-bold text-tehlike-yumusak hover:underline"
                >
                  Sil
                </button>
              )}
            </div>

            <div className="mt-2.5 flex flex-col gap-1.5">
              {g.opsiyon.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center gap-2.5 rounded-[10px] bg-krem px-3 py-2 text-sm"
                >
                  <span className="flex-1 font-semibold">{o.ad}</span>
                  <span className="tabular-nums text-metin-soluk">
                    {Number(o.ek_fiyat) > 0 ? `+${tl(Number(o.ek_fiyat))}` : "ücretsiz"}
                  </span>
                  <button
                    onClick={() => opsiyonSil(o.id)}
                    className="text-xs font-bold text-tehlike-yumusak hover:underline"
                  >
                    Sil
                  </button>
                </div>
              ))}
            </div>

            {yeniOpsiyon?.grupId === g.id ? (
              <div className="mt-2.5 flex gap-2">
                <input
                  autoFocus
                  value={yeniOpsiyon.ad}
                  onChange={(e) => setYeniOpsiyon({ ...yeniOpsiyon, ad: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && opsiyonEkle()}
                  placeholder="Seçenek adı"
                  className={inputStil + " flex-1"}
                />
                <input
                  value={yeniOpsiyon.ekFiyat}
                  onChange={(e) => setYeniOpsiyon({ ...yeniOpsiyon, ekFiyat: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && opsiyonEkle()}
                  placeholder="+TL"
                  inputMode="decimal"
                  className={inputStil + " w-20"}
                />
                <button
                  onClick={opsiyonEkle}
                  className="rounded-[10px] bg-basari px-3.5 text-sm font-extrabold text-white"
                >
                  ✓
                </button>
              </div>
            ) : (
              <button
                onClick={() => setYeniOpsiyon({ grupId: g.id, ad: "", ekFiyat: "" })}
                className="mt-2 rounded-lg px-1.5 py-1 text-[13px] font-bold text-basari hover:bg-basari-zemin"
              >
                + Seçenek ekle
              </button>
            )}
          </section>
        ))}

        {yeniGrup ? (
          <div className="mt-4 flex flex-col gap-2.5 rounded-2xl border-[1.5px] border-[#9bc4a8] p-3.5">
            <input
              autoFocus
              value={yeniGrup.ad}
              onChange={(e) => setYeniGrup({ ...yeniGrup, ad: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && grupEkle()}
              placeholder="Grup adı (örn. Süt Tercihi)"
              className={inputStil}
            />
            <label className="flex items-center gap-2 text-sm font-semibold text-metin-orta">
              <input
                type="checkbox"
                checked={yeniGrup.zorunlu}
                onChange={(e) => setYeniGrup({ ...yeniGrup, zorunlu: e.target.checked })}
              />
              Zorunlu (müşteri mutlaka bir seçim yapar)
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setYeniGrup(null)}
                className="px-2.5 py-2 text-[13.5px] font-bold text-metin-soluk"
              >
                Vazgeç
              </button>
              <button
                onClick={grupEkle}
                className="rounded-[10px] bg-basari px-4 py-2 text-[13.5px] font-extrabold text-white"
              >
                Grubu Ekle
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setYeniGrup({ ad: "", zorunlu: false })}
            className="marka-gradyan mt-4 w-full rounded-xl p-3 text-sm font-extrabold text-white"
          >
            + Opsiyon Grubu Ekle
          </button>
        )}
      </div>
    </div>
  );
}
