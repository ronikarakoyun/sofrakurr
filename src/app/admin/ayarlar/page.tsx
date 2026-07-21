"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useKullanici } from "@/lib/useKullanici";

type OdemeModu = "once_odeme" | "acik_hesap";

// Kafe çalışma ayarları: masa düzeni (masalı ↔ self-servis) ve ödeme modu.
// Self-servis kafede masa adımı tamamen kalkar — sipariş kimliği numaradır,
// açık hesap kapalıdır (DB check'i: masasız kafe yalnız önce-ödeme çalışır).
export default function AyarlarSayfasi() {
  const { kullanici, yukleniyor } = useKullanici(["admin"]);
  const supabase = createClient();

  const [masaDuzeni, setMasaDuzeni] = useState(true);
  const [odemeModu, setOdemeModu] = useState<OdemeModu>("once_odeme");
  const [mesaj, setMesaj] = useState<{ metin: string; hata: boolean } | null>(null);
  const [meskul, setMeskul] = useState(false);

  function bilgi(metin: string, hata = false) {
    setMesaj({ metin, hata });
    setTimeout(() => setMesaj(null), 6000);
  }

  const yukle = useCallback(async () => {
    if (!kullanici) return;
    const { data } = await supabase
      .from("cafe")
      .select("masa_duzeni, odeme_modu")
      .eq("id", kullanici.cafe_id)
      .single();
    if (data) {
      setMasaDuzeni(data.masa_duzeni);
      setOdemeModu(data.odeme_modu as OdemeModu);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kullanici]);

  useEffect(() => {
    yukle();
  }, [yukle]);

  async function kaydet(yeniMasa: boolean, yeniModu: OdemeModu) {
    if (!kullanici || meskul) return;
    // masasız kafe açık hesapla çalışamaz (DB check'iyle aynı kural)
    const modu = yeniMasa ? yeniModu : "once_odeme";
    setMeskul(true);
    const { error } = await supabase
      .from("cafe")
      .update({ masa_duzeni: yeniMasa, odeme_modu: modu })
      .eq("id", kullanici.cafe_id);
    setMeskul(false);
    if (error) return bilgi(error.message, true);
    setMasaDuzeni(yeniMasa);
    setOdemeModu(modu);
    bilgi("Ayarlar kaydedildi ✓");
  }

  if (yukleniyor || !kullanici) {
    return <p className="animate-pulse p-6 text-metin-soluk">Yükleniyor…</p>;
  }

  return (
    <div className="mx-auto max-w-[640px]">
      <h1 className="font-serif text-xl font-semibold text-metin-baslik">Kafe Ayarları</h1>

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

      {/* Masa düzeni */}
      <div className="mt-5 rounded-2xl border border-cizgi bg-kart p-4">
        <h2 className="text-sm font-extrabold text-metin-baslik">Çalışma düzeni</h2>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-metin-soluk">
          Masalı düzende siparişler masaya bağlanır (QR menü, masa haritası, açık masalar).
          Self-serviste masa yoktur: sipariş numara alır, müşteri tezgahtan teslim alır.
        </p>
        <div className="mt-3 flex rounded-xl bg-krem-koyu p-0.5 text-[13px] font-extrabold">
          <button
            onClick={() => kaydet(true, odemeModu)}
            disabled={meskul}
            className={
              "flex-1 rounded-lg px-2 py-2.5 " +
              (masaDuzeni ? "bg-kart text-metin-baslik" : "text-metin-soluk")
            }
          >
            Masalı kafe
          </button>
          <button
            onClick={() => kaydet(false, odemeModu)}
            disabled={meskul}
            className={
              "flex-1 rounded-lg px-2 py-2.5 " +
              (!masaDuzeni ? "bg-kart text-metin-baslik" : "text-metin-soluk")
            }
          >
            Self-servis
          </button>
        </div>
        {!masaDuzeni && (
          <p className="mt-2.5 rounded-[10px] bg-uyari-zemin px-3 py-2 text-[12px] leading-relaxed text-uyari">
            Self-serviste masa haritası, açık masalar ve masa taşıma ekranları gizlenir;
            mevcut masalar ve QR kodları silinmez — masalı düzene dönerseniz aynen geri gelir.
          </p>
        )}
      </div>

      {/* Ödeme modu */}
      <div className="mt-4 rounded-2xl border border-cizgi bg-kart p-4">
        <h2 className="text-sm font-extrabold text-metin-baslik">Ödeme modu</h2>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-metin-soluk">
          Önce ödeme: müşteri siparişi kasada ödenmeden mutfağa düşmez. Açık hesap: sipariş
          direkt mutfağa düşer, hesap masada birikir (yalnız masalı düzende).
        </p>
        <div className="mt-3 flex rounded-xl bg-krem-koyu p-0.5 text-[13px] font-extrabold">
          <button
            onClick={() => kaydet(masaDuzeni, "once_odeme")}
            disabled={meskul}
            className={
              "flex-1 rounded-lg px-2 py-2.5 " +
              (odemeModu === "once_odeme" ? "bg-kart text-metin-baslik" : "text-metin-soluk")
            }
          >
            Önce ödeme
          </button>
          <button
            onClick={() => kaydet(masaDuzeni, "acik_hesap")}
            disabled={meskul || !masaDuzeni}
            className={
              "flex-1 rounded-lg px-2 py-2.5 disabled:opacity-40 " +
              (odemeModu === "acik_hesap" ? "bg-kart text-metin-baslik" : "text-metin-soluk")
            }
          >
            Açık hesap
          </button>
        </div>
        {!masaDuzeni && (
          <p className="mt-2 text-[12px] text-metin-soluk">
            Self-servis kafede ödeme her zaman önce alınır.
          </p>
        )}
      </div>
    </div>
  );
}
