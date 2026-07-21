"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";
import { useKullanici } from "@/lib/useKullanici";

interface Masa {
  id: string;
  ad: string;
  qr_kod: string;
  aktif: boolean;
  bolum: { id: string; ad: string } | null;
}

interface Bolum {
  id: string;
  ad: string;
}

export default function AdminMasalarPage() {
  const { kullanici, yukleniyor } = useKullanici(["admin"]);
  const [masalar, setMasalar] = useState<Masa[]>([]);
  const [bolumler, setBolumler] = useState<Bolum[]>([]);
  const [qrler, setQrler] = useState<Record<string, string>>({});
  const [yazdirModu, setYazdirModu] = useState(false);
  const [masaEklenen, setMasaEklenen] = useState<string | null>(null);
  const [yeniMasaAd, setYeniMasaAd] = useState("");
  const [bolumEkleniyor, setBolumEkleniyor] = useState(false);
  const [yeniBolumAd, setYeniBolumAd] = useState("");
  const [bolumDuzenlenen, setBolumDuzenlenen] = useState<string | null>(null);
  const [bolumAdDegeri, setBolumAdDegeri] = useState("");

  const yenile = useCallback(async () => {
    if (!kullanici) return;
    const supabase = createClient();
    const [{ data: m }, { data: b }] = await Promise.all([
      supabase
        .from("masa")
        .select("id, ad, qr_kod, aktif, bolum(id, ad)")
        .eq("cafe_id", kullanici.cafe_id)
        .order("ad"),
      supabase.from("bolum").select("id, ad").eq("cafe_id", kullanici.cafe_id).order("sira"),
    ]);
    setMasalar((m ?? []) as unknown as Masa[]);
    setBolumler((b ?? []) as Bolum[]);
  }, [kullanici]);

  useEffect(() => {
    yenile();
  }, [yenile]);

  useEffect(() => {
    (async () => {
      const yeni: Record<string, string> = {};
      for (const m of masalar) {
        yeni[m.id] = await QRCode.toDataURL(`${location.origin}/qr/${m.qr_kod}`, {
          width: 300,
          margin: 1,
          color: { dark: "#2b1c10", light: "#ffffff" },
        });
      }
      setQrler(yeni);
    })();
  }, [masalar]);

  async function bolumEkle() {
    if (!yeniBolumAd.trim() || !kullanici) return;
    const supabase = createClient();
    await supabase.from("bolum").insert({
      cafe_id: kullanici.cafe_id,
      ad: yeniBolumAd.trim(),
      sira: bolumler.length,
    });
    setBolumEkleniyor(false);
    setYeniBolumAd("");
    yenile();
  }

  async function bolumKaydet(bolumId: string) {
    if (!bolumAdDegeri.trim()) return;
    const supabase = createClient();
    await supabase.from("bolum").update({ ad: bolumAdDegeri.trim() }).eq("id", bolumId);
    setBolumDuzenlenen(null);
    yenile();
  }

  async function masaEkle(bolumId: string) {
    if (!yeniMasaAd.trim() || !kullanici) return;
    const supabase = createClient();
    await supabase.from("masa").insert({
      cafe_id: kullanici.cafe_id,
      bolum_id: bolumId,
      ad: yeniMasaAd.trim(),
    });
    setMasaEklenen(null);
    setYeniMasaAd("");
    yenile();
  }

  function indir(m: Masa) {
    const a = document.createElement("a");
    a.href = qrler[m.id];
    a.download = `qr-${m.ad.toLocaleLowerCase("tr").replace(/\s+/g, "-")}.png`;
    a.click();
  }

  useEffect(() => {
    if (!yazdirModu) return;
    const sonra = () => setYazdirModu(false);
    window.addEventListener("afterprint", sonra);
    const z = setTimeout(() => window.print(), 100);
    return () => {
      window.removeEventListener("afterprint", sonra);
      clearTimeout(z);
    };
  }, [yazdirModu]);

  if (yukleniyor) {
    return <p className="animate-pulse text-metin-soluk">Yükleniyor…</p>;
  }

  if (yazdirModu) {
    return (
      <div className="grid grid-cols-2 gap-8 bg-white p-8">
        {masalar
          .filter((m) => m.aktif)
          .map((m) => (
            <div
              key={m.id}
              className="flex break-inside-avoid flex-col items-center gap-2 border border-zinc-300 p-6"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrler[m.id]} alt={m.ad} className="h-48 w-48" />
              <span className="text-2xl font-bold">{m.ad}</span>
              <span className="text-sm text-zinc-500">Menü için QR kodu okutun</span>
            </div>
          ))}
      </div>
    );
  }

  return (
    <div className="max-w-[900px]">
      <div className="flex flex-wrap items-center gap-3.5">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-metin-baslik">Masalar &amp; QR</h1>
          <p className="mt-1 text-[13.5px] text-metin-soluk">
            QR kodları site adresini içerir; deploy sonrası yazdırıp masalara yapıştırın.
          </p>
        </div>
        <span className="flex-1" />
        <button
          onClick={() => {
            setBolumEkleniyor(true);
            setYeniBolumAd("");
          }}
          className="rounded-xl border border-cizgi-koyu bg-kart px-4 py-3 text-sm font-bold text-metin-orta hover:border-marka"
        >
          + Bölüm ekle
        </button>
        <button
          onClick={() => setYazdirModu(true)}
          className="marka-gradyan rounded-xl px-5 py-3 text-sm font-extrabold text-white shadow-[0_4px_12px_rgba(138,75,31,0.25)]"
        >
          Tüm QR&apos;ları Yazdır
        </button>
      </div>

      {bolumEkleniyor && (
        <div className="mt-3 flex gap-2.5 rounded-[14px] border-[1.5px] border-[#9bc4a8] bg-kart p-3.5">
          <input
            autoFocus
            value={yeniBolumAd}
            onChange={(e) => setYeniBolumAd(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && bolumEkle()}
            placeholder="Bölüm adı (örn. Teras, Üst Kat)"
            className="flex-1 rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2.5 text-sm outline-none focus:border-marka"
          />
          <button
            onClick={() => setBolumEkleniyor(false)}
            className="px-2.5 text-[13.5px] font-bold text-metin-soluk"
          >
            Vazgeç
          </button>
          <button
            onClick={bolumEkle}
            className="rounded-[10px] bg-basari px-4 py-2.5 text-[13.5px] font-extrabold text-white"
          >
            Ekle
          </button>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-7">
        {bolumler.map((b) => {
          const bolumMasalari = masalar.filter((m) => m.bolum?.id === b.id);
          return (
            <section key={b.id}>
              <div className="flex items-center gap-3">
                {bolumDuzenlenen === b.id ? (
                  <span className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={bolumAdDegeri}
                      onChange={(e) => setBolumAdDegeri(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && bolumKaydet(b.id)}
                      className="w-40 rounded-[9px] border-[1.5px] border-marka px-2.5 py-1.5 text-sm font-bold outline-none"
                    />
                    <button
                      onClick={() => bolumKaydet(b.id)}
                      className="rounded-[9px] bg-basari px-3 py-2 text-xs font-extrabold text-white"
                    >
                      ✓
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      setBolumDuzenlenen(b.id);
                      setBolumAdDegeri(b.ad);
                    }}
                    title="Bölüm adını düzenle"
                    className="rounded-lg px-1.5 py-0.5 text-base font-extrabold hover:bg-krem-koyu"
                  >
                    {b.ad}
                  </button>
                )}
                <span className="text-[12.5px] text-metin-silik">
                  {bolumMasalari.length} masa
                </span>
                <span className="flex-1" />
                <button
                  onClick={() => {
                    setMasaEklenen(b.id);
                    setYeniMasaAd("");
                  }}
                  className="rounded-lg px-2 py-1.5 text-[13.5px] font-bold text-basari hover:bg-basari-zemin"
                >
                  + Masa ekle
                </button>
              </div>

              {masaEklenen === b.id && (
                <div className="mt-2.5 flex gap-2.5 rounded-[14px] border-[1.5px] border-[#9bc4a8] bg-kart p-3.5">
                  <input
                    autoFocus
                    value={yeniMasaAd}
                    onChange={(e) => setYeniMasaAd(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && masaEkle(b.id)}
                    placeholder={`Masa adı (ör. ${b.ad} ${bolumMasalari.length + 1})`}
                    className="flex-1 rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2.5 text-sm outline-none focus:border-marka"
                  />
                  <button
                    onClick={() => setMasaEklenen(null)}
                    className="px-2.5 text-[13.5px] font-bold text-metin-soluk"
                  >
                    Vazgeç
                  </button>
                  <button
                    onClick={() => masaEkle(b.id)}
                    className="rounded-[10px] bg-basari px-4 py-2.5 text-[13.5px] font-extrabold text-white"
                  >
                    Ekle
                  </button>
                </div>
              )}

              <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                {bolumMasalari.map((m) => (
                  <div
                    key={m.id}
                    className="anim-kart flex flex-col items-center rounded-2xl border border-cizgi bg-kart px-3 py-3.5"
                  >
                    {qrler[m.id] ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={qrler[m.id]}
                        alt={m.ad}
                        className="h-[104px] w-[104px] rounded-md"
                        style={{ imageRendering: "pixelated" }}
                      />
                    ) : (
                      <div className="h-[104px] w-[104px] animate-pulse rounded-md bg-krem-koyu" />
                    )}
                    <span className="mt-2 text-sm font-extrabold">{m.ad}</span>
                    <div className="mt-1.5 flex gap-3 text-xs font-bold">
                      <button
                        onClick={() => indir(m)}
                        className="text-marka-koyu hover:underline"
                      >
                        İndir
                      </button>
                      <a
                        href={`/qr/${m.qr_kod}`}
                        target="_blank"
                        className="text-metin-soluk hover:underline"
                      >
                        Önizle
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
