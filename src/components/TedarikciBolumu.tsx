"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { tl, type Kullanici } from "@/lib/types";

type Birim = "gr" | "ml" | "adet";

interface Hammadde {
  id: string;
  ad: string;
  birim: Birim;
  stok_miktar: number;
  son_birim_fiyat: number | null;
}

interface FaturaKalemi {
  id: string;
  miktar: number;
  toplam_tutar: number;
  hammadde: { ad: string; birim: Birim };
}

interface Fatura {
  id: string;
  tedarikci_ad: string;
  fatura_no: string | null;
  tarih: string;
  aciklama: string | null;
  created_at: string;
  hammadde_giris: FaturaKalemi[];
}

// Faturada miktarın girilebildiği birimler; kg→gr, lt→ml çevrilerek saklanır
type GirisBirim = "kg" | "gr" | "lt" | "ml" | "adet";

const GIRIS_BIRIM: Record<GirisBirim, { baz: Birim; carpan: number }> = {
  kg: { baz: "gr", carpan: 1000 },
  gr: { baz: "gr", carpan: 1 },
  lt: { baz: "ml", carpan: 1000 },
  ml: { baz: "ml", carpan: 1 },
  adet: { baz: "adet", carpan: 1 },
};

// Malzemenin baz birimine göre seçilebilecek giriş birimleri
const BIRIM_SECENEK: Record<Birim, GirisBirim[]> = {
  gr: ["kg", "gr"],
  ml: ["lt", "ml"],
  adet: ["adet"],
};

// Formdaki bir fatura satırı: mevcut malzeme ya da "yeni" (adıyla açılır)
interface FormKalem {
  hammaddeId: string; // "" seçilmedi, "yeni" ise yeniAd kullanılır
  yeniAd: string;
  miktar: string;
  girisBirim: GirisBirim; // miktarın yazıldığı birim (kg/gr/lt/ml/adet)
  tutar: string;
}

const BUYUK_BIRIM: Record<Birim, { ad: string; carpan: number } | null> = {
  gr: { ad: "kg", carpan: 1000 },
  ml: { ad: "lt", carpan: 1000 },
  adet: null,
};

const BOS_KALEM: FormKalem = { hammaddeId: "", yeniAd: "", miktar: "", girisBirim: "kg", tutar: "" };

function bugunStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sayi(v: string): number {
  const n = parseFloat(v.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function miktarYaz(m: number, birim: Birim): string {
  const buyuk = BUYUK_BIRIM[birim];
  if (buyuk && Math.abs(m) >= buyuk.carpan) {
    return `${(m / buyuk.carpan).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} ${buyuk.ad}`;
  }
  return `${m.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} ${birim}`;
}

// Kalemin baz birime çevrilmiş birim fiyatını okunur yazar: 150 ₺/kg gibi
function birimFiyatYaz(tutar: number, bazMiktar: number, birim: Birim): string {
  if (bazMiktar <= 0 || tutar <= 0) return "";
  const buyuk = BUYUK_BIRIM[birim];
  const fiyat = (tutar / bazMiktar) * (buyuk ? buyuk.carpan : 1);
  return `${tl(fiyat)}/${buyuk ? buyuk.ad : birim}`;
}

// Kasa ekranının "Tedarikçi" sekmesi: gelen fatura/irsaliye girişi.
// Kaydedilen her kalem hammadde_giris'e yazılır — stok artışı ve birim
// maliyet güncellemesi veritabanı trigger'ında otomatik yapılır.
export function TedarikciBolumu({ kullanici }: { kullanici: Kullanici }) {
  const [hammaddeler, setHammaddeler] = useState<Hammadde[]>([]);
  const [faturalar, setFaturalar] = useState<Fatura[]>([]);
  const [acikFatura, setAcikFatura] = useState<string | null>(null);

  // form
  const [tedarikciAd, setTedarikciAd] = useState("");
  const [faturaNo, setFaturaNo] = useState("");
  const [tarih, setTarih] = useState(bugunStr());
  const [kalemler, setKalemler] = useState<FormKalem[]>([{ ...BOS_KALEM }]);
  const [meskul, setMeskul] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [basari, setBasari] = useState<string | null>(null);

  const yenile = useCallback(async () => {
    const supabase = createClient();
    const [h, f] = await Promise.all([
      supabase
        .from("hammadde")
        .select("id, ad, birim, stok_miktar, son_birim_fiyat")
        .eq("cafe_id", kullanici.cafe_id)
        .order("ad"),
      supabase
        .from("tedarikci_fatura")
        .select("id, tedarikci_ad, fatura_no, tarih, aciklama, created_at, hammadde_giris(id, miktar, toplam_tutar, hammadde(ad, birim))")
        .eq("cafe_id", kullanici.cafe_id)
        .order("tarih", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(60),
    ]);
    setHammaddeler((h.data ?? []) as Hammadde[]);
    setFaturalar((f.data ?? []) as unknown as Fatura[]);
  }, [kullanici]);

  useEffect(() => {
    yenile();
  }, [yenile]);

  useEffect(() => {
    if (!hata && !basari) return;
    const z = setTimeout(() => { setHata(null); setBasari(null); }, 6000);
    return () => clearTimeout(z);
  }, [hata, basari]);

  function kalemGuncelle(i: number, degisiklik: Partial<FormKalem>) {
    setKalemler((k) => k.map((x, j) => (j === i ? { ...x, ...degisiklik } : x)));
  }

  // Satırın hammadde baz birimi (yeni malzemede giriş biriminden türer,
  // mevcutta kayıtlı birim)
  function kalemBirim(k: FormKalem): Birim {
    if (k.hammaddeId === "yeni") return GIRIS_BIRIM[k.girisBirim].baz;
    return hammaddeler.find((h) => h.id === k.hammaddeId)?.birim ?? "gr";
  }

  // Girilen miktarı baz birime (gr/ml/adet) çevirir
  function bazMiktar(k: FormKalem): number {
    return sayi(k.miktar) * GIRIS_BIRIM[k.girisBirim].carpan;
  }

  // Malzeme değişince giriş birimini malzemenin birimine uygun varsayılana çek
  function malzemeSecildi(i: number, hammaddeId: string) {
    if (hammaddeId === "yeni") {
      kalemGuncelle(i, { hammaddeId, girisBirim: "kg" });
      return;
    }
    const birim = hammaddeler.find((h) => h.id === hammaddeId)?.birim ?? "gr";
    kalemGuncelle(i, { hammaddeId, girisBirim: BIRIM_SECENEK[birim][0] });
  }

  const gecerliKalemler = kalemler.filter(
    (k) =>
      (k.hammaddeId === "yeni" ? k.yeniAd.trim() !== "" : k.hammaddeId !== "") &&
      sayi(k.miktar) > 0 &&
      sayi(k.tutar) > 0
  );
  const formToplam = gecerliKalemler.reduce((t, k) => t + sayi(k.tutar), 0);

  async function faturaKaydet() {
    if (meskul) return;
    if (!tedarikciAd.trim()) { setHata("Tedarikçi adı gerekli."); return; }
    if (gecerliKalemler.length === 0) {
      setHata("En az bir kalem girilmeli (malzeme + miktar + tutar).");
      return;
    }
    setMeskul(true);
    const supabase = createClient();

    // 1) "Yeni malzeme" satırları için önce hammadde kartı aç
    const idler = new Map<number, string>();
    for (let i = 0; i < kalemler.length; i++) {
      const k = kalemler[i];
      if (!gecerliKalemler.includes(k)) continue;
      if (k.hammaddeId === "yeni") {
        const { data, error } = await supabase
          .from("hammadde")
          .insert({ cafe_id: kullanici.cafe_id, ad: k.yeniAd.trim(), birim: GIRIS_BIRIM[k.girisBirim].baz })
          .select("id")
          .single();
        if (error || !data) {
          setMeskul(false);
          setHata("Malzeme açılamadı: " + (error?.message ?? "bilinmeyen hata"));
          return;
        }
        idler.set(i, data.id);
      } else {
        idler.set(i, k.hammaddeId);
      }
    }

    // 2) Belge başlığı
    const { data: fatura, error: fHata } = await supabase
      .from("tedarikci_fatura")
      .insert({
        cafe_id: kullanici.cafe_id,
        tedarikci_ad: tedarikciAd.trim(),
        fatura_no: faturaNo.trim() || null,
        tarih,
      })
      .select("id")
      .single();
    if (fHata || !fatura) {
      setMeskul(false);
      setHata("Belge kaydedilemedi: " + (fHata?.message ?? "bilinmeyen hata"));
      return;
    }

    // 3) Kalemler → hammadde_giris (trigger stoku artırır, birim maliyeti günceller)
    const satirlar = kalemler
      .map((k, i) => ({ k, i }))
      .filter(({ k }) => gecerliKalemler.includes(k))
      .map(({ k, i }) => ({
        cafe_id: kullanici.cafe_id,
        hammadde_id: idler.get(i)!,
        miktar: bazMiktar(k),
        toplam_tutar: sayi(k.tutar),
        tedarikci_fatura_id: fatura.id,
        aciklama: `Fatura · ${tedarikciAd.trim()}`,
      }));
    const { error: kHata } = await supabase.from("hammadde_giris").insert(satirlar);
    setMeskul(false);
    if (kHata) {
      setHata("Kalemler kaydedilemedi: " + kHata.message);
      return;
    }

    setBasari(`Belge kaydedildi ✓ Stok güncellendi (${satirlar.length} kalem, ${tl(formToplam)}).`);
    setTedarikciAd("");
    setFaturaNo("");
    setTarih(bugunStr());
    setKalemler([{ ...BOS_KALEM }]);
    yenile();
  }

  const tedarikciler = [...new Set(faturalar.map((f) => f.tedarikci_ad))];
  const inputStil =
    "rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2 text-sm outline-none focus:border-marka";

  return (
    <div className="mx-auto max-w-[920px]">
      <div className="flex items-baseline gap-3">
        <h2 className="font-serif text-xl font-semibold text-metin-baslik">Tedarikçi Belgeleri</h2>
        <span className="text-[13px] text-metin-soluk">gelen fatura / irsaliye girişi — stok otomatik artar</span>
      </div>

      {hata && (
        <p className="mt-3 rounded-xl bg-tehlike-zemin px-3.5 py-2.5 text-[13.5px] font-bold text-tehlike">{hata}</p>
      )}
      {basari && (
        <p className="mt-3 rounded-xl bg-basari-zemin px-3.5 py-2.5 text-[13.5px] font-bold text-basari">{basari}</p>
      )}

      {/* Yeni belge girişi */}
      <section className="mt-4 rounded-2xl border-[1.5px] border-marka/40 bg-kart p-4">
        <h3 className="text-sm font-extrabold">Yeni Belge</h3>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <input
            value={tedarikciAd}
            onChange={(e) => setTedarikciAd(e.target.value)}
            list="tedarikci-listesi"
            placeholder="Tedarikçi adı (örn. Pınar Süt Dağıtım)"
            className={inputStil + " min-w-[200px] flex-1 font-semibold"}
          />
          <datalist id="tedarikci-listesi">
            {tedarikciler.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <input
            value={faturaNo}
            onChange={(e) => setFaturaNo(e.target.value)}
            placeholder="Fatura no (isteğe bağlı)"
            className={inputStil + " w-44"}
          />
          <input
            type="date"
            value={tarih}
            onChange={(e) => setTarih(e.target.value)}
            className={inputStil + " w-40"}
          />
        </div>

        {/* Kalemler */}
        <div className="mt-3 flex flex-col gap-2">
          {kalemler.map((k, i) => {
            const birim = kalemBirim(k);
            // yeni malzemede tüm birimler seçilebilir; mevcutta kayıtlı birime uygunlar
            const birimSecenekleri: GirisBirim[] =
              k.hammaddeId === "yeni" ? ["kg", "gr", "lt", "ml", "adet"] : BIRIM_SECENEK[birim];
            const bf = birimFiyatYaz(sayi(k.tutar), bazMiktar(k), birim);
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-krem p-2.5">
                <select
                  value={k.hammaddeId}
                  onChange={(e) => malzemeSecildi(i, e.target.value)}
                  className={inputStil + " min-w-[170px] flex-1 font-semibold"}
                >
                  <option value="">— malzeme seç —</option>
                  {hammaddeler.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.ad}
                    </option>
                  ))}
                  <option value="yeni">➕ Yeni malzeme</option>
                </select>
                {k.hammaddeId === "yeni" && (
                  <input
                    value={k.yeniAd}
                    onChange={(e) => kalemGuncelle(i, { yeniAd: e.target.value })}
                    placeholder="Malzeme adı"
                    className={inputStil + " w-36"}
                  />
                )}
                <input
                  value={k.miktar}
                  onChange={(e) => kalemGuncelle(i, { miktar: e.target.value })}
                  inputMode="decimal"
                  placeholder="miktar"
                  className={inputStil + " w-24 text-right font-bold"}
                />
                <select
                  value={k.girisBirim}
                  onChange={(e) => kalemGuncelle(i, { girisBirim: e.target.value as GirisBirim })}
                  className={inputStil + " w-[74px] font-bold"}
                >
                  {birimSecenekleri.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <input
                  value={k.tutar}
                  onChange={(e) => kalemGuncelle(i, { tutar: e.target.value })}
                  inputMode="decimal"
                  placeholder="tutar TL"
                  className={inputStil + " w-28 text-right font-bold"}
                />
                <span className="min-w-[90px] text-[12px] font-bold text-metin-soluk">{bf}</span>
                {kalemler.length > 1 && (
                  <button
                    onClick={() => setKalemler((x) => x.filter((_, j) => j !== i))}
                    className="text-xs font-bold text-tehlike-yumusak hover:underline"
                  >
                    sil
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setKalemler((k) => [...k, { ...BOS_KALEM }])}
            className="rounded-[10px] border border-dashed border-cizgi-koyu px-3 py-2 text-[13px] font-bold text-metin-orta hover:border-marka"
          >
            + Kalem ekle
          </button>
          <span className="flex-1" />
          {formToplam > 0 && (
            <span className="text-sm font-extrabold tabular-nums">Belge toplamı: {tl(formToplam)}</span>
          )}
          <button
            onClick={faturaKaydet}
            disabled={meskul}
            className="marka-gradyan rounded-xl px-5 py-2.5 text-[14px] font-extrabold text-white shadow-[0_4px_12px_rgba(138,75,31,0.25)] disabled:opacity-50"
          >
            {meskul ? "Kaydediliyor…" : "Belgeyi Kaydet"}
          </button>
        </div>
      </section>

      {/* Belge arşivi */}
      <section className="mt-4">
        <h3 className="text-sm font-extrabold">Geçmiş Belgeler</h3>
        {faturalar.length === 0 ? (
          <p className="mt-2 text-[13px] text-metin-silik">Henüz belge girilmedi.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {faturalar.map((f) => {
              const toplam = f.hammadde_giris.reduce((t, x) => t + Number(x.toplam_tutar), 0);
              const acik = acikFatura === f.id;
              return (
                <div key={f.id} className="rounded-2xl border border-cizgi bg-kart">
                  <button
                    onClick={() => setAcikFatura(acik ? null : f.id)}
                    className="flex w-full flex-wrap items-center gap-2.5 px-4 py-3 text-left"
                  >
                    <span className="text-[14px] font-extrabold">🧾 {f.tedarikci_ad}</span>
                    <span className="text-[12.5px] text-metin-soluk">
                      {new Date(f.tarih + "T00:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" })}
                      {f.fatura_no ? ` · No: ${f.fatura_no}` : ""}
                      {` · ${f.hammadde_giris.length} kalem`}
                    </span>
                    <span className="flex-1" />
                    <span className="text-[15px] font-extrabold tabular-nums">{tl(toplam)}</span>
                    <span className="text-metin-soluk">{acik ? "▴" : "▾"}</span>
                  </button>
                  {acik && (
                    <div className="border-t border-dashed border-cizgi-koyu px-4 py-3">
                      {f.hammadde_giris.map((x) => (
                        <div key={x.id} className="flex items-center justify-between gap-2 py-1 text-[13px]">
                          <span className="min-w-0 flex-1 truncate font-semibold">{x.hammadde.ad}</span>
                          <span className="text-metin-soluk">{miktarYaz(Number(x.miktar), x.hammadde.birim)}</span>
                          <span className="w-28 text-right text-[12px] text-metin-soluk">
                            {birimFiyatYaz(Number(x.toplam_tutar), Number(x.miktar), x.hammadde.birim)}
                          </span>
                          <span className="w-20 text-right font-bold tabular-nums">{tl(Number(x.toplam_tutar))}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
