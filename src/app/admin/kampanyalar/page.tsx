"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useKullanici } from "@/lib/useKullanici";

interface Kampanya {
  id: string;
  baslik: string;
  govde: string;
  durum: "taslak" | "gonderildi";
  gonderim_zamani: string | null;
  gonderilen_adet: number | null;
  created_at: string;
}

// Kampanya push bildirimleri: başlık + metin yaz, gönder — uygulaması olan
// sadakat üyelerinin telefonlarına düşer.
export default function KampanyalarSayfasi() {
  const { kullanici, yukleniyor } = useKullanici(["admin"]);
  const supabase = createClient();

  const [kampanyalar, setKampanyalar] = useState<Kampanya[]>([]);
  const [baslik, setBaslik] = useState("");
  const [govde, setGovde] = useState("");
  const [mesaj, setMesaj] = useState<{ metin: string; hata: boolean } | null>(null);
  const [gonderSorulan, setGonderSorulan] = useState<string | null>(null);
  const [meskul, setMeskul] = useState(false);

  function bilgi(metin: string, hata = false) {
    setMesaj({ metin, hata });
    setTimeout(() => setMesaj(null), 7000);
  }

  const yukle = useCallback(async () => {
    if (!kullanici) return;
    const { data } = await supabase
      .from("kampanya")
      .select("id, baslik, govde, durum, gonderim_zamani, gonderilen_adet, created_at")
      .eq("cafe_id", kullanici.cafe_id)
      .order("created_at", { ascending: false })
      .limit(30);
    setKampanyalar((data as Kampanya[]) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kullanici]);

  useEffect(() => {
    yukle();
  }, [yukle]);

  async function taslakOlustur() {
    if (meskul || !kullanici) return;
    if (!baslik.trim() || !govde.trim()) {
      return bilgi("Başlık ve bildirim metni gerekli", true);
    }
    setMeskul(true);
    const { error } = await supabase.from("kampanya").insert({
      cafe_id: kullanici.cafe_id,
      baslik: baslik.trim(),
      govde: govde.trim(),
      olusturan_id: kullanici.id,
    });
    setMeskul(false);
    if (error) return bilgi(error.message, true);
    setBaslik("");
    setGovde("");
    bilgi("Taslak kaydedildi — göndermek için listeden 'Gönder'e bas.");
    yukle();
  }

  async function gonder(k: Kampanya) {
    if (meskul) return;
    setMeskul(true);
    const cevap = await fetch("/api/push/kampanya", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kampanya_id: k.id }),
    });
    const veri = await cevap.json();
    setMeskul(false);
    setGonderSorulan(null);
    if (!cevap.ok) return bilgi(veri.hata ?? "Gönderilemedi", true);
    bilgi(
      veri.gonderilen > 0
        ? `Bildirim ${veri.gonderilen} cihaza gönderildi ✓`
        : `Kampanya kaydedildi — şu an bildirim alabilecek üye cihazı yok (üye: ${veri.uye}). Uygulama yayılınca gönderimler artar.`
    );
    yukle();
  }

  async function taslakSil(id: string) {
    const { error } = await supabase.from("kampanya").delete().eq("id", id).eq("durum", "taslak");
    if (error) return bilgi(error.message, true);
    yukle();
  }

  if (yukleniyor || !kullanici) {
    return <p className="animate-pulse text-metin-soluk">Yükleniyor…</p>;
  }

  const inputStil =
    "rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2.5 text-sm outline-none focus:border-marka";

  return (
    <div className="max-w-2xl">
      <h1 className="font-serif text-2xl font-semibold text-metin-baslik">Kampanyalar</h1>
      <p className="mt-1 text-sm text-metin-soluk">
        Push bildirimi: uygulaması olan sadakat üyelerinin telefonuna düşer
        (örn. &quot;Bugün ikinci kahve yarı fiyat&quot;).
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

      {/* Yeni kampanya */}
      <div className="mt-5 rounded-2xl border border-cizgi bg-kart p-4">
        <h2 className="text-sm font-extrabold text-metin-baslik">Yeni Kampanya</h2>
        <div className="mt-3 flex flex-col gap-2">
          <input
            value={baslik}
            onChange={(e) => setBaslik(e.target.value)}
            maxLength={60}
            placeholder="Başlık (örn. Hafta sonu sürprizi)"
            className={inputStil + " font-semibold"}
          />
          <textarea
            value={govde}
            onChange={(e) => setGovde(e.target.value)}
            maxLength={160}
            rows={2}
            placeholder="Bildirim metni (örn. Bugün ikinci kahve yarı fiyat — seni bekliyoruz!)"
            className={inputStil + " resize-none"}
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <span className="text-xs text-metin-silik">{govde.length}/160</span>
          <span className="flex-1" />
          <button
            onClick={taslakOlustur}
            disabled={meskul}
            className="marka-gradyan rounded-xl px-5 py-2.5 text-[13.5px] font-extrabold text-white disabled:opacity-50"
          >
            Taslak Kaydet
          </button>
        </div>
      </div>

      {/* Liste */}
      <div className="mt-5 flex flex-col gap-2">
        {kampanyalar.length === 0 && (
          <p className="text-[13px] text-metin-silik">Henüz kampanya yok.</p>
        )}
        {kampanyalar.map((k) => (
          <div key={k.id} className="rounded-2xl border border-cizgi bg-kart px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14.5px] font-extrabold text-metin-baslik">{k.baslik}</span>
              {k.durum === "gonderildi" ? (
                <span className="rounded-full bg-basari-zemin px-2.5 py-0.5 text-[11px] font-extrabold text-basari">
                  gönderildi · {k.gonderilen_adet ?? 0} cihaz
                </span>
              ) : (
                <span className="rounded-full bg-uyari-zemin px-2.5 py-0.5 text-[11px] font-extrabold text-uyari">
                  taslak
                </span>
              )}
              <span className="flex-1" />
              <span className="text-[11.5px] text-metin-silik">
                {new Date(k.gonderim_zamani ?? k.created_at).toLocaleString("tr-TR", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-metin-orta">{k.govde}</p>
            {k.durum === "taslak" && (
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  onClick={() => taslakSil(k.id)}
                  className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-extrabold text-tehlike-yumusak hover:bg-tehlike-zemin"
                >
                  Sil
                </button>
                <span className="flex-1" />
                {gonderSorulan === k.id ? (
                  <>
                    <button
                      onClick={() => setGonderSorulan(null)}
                      className="px-2 text-[12.5px] font-bold text-metin-orta"
                    >
                      Vazgeç
                    </button>
                    <button
                      onClick={() => gonder(k)}
                      disabled={meskul}
                      className="rounded-xl bg-basari px-3.5 py-2 text-[12.5px] font-extrabold text-white disabled:opacity-50"
                    >
                      Evet, tüm üyelere gönder ✓
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setGonderSorulan(k.id)}
                    className="marka-gradyan rounded-xl px-4 py-2 text-[12.5px] font-extrabold text-white"
                  >
                    Gönder
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
