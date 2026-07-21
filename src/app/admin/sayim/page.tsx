"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useKullanici } from "@/lib/useKullanici";
import { tl } from "@/lib/types";

type Birim = "gr" | "ml" | "adet";

interface SayilacakSatir {
  tip: "hammadde" | "urun";
  id: string;
  ad: string;
  birim: Birim;
  beklenen: number;
  birimMaliyet: number | null;
}

interface GecmisSayim {
  id: string;
  created_at: string;
  notu: string | null;
  sayim_kalemi: {
    ad: string;
    birim: string;
    beklenen: number;
    sayilan: number;
    birim_maliyet: number | null;
  }[];
}

const BUYUK: Record<Birim, { ad: string; carpan: number } | null> = {
  gr: { ad: "kg", carpan: 1000 },
  ml: { ad: "lt", carpan: 1000 },
  adet: null,
};

function miktarYaz(m: number, birim: string): string {
  const b = BUYUK[birim as Birim];
  if (b && Math.abs(m) >= b.carpan) {
    return `${(m / b.carpan).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} ${b.ad}`;
  }
  return `${m.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} ${birim}`;
}

export default function SayimPage() {
  const { kullanici, yukleniyor } = useKullanici(["admin"]);
  const [satirlar, setSatirlar] = useState<SayilacakSatir[]>([]);
  const [girisler, setGirisler] = useState<Record<string, string>>({});
  const [buyukBirim, setBuyukBirim] = useState<Record<string, boolean>>({});
  const [notu, setNotu] = useState("");
  const [soruluyor, setSoruluyor] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [sonuc, setSonuc] = useState<string | null>(null);
  const [gecmis, setGecmis] = useState<GecmisSayim[]>([]);
  const [acikSayim, setAcikSayim] = useState<string | null>(null);

  const yenile = useCallback(async () => {
    if (!kullanici) return;
    const supabase = createClient();
    const [h, u, g] = await Promise.all([
      supabase
        .from("hammadde")
        .select("id, ad, birim, stok_miktar, son_birim_fiyat")
        .eq("cafe_id", kullanici.cafe_id)
        .order("ad"),
      supabase
        .from("urun")
        .select("id, ad, stok_adet, stok_takip")
        .eq("cafe_id", kullanici.cafe_id)
        .eq("stok_takip", true)
        .order("ad"),
      supabase
        .from("sayim")
        .select("id, created_at, notu, sayim_kalemi(ad, birim, beklenen, sayilan, birim_maliyet)")
        .order("created_at", { ascending: false })
        .limit(12),
    ]);
    const hamlar: SayilacakSatir[] = ((h.data ?? []) as { id: string; ad: string; birim: Birim; stok_miktar: number; son_birim_fiyat: number | null }[]).map(
      (x) => ({ tip: "hammadde", id: x.id, ad: x.ad, birim: x.birim, beklenen: Number(x.stok_miktar), birimMaliyet: x.son_birim_fiyat != null ? Number(x.son_birim_fiyat) : null })
    );
    const urunler: SayilacakSatir[] = ((u.data ?? []) as { id: string; ad: string; stok_adet: number | null }[]).map((x) => ({
      tip: "urun", id: x.id, ad: x.ad, birim: "adet", beklenen: Number(x.stok_adet ?? 0), birimMaliyet: null,
    }));
    setSatirlar([...hamlar, ...urunler]);
    setGecmis((g.data ?? []) as unknown as GecmisSayim[]);
  }, [kullanici]);

  useEffect(() => {
    yenile();
  }, [yenile]);

  function bazMiktar(s: SayilacakSatir): number | null {
    const ham = girisler[s.id];
    if (ham === undefined || ham.trim() === "") return null;
    const n = parseFloat(ham.replace(",", "."));
    if (isNaN(n) || n < 0) return null;
    const b = BUYUK[s.birim];
    return buyukBirim[s.id] !== false && b ? n * b.carpan : n;
  }

  function zarar(s: SayilacakSatir): number | null {
    const sayilan = bazMiktar(s);
    if (sayilan === null || s.birimMaliyet === null) return null;
    return (s.beklenen - sayilan) * s.birimMaliyet;
  }

  const girilenler = satirlar.filter((s) => bazMiktar(s) !== null);
  const toplamZarar = girilenler.reduce((t, s) => t + Math.max(0, zarar(s) ?? 0), 0);

  async function kaydet() {
    if (!girilenler.length || kaydediliyor) return;
    setKaydediliyor(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("sayim_kaydet", {
      p_kalemler: girilenler.map((s) => ({ tip: s.tip, id: s.id, sayilan: bazMiktar(s) })),
      p_notu: notu.trim() || null,
    });
    setKaydediliyor(false);
    setSoruluyor(false);
    if (error) {
      setSonuc("Hata: " + error.message);
      return;
    }
    setSonuc(`Sayım kaydedildi — ${girilenler.length} kalem güncellendi.`);
    setGirisler({});
    setNotu("");
    setTimeout(() => setSonuc(null), 5000);
    yenile();
  }

  if (yukleniyor) {
    return <p className="animate-pulse text-metin-soluk">Yükleniyor…</p>;
  }

  const inputStil =
    "w-24 rounded-[9px] border border-cizgi-koyu bg-krem px-2.5 py-1.5 text-right text-sm font-bold outline-none focus:border-marka";

  return (
    <div className="max-w-[820px]">
      <h1 className="font-serif text-2xl font-semibold text-metin-baslik">Sayım</h1>
      <p className="mt-1 text-[13.5px] text-metin-soluk">
        Eldeki fiziksel miktarları say ve gir; sistem beklenenle karşılaştırıp <strong>fire ve
        zararı</strong> gösterir, stokları saydığına çeker. Boş bıraktıkların sayıma girmez.
      </p>

      {sonuc && (
        <p className={"mt-3 rounded-xl px-3.5 py-2.5 text-[13.5px] font-bold " + (sonuc.startsWith("Hata") ? "bg-tehlike-zemin text-tehlike" : "bg-basari-zemin text-basari")}>
          {sonuc}
        </p>
      )}

      {satirlar.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-cizgi bg-kart p-4 text-sm text-metin-soluk">
          Sayılacak bir şey yok — önce Stok sayfasından hammadde ekle veya vitrin ürünlerinde adet
          takibi aç.
        </p>
      ) : (
        <>
          <div className="mt-4 divide-y divide-[#f6ede1] overflow-hidden rounded-2xl border border-cizgi bg-kart">
            {satirlar.map((s) => {
              const sayilan = bazMiktar(s);
              const fark = sayilan !== null ? sayilan - s.beklenen : null;
              const z = zarar(s);
              const b = BUYUK[s.birim];
              return (
                <div key={s.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="min-w-[150px] flex-1">
                      <span className="text-[14.5px] font-bold">{s.ad}</span>
                      <span className="ml-2 whitespace-nowrap text-xs text-metin-silik">
                        {s.tip === "hammadde" ? "hammadde" : "vitrin"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="whitespace-nowrap text-xs text-metin-soluk">
                        beklenen <strong>{miktarYaz(s.beklenen, s.birim)}</strong>
                      </span>
                      <input
                        value={girisler[s.id] ?? ""}
                        onChange={(e) => setGirisler((g) => ({ ...g, [s.id]: e.target.value }))}
                        inputMode="decimal"
                        placeholder="sayılan"
                        className={inputStil}
                      />
                      {b ? (
                        <select
                          value={buyukBirim[s.id] === false ? "baz" : "buyuk"}
                          onChange={(e) => setBuyukBirim((x) => ({ ...x, [s.id]: e.target.value === "buyuk" }))}
                          className="rounded-[9px] border border-cizgi-koyu bg-krem px-2 py-1.5 text-sm font-bold outline-none"
                        >
                          <option value="buyuk">{b.ad}</option>
                          <option value="baz">{s.birim}</option>
                        </select>
                      ) : (
                        <span className="text-sm font-bold text-metin-soluk">adet</span>
                      )}
                    </div>
                  </div>

                  {fark !== null && (
                    <div className="mt-1.5 flex items-center justify-end gap-2 text-right">
                      <span
                        className={
                          "whitespace-nowrap rounded-full px-2.5 py-1 text-[12.5px] font-extrabold " +
                          (Math.abs(fark) < 0.01
                            ? "bg-basari-zemin text-basari"
                            : fark < 0
                              ? "bg-tehlike-zemin text-tehlike"
                              : "bg-uyari-zemin text-uyari")
                        }
                      >
                        {Math.abs(fark) < 0.01
                          ? "tam ✓"
                          : fark < 0
                            ? `fire ${miktarYaz(-fark, s.birim)}`
                            : `fazla ${miktarYaz(fark, s.birim)}`}
                      </span>
                      {z !== null && z > 0.005 && (
                        <span className="whitespace-nowrap text-[11.5px] font-bold text-tehlike">
                          zarar {tl(z)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Kaydet */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              value={notu}
              onChange={(e) => setNotu(e.target.value)}
              placeholder="Sayım notu (örn. Temmuz ay sonu)"
              className="min-w-[200px] flex-1 rounded-[10px] border border-cizgi-koyu bg-kart px-3 py-2.5 text-sm outline-none focus:border-marka"
            />
            {girilenler.length > 0 && toplamZarar > 0.005 && (
              <span className="rounded-full bg-tehlike-zemin px-3.5 py-1.5 text-[13px] font-extrabold text-tehlike">
                toplam fire zararı {tl(toplamZarar)}
              </span>
            )}
            {soruluyor ? (
              <span className="flex items-center gap-2">
                <button onClick={() => setSoruluyor(false)} className="px-2 text-[13px] font-bold text-metin-orta">
                  Vazgeç
                </button>
                <button
                  onClick={kaydet}
                  disabled={kaydediliyor}
                  className="rounded-xl bg-basari px-4 py-2.5 text-[13.5px] font-extrabold text-white disabled:opacity-50"
                >
                  {kaydediliyor ? "Kaydediliyor…" : `Evet, ${girilenler.length} kalemi güncelle ✓`}
                </button>
              </span>
            ) : (
              <button
                onClick={() => girilenler.length && setSoruluyor(true)}
                disabled={!girilenler.length}
                className="marka-gradyan rounded-xl px-5 py-2.5 text-[14px] font-extrabold text-white shadow-[0_4px_12px_rgba(138,75,31,0.25)] disabled:opacity-40"
              >
                Sayımı Kaydet ({girilenler.length})
              </button>
            )}
          </div>
        </>
      )}

      {/* Geçmiş sayımlar */}
      {gecmis.length > 0 && (
        <section className="mt-6">
          <h2 className="text-base font-extrabold">Geçmiş sayımlar</h2>
          <div className="mt-2 flex flex-col gap-2">
            {gecmis.map((g) => {
              const toplamFire = g.sayim_kalemi.reduce(
                (t, k) => t + Math.max(0, (Number(k.beklenen) - Number(k.sayilan)) * Number(k.birim_maliyet ?? 0)),
                0
              );
              const fireli = g.sayim_kalemi.filter((k) => Math.abs(Number(k.beklenen) - Number(k.sayilan)) >= 0.01);
              return (
                <div key={g.id} className="anim-kart rounded-2xl border border-cizgi bg-kart">
                  <button
                    onClick={() => setAcikSayim(acikSayim === g.id ? null : g.id)}
                    className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left"
                  >
                    <span className="text-sm font-extrabold">
                      {new Date(g.created_at).toLocaleString("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {g.notu && <span className="text-[13px] text-metin-soluk">{g.notu}</span>}
                    <span className="flex-1" />
                    <span className="text-[12.5px] text-metin-silik">{g.sayim_kalemi.length} kalem</span>
                    <span
                      className={
                        "rounded-full px-3 py-1 text-[12.5px] font-extrabold " +
                        (toplamZararRozet(toplamFire, fireli.length))
                      }
                    >
                      {fireli.length === 0 ? "fire yok ✓" : toplamFire > 0.005 ? `fire zararı ${tl(toplamFire)}` : `${fireli.length} kalemde fark`}
                    </span>
                  </button>
                  {acikSayim === g.id && (
                    <div className="border-t border-[#f6ede1] px-4 py-3">
                      {g.sayim_kalemi.map((k, i) => {
                        const fark = Number(k.sayilan) - Number(k.beklenen);
                        const z = k.birim_maliyet != null ? -fark * Number(k.birim_maliyet) : null;
                        return (
                          <div key={i} className="flex items-center justify-between gap-2 py-1 text-[13px]">
                            <span className="font-semibold">{k.ad}</span>
                            <span className="text-metin-soluk">
                              {miktarYaz(Number(k.beklenen), k.birim)} → {miktarYaz(Number(k.sayilan), k.birim)}
                            </span>
                            <span
                              className={
                                "w-40 text-right font-bold tabular-nums " +
                                (Math.abs(fark) < 0.01 ? "text-basari" : fark < 0 ? "text-tehlike" : "text-uyari")
                              }
                            >
                              {Math.abs(fark) < 0.01
                                ? "✓"
                                : (fark < 0 ? `fire ${miktarYaz(-fark, k.birim)}` : `fazla ${miktarYaz(fark, k.birim)}`) +
                                  (z !== null && z > 0.005 ? ` · ${tl(z)}` : "")}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function toplamZararRozet(zarar: number, farkliKalem: number): string {
  if (farkliKalem === 0) return "bg-basari-zemin text-basari";
  if (zarar > 0.005) return "bg-tehlike-zemin text-tehlike";
  return "bg-uyari-zemin text-uyari";
}
