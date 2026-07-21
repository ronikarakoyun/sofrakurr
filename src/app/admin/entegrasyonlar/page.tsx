"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useKullanici } from "@/lib/useKullanici";

type PlatformId = "trendyol_go" | "yemeksepeti" | "migros";

interface Platform {
  id: PlatformId;
  ad: string;
  renk: string;
  not: string;
}

const PLATFORMLAR: Platform[] = [
  {
    id: "trendyol_go",
    ad: "Uber Eats · Trendyol GO",
    renk: "#f27a1a",
    not: "partner.trendyol.com → Firma → Hesap Bilgilerim → Entegrasyon Bilgileri",
  },
  {
    id: "yemeksepeti",
    ad: "Yemeksepeti",
    renk: "#d6002a",
    not: "Yemeksepeti Partner Portal → Entegrasyon / API bilgileri",
  },
  {
    id: "migros",
    ad: "Migros Yemek",
    renk: "#00953b",
    not: "Migros Yemek satıcı paneli → Entegrasyon anahtarları",
  },
];

interface Ozet {
  platform: PlatformId;
  satici_no: string | null;
  anahtar_var: boolean;
  secret_var: boolean;
  anahtar_son4: string | null;
  aktif: boolean;
}

export default function EntegrasyonlarPage() {
  const { kullanici } = useKullanici(["admin"]);
  const supabase = createClient();
  const [ozetler, setOzetler] = useState<Record<string, Ozet>>({});
  const [taslak, setTaslak] = useState<Record<string, { satici_no: string; api_anahtar: string; api_secret: string }>>({});
  const [mesaj, setMesaj] = useState<{ metin: string; hata: boolean } | null>(null);
  const [meskul, setMeskul] = useState<string | null>(null);
  const [okc, setOkc] = useState<{ tanimli: boolean; son4: string }>({ tanimli: false, son4: "" });
  const [yeniOkcAnahtar, setYeniOkcAnahtar] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    if (!kullanici) return;
    const { data } = await supabase
      .from("cafe_entegrasyon_ozet")
      .select("platform, satici_no, anahtar_var, secret_var, anahtar_son4, aktif")
      .eq("cafe_id", kullanici.cafe_id);
    const harita: Record<string, Ozet> = {};
    (data as Ozet[] | null)?.forEach((o) => (harita[o.platform] = o));
    setOzetler(harita);
    const { data: okcD } = await supabase.rpc("okc_durum");
    if (okcD?.[0]) setOkc({ tanimli: okcD[0].tanimli, son4: okcD[0].son4 });
  }, [kullanici, supabase]);

  async function okcAnahtarUret() {
    if (!confirm("Yeni yazarkasa anahtarı üretilsin mi? Eskisi (varsa) geçersiz olur.")) return;
    const { data, error } = await supabase.rpc("okc_anahtar_uret");
    if (error) return bilgi("Anahtar üretilemedi: " + error.message, true);
    setYeniOkcAnahtar(data as string);
    yukle();
  }

  useEffect(() => {
    if (kullanici) yukle();
  }, [kullanici, yukle]);

  function bilgi(metin: string, hata = false) {
    setMesaj({ metin, hata });
    setTimeout(() => setMesaj(null), 5000);
  }

  const alan = (p: PlatformId, k: "satici_no" | "api_anahtar" | "api_secret") =>
    taslak[p]?.[k] ?? "";
  const alanYaz = (p: PlatformId, k: "satici_no" | "api_anahtar" | "api_secret", v: string) =>
    setTaslak((t) => {
      const mevcut = t[p] ?? { satici_no: "", api_anahtar: "", api_secret: "" };
      return { ...t, [p]: { ...mevcut, [k]: v } };
    });

  async function kaydet(p: PlatformId) {
    if (!kullanici || meskul) return;
    const t = taslak[p] ?? { satici_no: "", api_anahtar: "", api_secret: "" };
    // Boş bırakılan alanlar mevcut değeri korur (upsert'te yalnız dolu alanları gönder)
    const kayit: Record<string, unknown> = {
      cafe_id: kullanici.cafe_id,
      platform: p,
      updated_at: new Date().toISOString(),
    };
    if (t.satici_no.trim()) kayit.satici_no = t.satici_no.trim();
    if (t.api_anahtar.trim()) kayit.api_anahtar = t.api_anahtar.trim();
    if (t.api_secret.trim()) kayit.api_secret = t.api_secret.trim();
    setMeskul(p);
    const { error } = await supabase.from("cafe_entegrasyon").upsert(kayit, { onConflict: "cafe_id,platform" });
    setMeskul(null);
    if (error) return bilgi("Kaydedilemedi: " + error.message, true);
    setTaslak((t2) => ({ ...t2, [p]: { satici_no: "", api_anahtar: "", api_secret: "" } }));
    bilgi("Kaydedildi ✓");
    yukle();
  }

  async function aktifDegistir(p: PlatformId, aktif: boolean) {
    if (!kullanici) return;
    const { error } = await supabase
      .from("cafe_entegrasyon")
      .upsert({ cafe_id: kullanici.cafe_id, platform: p, aktif }, { onConflict: "cafe_id,platform" });
    if (error) return bilgi("Güncellenemedi: " + error.message, true);
    yukle();
  }

  if (!kullanici) return null;
  const inputStil =
    "w-full rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2.5 text-sm outline-none focus:border-marka";

  return (
    <div className="max-w-2xl">
      <h1 className="font-serif text-2xl font-semibold text-metin-baslik">Entegrasyonlar</h1>
      <p className="mt-1 text-sm text-metin-soluk">
        Yemek platformu API anahtarlarınızı buraya girin. Anahtarlar kayıtlıyken, o
        platformdan gelen siparişler otomatik olarak sisteminize düşecek.
      </p>
      <p className="mt-2 rounded-xl bg-uyari-zemin px-3.5 py-2.5 text-[12.5px] font-semibold leading-relaxed text-uyari">
        ⓘ Sipariş çekme altyapısı hazırlanıyor. Şimdilik anahtarlarınızı güvenle
        kaydedebilirsiniz; canlı sipariş akışı devreye girince buradaki bilgiler kullanılacak.
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

      <div className="mt-5 flex flex-col gap-4">
        {PLATFORMLAR.map((pl) => {
          const o = ozetler[pl.id];
          const tanimli = o?.anahtar_var;
          return (
            <div key={pl.id} className="rounded-2xl border border-cizgi bg-kart p-4">
              <div className="flex items-center gap-2.5">
                <span
                  className="h-3 w-3 flex-shrink-0 rounded-full"
                  style={{ background: pl.renk }}
                />
                <span className="text-[15.5px] font-extrabold text-metin-baslik">{pl.ad}</span>
                {tanimli ? (
                  <span className="rounded-full bg-basari-zemin px-2.5 py-0.5 text-[11px] font-extrabold text-basari">
                    tanımlı ····{o.anahtar_son4}
                  </span>
                ) : (
                  <span className="rounded-full bg-krem-koyu px-2.5 py-0.5 text-[11px] font-extrabold text-metin-soluk">
                    tanımsız
                  </span>
                )}
                <span className="flex-1" />
                {tanimli && (
                  <label className="flex items-center gap-1.5 text-[12.5px] font-bold text-metin-orta">
                    <input
                      type="checkbox"
                      checked={o?.aktif ?? false}
                      onChange={(e) => aktifDegistir(pl.id, e.target.checked)}
                      className="h-4 w-4 accent-[color:var(--marka,#c86f2c)]"
                    />
                    aktif
                  </label>
                )}
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <input
                  value={alan(pl.id, "satici_no")}
                  onChange={(e) => alanYaz(pl.id, "satici_no", e.target.value)}
                  placeholder={o?.satici_no ? `Satıcı No (mevcut: ${o.satici_no})` : "Satıcı / Restoran No"}
                  className={inputStil}
                />
                <input
                  value={alan(pl.id, "api_anahtar")}
                  onChange={(e) => alanYaz(pl.id, "api_anahtar", e.target.value)}
                  placeholder={o?.anahtar_var ? "API Anahtarı (değiştir)" : "API Anahtarı"}
                  autoComplete="off"
                  className={inputStil}
                />
                <input
                  value={alan(pl.id, "api_secret")}
                  onChange={(e) => alanYaz(pl.id, "api_secret", e.target.value)}
                  placeholder={o?.secret_var ? "Gizli Anahtar (değiştir)" : "Gizli Anahtar / Secret"}
                  autoComplete="off"
                  className={inputStil}
                />
              </div>
              <div className="mt-2 flex items-center gap-3">
                <span className="text-[11.5px] text-metin-silik">{pl.not}</span>
                <span className="flex-1" />
                <button
                  onClick={() => kaydet(pl.id)}
                  disabled={meskul === pl.id}
                  className="marka-gradyan rounded-xl px-4 py-2 text-[13px] font-extrabold text-white disabled:opacity-60"
                >
                  {meskul === pl.id ? "Kaydediliyor…" : "Kaydet"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-5 text-[12px] leading-relaxed text-metin-silik">
        Boş bıraktığınız alan mevcut değeri korur — yalnız değiştirmek istediğinizi doldurun.
        Anahtarlar şifreli saklanır ve yalnızca bu kafenin yöneticisi erişebilir.
      </p>

      {/* ── Yazarkasa (ÖKC) bağlantısı ── */}
      <h2 className="mt-9 font-serif text-xl font-semibold text-metin-baslik">
        Yazarkasa (ÖKC) Bağlantısı
      </h2>
      <p className="mt-1 text-sm text-metin-soluk">
        Yazarkasa POS&apos;unuzdan açık hesapları seçip tahsilat alabilmeniz için. Aşağıdaki
        anahtarı ve adresleri cihazınızın (ya da entegratörünüzün) ayarına girin.
      </p>

      <div className="mt-3 rounded-2xl border border-cizgi bg-kart p-4">
        <div className="flex items-center gap-2.5">
          <span className="text-[15.5px] font-extrabold text-metin-baslik">Bağlantı Anahtarı</span>
          {okc.tanimli ? (
            <span className="rounded-full bg-basari-zemin px-2.5 py-0.5 text-[11px] font-extrabold text-basari">
              tanımlı ····{okc.son4}
            </span>
          ) : (
            <span className="rounded-full bg-krem-koyu px-2.5 py-0.5 text-[11px] font-extrabold text-metin-soluk">
              tanımsız
            </span>
          )}
          <span className="flex-1" />
          <button
            onClick={okcAnahtarUret}
            className="rounded-xl border border-cizgi-koyu bg-kart px-3.5 py-2 text-[13px] font-extrabold text-metin-orta"
          >
            {okc.tanimli ? "Yeni Anahtar Üret" : "Anahtar Üret"}
          </button>
        </div>

        {yeniOkcAnahtar && (
          <div className="mt-3 rounded-xl bg-basari-zemin px-3.5 py-3">
            <p className="text-[12.5px] font-bold text-basari">
              Yeni anahtarınız (bir kez gösterilir — kopyalayıp cihaza girin):
            </p>
            <code className="mt-1.5 block break-all rounded-lg bg-white px-3 py-2 text-[13px] font-bold text-metin-baslik">
              {yeniOkcAnahtar}
            </code>
          </div>
        )}

        <div className="mt-3 flex flex-col gap-1.5 text-[12.5px] text-metin-soluk">
          <div>
            <span className="font-bold text-metin-orta">Açık hesaplar adresi:</span>{" "}
            <code className="break-all">https://sofrakur.com/api/okc/hesaplar</code>
          </div>
          <div>
            <span className="font-bold text-metin-orta">Ödeme bildirimi adresi:</span>{" "}
            <code className="break-all">https://sofrakur.com/api/okc/ode</code>
          </div>
          <div className="text-[11.5px] text-metin-silik">
            Kimlik doğrulama: her istekte <code>x-okc-anahtar</code> başlığında yukarıdaki anahtar.
          </div>
        </div>

        <p className="mt-3 rounded-xl bg-uyari-zemin px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-uyari">
          ⓘ Bu, SofraKur tarafındaki hazır arayüzdür. Cihaz üzerindeki uygulama yazarkasa
          markanıza (Ingenico, Beko, Hugin, Profilo…) ve mali entegratörünüze bağlıdır;
          markanızı bize iletin, o tarafın kurulumunu birlikte planlayalım.
        </p>
      </div>
    </div>
  );
}
