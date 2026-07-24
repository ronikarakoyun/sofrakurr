"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useKullanici } from "@/lib/useKullanici";
import { tl } from "@/lib/types";

interface Hareket {
  id: string;
  tur: "kazanim" | "harcama" | "duzeltme";
  puan: number;
  aciklama: string | null;
  created_at: string;
}

const TUR_ETIKET: Record<string, string> = {
  kazanim: "Kazanım",
  harcama: "Harcama",
  duzeltme: "Düzeltme",
};

// Tek cüzdan para-puan modeli (Faz 7): 1 TL = 1 puan, 10 puan = 1 TL.
// Puan teslimde otomatik kazanılır, uygulamada sipariş verirken harcanır.
// Kafe bazlı kazanılan/harcanan dökümü ileride kafeler arası mahsuplaşmanın
// (komisyon sistemi) ön görünümüdür.
export default function SadakatSayfasi() {
  const { kullanici, yukleniyor } = useKullanici(["admin"]);
  const supabase = createClient();

  const [sadakatAktif, setSadakatAktif] = useState(true);
  const [hareketler, setHareketler] = useState<Hareket[]>([]);
  const [kazanilan, setKazanilan] = useState(0);
  const [harcanan, setHarcanan] = useState(0);
  const [mesaj, setMesaj] = useState<{ metin: string; hata: boolean } | null>(null);

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
    const [c, h, toplamlar] = await Promise.all([
      supabase.from("cafe").select("sadakat_aktif").eq("id", kullanici.cafe_id).single(),
      supabase
        .from("puan_hareketi")
        .select("id, tur, puan, aciklama, created_at")
        .eq("cafe_id", kullanici.cafe_id)
        .order("created_at", { ascending: false })
        .limit(25),
      supabase
        .from("puan_hareketi")
        .select("tur, puan")
        .eq("cafe_id", kullanici.cafe_id),
    ]);
    if (c.data) setSadakatAktif(c.data.sadakat_aktif);
    setHareketler((h.data as Hareket[]) ?? []);
    const satirlar = (toplamlar.data as { tur: string; puan: number }[]) ?? [];
    setKazanilan(satirlar.filter((s) => s.tur === "kazanim").reduce((t, s) => t + s.puan, 0));
    setHarcanan(
      satirlar.filter((s) => s.tur === "harcama").reduce((t, s) => t + Math.abs(s.puan), 0)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kullanici]);

  useEffect(() => {
    yukle();
  }, [yukle]);

  async function aktifDegistir() {
    if (!kullanici) return;
    const yeni = !sadakatAktif;
    const { error } = await supabase
      .from("cafe")
      .update({ sadakat_aktif: yeni })
      .eq("id", kullanici.cafe_id);
    if (error) return bilgi(error.message, true);
    setSadakatAktif(yeni);
    bilgi(yeni ? "Sadakat programı açıldı ✓" : "Sadakat programı kapatıldı");
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
        Puan programı tüm SofraKur kafelerinde ortak çalışır: müşteri siparişini teslim
        aldığında puan otomatik birikir, uygulamadan sipariş verirken indirim olarak harcar.
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

      {/* Program + sabit kural */}
      <div className="mt-5 rounded-2xl border border-cizgi bg-kart p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-extrabold text-metin-baslik">Program</h2>
          <span className="flex-1" />
          <button
            onClick={aktifDegistir}
            className={
              "rounded-lg px-3 py-1.5 text-[12.5px] font-extrabold " +
              (sadakatAktif ? "bg-basari-zemin text-basari" : "bg-tehlike-zemin text-tehlike")
            }
          >
            {sadakatAktif ? "Açık ✓" : "Kapalı"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-xl bg-krem-koyu px-3.5 py-2 text-[13.5px] font-extrabold text-metin-baslik">
            ☕ 1 TL harcama = 1 puan
          </span>
          <span className="rounded-xl bg-krem-koyu px-3.5 py-2 text-[13.5px] font-extrabold text-metin-baslik">
            🎁 10 puan = 1 TL indirim
          </span>
        </div>
        <p className="mt-2.5 text-[12px] leading-relaxed text-metin-soluk">
          Kural tüm kafelerde sabittir; kafe bazlı kampanyalar ileride eklenecek.
          Program kapalıyken bu kafede puan kazanılmaz ve harcanmaz.
        </p>
      </div>

      {/* Kafe defteri (mahsuplaşma ön görünümü) */}
      <div className="mt-5 rounded-2xl border border-cizgi bg-kart p-4">
        <h2 className="text-sm font-extrabold text-metin-baslik">Bu Kafenin Puan Defteri</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-basari-zemin px-3.5 py-3">
            <div className="text-[11.5px] font-extrabold text-basari">BURADA KAZANILAN</div>
            <div className="mt-0.5 text-lg font-extrabold tabular-nums text-basari">
              {kazanilan.toLocaleString("tr-TR")} puan
            </div>
            <div className="text-[11.5px] font-semibold text-basari/80">
              ≈ {tl(kazanilan / 10)}
            </div>
          </div>
          <div className="rounded-xl bg-uyari-zemin px-3.5 py-3">
            <div className="text-[11.5px] font-extrabold text-uyari">BURADA HARCANAN</div>
            <div className="mt-0.5 text-lg font-extrabold tabular-nums text-uyari">
              {harcanan.toLocaleString("tr-TR")} puan
            </div>
            <div className="text-[11.5px] font-semibold text-uyari/80">
              ≈ {tl(harcanan / 10)} indirim
            </div>
          </div>
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-metin-silik">
          Puanlar tüm kafelerde geçtiği için başka kafede kazanılan puan burada
          harcanabilir; bu döküm ileride kafeler arası mahsuplaşmanın temelidir.
        </p>
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
