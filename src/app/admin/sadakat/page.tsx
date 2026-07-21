"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useKullanici } from "@/lib/useKullanici";

interface Odul {
  id: string;
  ad: string;
  puan_bedeli: number;
  aktif: boolean;
}

interface Hareket {
  id: string;
  tur: "kazanim" | "harcama" | "duzeltme";
  puan: number;
  aciklama: string | null;
  created_at: string;
}

const TUR_ETIKET: Record<string, string> = {
  kazanim: "Kazanım",
  harcama: "Ödül",
  duzeltme: "Düzeltme",
};

export default function SadakatSayfasi() {
  const { kullanici, yukleniyor } = useKullanici(["admin"]);
  const supabase = createClient();

  const [sadakatAktif, setSadakatAktif] = useState(true);
  const [carpan, setCarpan] = useState("1");
  const [oduller, setOduller] = useState<Odul[]>([]);
  const [hareketler, setHareketler] = useState<Hareket[]>([]);
  const [mesaj, setMesaj] = useState<{ metin: string; hata: boolean } | null>(null);

  // formlar
  const [yeniOdulAd, setYeniOdulAd] = useState("");
  const [yeniOdulBedel, setYeniOdulBedel] = useState("");
  const [duzeltKod, setDuzeltKod] = useState("");
  const [duzeltPuan, setDuzeltPuan] = useState("");
  const [duzeltAciklama, setDuzeltAciklama] = useState("");
  const [meskul, setMeskul] = useState(false);

  function bilgi(metin: string, hata = false) {
    setMesaj({ metin, hata });
    setTimeout(() => setMesaj(null), 6000);
  }

  const yukle = useCallback(async () => {
    if (!kullanici) return;
    const [c, o, h] = await Promise.all([
      supabase.from("cafe").select("sadakat_aktif, puan_carpani").eq("id", kullanici.cafe_id).single(),
      supabase.from("odul").select("id, ad, puan_bedeli, aktif").eq("cafe_id", kullanici.cafe_id).order("sira").order("ad"),
      supabase
        .from("puan_hareketi")
        .select("id, tur, puan, aciklama, created_at")
        .eq("cafe_id", kullanici.cafe_id)
        .order("created_at", { ascending: false })
        .limit(25),
    ]);
    if (c.data) {
      setSadakatAktif(c.data.sadakat_aktif);
      setCarpan(String(c.data.puan_carpani));
    }
    setOduller((o.data as Odul[]) ?? []);
    setHareketler((h.data as Hareket[]) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kullanici]);

  useEffect(() => {
    yukle();
  }, [yukle]);

  async function ayarKaydet(yeniAktif?: boolean) {
    if (!kullanici) return;
    const n = parseFloat(carpan.replace(",", "."));
    if (isNaN(n) || n < 0) return bilgi("Geçerli bir çarpan gir (örn. 1 veya 0,5)", true);
    const { error } = await supabase
      .from("cafe")
      .update({ sadakat_aktif: yeniAktif ?? sadakatAktif, puan_carpani: n })
      .eq("id", kullanici.cafe_id);
    if (error) return bilgi(error.message, true);
    bilgi("Ayarlar kaydedildi ✓");
    yukle();
  }

  async function odulEkle() {
    if (!kullanici || meskul) return;
    const bedel = parseInt(yeniOdulBedel, 10);
    if (!yeniOdulAd.trim() || isNaN(bedel) || bedel <= 0) {
      return bilgi("Ödül adı ve pozitif puan bedeli gerekli", true);
    }
    setMeskul(true);
    const { error } = await supabase
      .from("odul")
      .insert({ cafe_id: kullanici.cafe_id, ad: yeniOdulAd.trim(), puan_bedeli: bedel });
    setMeskul(false);
    if (error) return bilgi(error.message, true);
    setYeniOdulAd("");
    setYeniOdulBedel("");
    bilgi("Ödül eklendi ✓");
    yukle();
  }

  async function odulToggle(o: Odul) {
    const { error } = await supabase.from("odul").update({ aktif: !o.aktif }).eq("id", o.id);
    if (error) return bilgi(error.message, true);
    yukle();
  }

  async function puanDuzelt() {
    if (meskul) return;
    const p = parseInt(duzeltPuan, 10);
    if (!duzeltKod.trim() || isNaN(p) || p === 0) {
      return bilgi("Müşteri kodu ve 0 dışında bir puan gir (eksi için başına − koy)", true);
    }
    setMeskul(true);
    const { data, error } = await supabase.rpc("puan_duzelt", {
      p_musteri_kod: duzeltKod.trim(),
      p_puan: p,
      p_aciklama: duzeltAciklama.trim() || null,
    });
    setMeskul(false);
    if (error) return bilgi(error.message, true);
    const d = data as { musteri_ad: string; islenen: number; yeni_bakiye: number };
    bilgi(`${d.musteri_ad}: ${d.islenen > 0 ? "+" : ""}${d.islenen} puan işlendi (bakiye ${d.yeni_bakiye}) ✓`);
    setDuzeltKod("");
    setDuzeltPuan("");
    setDuzeltAciklama("");
    yukle();
  }

  if (yukleniyor || !kullanici) {
    return <p className="animate-pulse text-metin-soluk">Yükleniyor…</p>;
  }

  const inputStil =
    "rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2.5 text-sm outline-none focus:border-marka";

  return (
    <div className="max-w-2xl">
      <h1 className="font-serif text-2xl font-semibold text-metin-baslik">Sadakat</h1>
      <p className="mt-1 text-sm text-metin-soluk">
        Müşteri uygulamasındaki puan programı: kasada kod okutulur, puan birikir,
        puanla ödül alınır.
      </p>

      {mesaj && (
        <p
          className={
            "mt-4 rounded-xl px-3 py-2 text-[13px] font-bold " +
            (mesaj.hata ? "bg-tehlike-zemin text-tehlike" : "bg-basari-zemin text-basari")
          }
        >
          {mesaj.metin}
        </p>
      )}

      {/* Ayarlar */}
      <div className="mt-5 rounded-2xl border border-cizgi bg-kart p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-extrabold text-metin-baslik">Program</h2>
          <span className="flex-1" />
          <button
            onClick={() => {
              setSadakatAktif(!sadakatAktif);
              ayarKaydet(!sadakatAktif);
            }}
            className={
              "rounded-lg px-3 py-1.5 text-[12.5px] font-extrabold " +
              (sadakatAktif ? "bg-basari-zemin text-basari" : "bg-tehlike-zemin text-tehlike")
            }
          >
            {sadakatAktif ? "Açık ✓" : "Kapalı"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-metin-orta">1 TL harcama =</span>
          <input
            value={carpan}
            onChange={(e) => setCarpan(e.target.value)}
            inputMode="decimal"
            className={inputStil + " w-20 text-center font-bold"}
          />
          <span className="font-semibold text-metin-orta">puan</span>
          <button
            onClick={() => ayarKaydet()}
            className="marka-gradyan ml-2 rounded-xl px-4 py-2 text-[13px] font-extrabold text-white"
          >
            Kaydet
          </button>
        </div>
      </div>

      {/* Ödüller */}
      <div className="mt-5 rounded-2xl border border-cizgi bg-kart p-4">
        <h2 className="text-sm font-extrabold text-metin-baslik">Ödüller</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={yeniOdulAd}
            onChange={(e) => setYeniOdulAd(e.target.value)}
            placeholder="Ödül adı (örn. Bedava Çay)"
            className={inputStil + " min-w-[180px] flex-1"}
          />
          <input
            value={yeniOdulBedel}
            onChange={(e) => setYeniOdulBedel(e.target.value)}
            inputMode="numeric"
            placeholder="puan"
            className={inputStil + " w-24 text-right font-bold"}
          />
          <button
            onClick={odulEkle}
            disabled={meskul}
            className="rounded-xl bg-basari px-4 py-2 text-[13px] font-extrabold text-white disabled:opacity-50"
          >
            Ekle
          </button>
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          {oduller.length === 0 && (
            <p className="text-[13px] text-metin-silik">Henüz ödül tanımlanmadı.</p>
          )}
          {oduller.map((o) => (
            <div
              key={o.id}
              className={
                "flex items-center gap-3 rounded-xl border border-cizgi px-3.5 py-2.5 " +
                (o.aktif ? "" : "opacity-55")
              }
            >
              <span className="min-w-0 flex-1 text-sm font-bold">🎁 {o.ad}</span>
              <span className="text-[13.5px] font-extrabold tabular-nums text-marka">
                {o.puan_bedeli} puan
              </span>
              <button
                onClick={() => odulToggle(o)}
                className={
                  "rounded-lg px-2.5 py-1.5 text-[11.5px] font-extrabold " +
                  (o.aktif
                    ? "text-tehlike-yumusak hover:bg-tehlike-zemin"
                    : "bg-basari-zemin text-basari")
                }
              >
                {o.aktif ? "Pasife Al" : "Aktif Et"}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Manuel düzeltme */}
      <div className="mt-5 rounded-2xl border border-cizgi bg-kart p-4">
        <h2 className="text-sm font-extrabold text-metin-baslik">Puan Düzeltme</h2>
        <p className="mt-1 text-[12.5px] text-metin-soluk">
          Şikayet telafisi ya da yanlış işlem düzeltmesi: müşteri kodu + puan
          (düşmek için başına − koy).
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={duzeltKod}
            onChange={(e) => setDuzeltKod(e.target.value)}
            placeholder="Müşteri kodu"
            autoCapitalize="characters"
            className={inputStil + " w-40 text-center font-bold uppercase tracking-widest"}
          />
          <input
            value={duzeltPuan}
            onChange={(e) => setDuzeltPuan(e.target.value)}
            inputMode="numeric"
            placeholder="±puan"
            className={inputStil + " w-24 text-right font-bold"}
          />
          <input
            value={duzeltAciklama}
            onChange={(e) => setDuzeltAciklama(e.target.value)}
            placeholder="Açıklama (isteğe bağlı)"
            className={inputStil + " min-w-[160px] flex-1"}
          />
          <button
            onClick={puanDuzelt}
            disabled={meskul}
            className="marka-gradyan rounded-xl px-4 py-2 text-[13px] font-extrabold text-white disabled:opacity-50"
          >
            İşle
          </button>
        </div>
      </div>

      {/* Son hareketler */}
      <div className="mt-5 rounded-2xl border border-cizgi bg-kart p-4">
        <h2 className="text-sm font-extrabold text-metin-baslik">Son Puan Hareketleri</h2>
        <div className="mt-2.5 flex flex-col gap-1.5">
          {hareketler.length === 0 && (
            <p className="text-[13px] text-metin-silik">Henüz hareket yok.</p>
          )}
          {hareketler.map((h) => (
            <div key={h.id} className="flex items-center gap-2 text-[13px]">
              <span className="w-20 font-bold text-metin-soluk">{TUR_ETIKET[h.tur]}</span>
              <span className="min-w-0 flex-1 truncate text-metin-orta">
                {h.aciklama ?? "—"}
                <span className="ml-1.5 text-[11px] text-metin-silik">
                  {new Date(h.created_at).toLocaleString("tr-TR", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </span>
              <span
                className={
                  "font-extrabold tabular-nums " + (h.puan < 0 ? "text-tehlike" : "text-basari")
                }
              >
                {h.puan > 0 ? "+" : ""}
                {h.puan}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
