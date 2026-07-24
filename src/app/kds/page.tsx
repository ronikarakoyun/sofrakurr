"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CikisButonu } from "@/components/CikisButonu";
import { SiparisFisi, type FisVerisi } from "@/components/SiparisFisi";
import { useKullanici } from "@/lib/useKullanici";
import { useSiparisler } from "@/lib/useSiparisler";
import { sesHazirla, yeniSiparisSesi } from "@/lib/beep";
import {
  ISTASYONLAR,
  ISTASYON_SIMGE,
  siparisKimlik,
  type Siparis,
  type SiparisDurum,
  type SiparisKalemi,
} from "@/lib/types";

const DURUM: Record<string, { renk: string; etiket: string }> = {
  bekliyor: { renk: "#5b8dd6", etiket: "SIRADA" },
  hazirlaniyor: { renk: "#e08a3c", etiket: "HAZIRLANIYOR" },
  hazir: { renk: "#4caf7d", etiket: "HAZIR" },
};

// "Hazır" son adımdır: self-serviste sipariş kapanır (müşteri tezgahtan alır),
// masalı kafede kart 'hazir'de kalır ve garson kasa ekranından teslim eder.
const SONRAKI: Partial<Record<SiparisDurum, { durum: SiparisDurum; etiket: string }>> = {
  bekliyor: { durum: "hazirlaniyor", etiket: "Hazırlamaya Başla" },
  hazirlaniyor: { durum: "hazir", etiket: "Hazır ✓" },
};

function kalemOpsiyonStr(k: SiparisKalemi): string {
  return k.secilen_opsiyonlar.map((o) => o.secim).join(", ");
}

export default function KdsPage() {
  // kasa ekranı emekli edildi: tezgah (kasa) personeli de KDS'e girer
  const { kullanici, yukleniyor } = useKullanici(["admin", "mutfak", "kasa"]);
  const [istasyon, setIstasyon] = useState<string>("tumu");
  const [otoYazdir, setOtoYazdir] = useState(false);
  const [fisKuyrugu, setFisKuyrugu] = useState<FisVerisi[]>([]);
  const [kalemSorusu, setKalemSorusu] = useState<string | null>(null);
  const [reddetSorusu, setReddetSorusu] = useState<string | null>(null);
  const [iptalSorusu, setIptalSorusu] = useState<string | null>(null);
  const [bildirimDurum, setBildirimDurum] = useState<"yok" | "acik" | "kapali">("yok");
  const [saat, setSaat] = useState("");
  const gorulenler = useRef<Set<string> | null>(null);
  const yazdiriliyor = useRef(false);
  const { siparisler, yenile } = useSiparisler(
    ["bekliyor", "hazirlaniyor", "hazir"],
    yeniSiparisSesi
  );

  useEffect(() => {
    setIstasyon(localStorage.getItem("kds-istasyon") ?? "tumu");
    setOtoYazdir(localStorage.getItem("kds-oto-yazdir") === "1");
    const g = () => setSaat(new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }));
    g();
    const z = setInterval(g, 30_000);
    return () => clearInterval(z);
  }, []);

  function istasyonSec(yeni: string) {
    setIstasyon(yeni);
    localStorage.setItem("kds-istasyon", yeni);
  }

  function otoDegistir() {
    setOtoYazdir((o) => {
      localStorage.setItem("kds-oto-yazdir", o ? "0" : "1");
      return !o;
    });
  }

  // Yeni sipariş web-push aboneliği (kasa ekranından taşındı): ekran kapalıyken
  // de "yeni sipariş" bildirimi gelsin diye cihaz push_abonelik'e kaydolur.
  async function bildirimAc() {
    try {
      const izin = await Notification.requestPermission();
      if (izin !== "granted") {
        setBildirimDurum("kapali");
        return;
      }
      const kayit = await navigator.serviceWorker.register("/sw.js");
      const abonelik = await kayit.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      });
      const j = abonelik.toJSON();
      const supabase = createClient();
      await supabase.from("push_abonelik").upsert(
        {
          cafe_id: kullanici!.cafe_id,
          kullanici_id: kullanici!.id,
          endpoint: j.endpoint!,
          p256dh: j.keys!.p256dh,
          auth: j.keys!.auth,
        },
        { onConflict: "endpoint" }
      );
      setBildirimDurum("acik");
    } catch {
      setBildirimDurum("kapali");
    }
  }

  useEffect(() => {
    if (kullanici) bildirimAc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kullanici]);

  // Bir siparişin bu istasyonu ilgilendiren kalemleri
  function kendiKalemleri(s: Siparis): SiparisKalemi[] {
    return s.siparis_kalemi.filter(
      (k) => !k.reddedildi && (istasyon === "tumu" || (k.istasyon ?? "mutfak") === istasyon)
    );
  }

  function fisYap(s: Siparis): FisVerisi {
    return {
      masaAd: siparisKimlik(s),
      istasyon: istasyon === "tumu" ? "SİPARİŞ" : istasyon.toLocaleUpperCase("tr"),
      saat: new Date(s.created_at).toLocaleString("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
      kalemler: kendiKalemleri(s).map((k) => ({
        adet: k.adet,
        ad: k.urun_ad,
        opsiyonlar: kalemOpsiyonStr(k),
        not: k.kalem_notu ?? undefined,
      })),
      not: s.musteri_notu,
    };
  }

  // Yeni sipariş geldiğinde otomatik fiş kuyruğa girer
  useEffect(() => {
    const guncel = new Set(siparisler.map((s) => s.id));
    if (gorulenler.current === null) {
      gorulenler.current = guncel; // ilk yükleme: mevcutları basma
      return;
    }
    const yeniler = siparisler.filter(
      (s) => !gorulenler.current!.has(s.id) && kendiKalemleri(s).length > 0
    );
    gorulenler.current = guncel;
    if (otoYazdir && yeniler.length) {
      setFisKuyrugu((k) => [...k, ...yeniler.map(fisYap)]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siparisler]);

  // Fiş kuyruğunu sırayla yazdır
  useEffect(() => {
    if (!fisKuyrugu.length || yazdiriliyor.current) return;
    yazdiriliyor.current = true;
    const bittiginde = () => {
      window.removeEventListener("afterprint", bittiginde);
      yazdiriliyor.current = false;
      setFisKuyrugu((k) => k.slice(1));
    };
    window.addEventListener("afterprint", bittiginde);
    const z = setTimeout(() => window.print(), 150);
    return () => clearTimeout(z);
  }, [fisKuyrugu]);

  async function pushGonder(s: Siparis) {
    const kalemler = s.siparis_kalemi
      .filter((k) => !k.reddedildi)
      .map((k) => `${k.adet}× ${k.urun_ad}`)
      .join(", ");
    fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baslik: `${siparisKimlik(s)} · Sipariş hazır`, govde: kalemler, tag: `hazir-${s.id}` }),
    }).catch(() => {});
  }

  async function durumIlerlet(s: Siparis) {
    const supabase = createClient();

    if (istasyon !== "tumu" && s.durum === "hazirlaniyor") {
      // istasyon kendi kalemlerini bitirdi; tüm istasyonlar bitince sipariş
      // veritabanı tetikleyicisiyle otomatik 'hazir' olur
      const { error } = await supabase
        .from("siparis_kalemi")
        .update({ hazir: true })
        .eq("siparis_id", s.id)
        .eq("istasyon", istasyon)
        .eq("reddedildi", false);
      if (error) alert("İşlem tamamlanamadı: " + error.message);
      // Tüm istasyonlar bitince DB tetikleyicisi siparişi 'hazir' yapar.
      // Masalı siparişte garsonun haberi olmalı (masaya götürecek); müşteriye
      // giden bildirimi 0042 trigger'ı ayrıca üstlenir.
      const { data } = await supabase.from("siparis").select("durum").eq("id", s.id).single();
      if (data?.durum === "hazir" && s.masa) pushGonder(s);
      yenile();
      return;
    }

    const sonraki = SONRAKI[s.durum];
    if (!sonraki) return;
    // "Hazır": tek yetkili yol RPC — masasız siparişi teslime taşır, müşteri
    // push'unu 0042 trigger'ı üstlenir.
    const { error } =
      sonraki.durum === "hazir"
        ? await supabase.rpc("siparis_hazir_ver", { p_siparis_id: s.id })
        : await supabase.from("siparis").update({ durum: sonraki.durum }).eq("id", s.id);
    if (error) alert("Durum güncellenemedi: " + error.message);
    // masalı siparişte garsona "hazır" bildirimi (self-serviste müşteri kendi alır)
    if (!error && sonraki.durum === "hazir" && s.masa) pushGonder(s);
    setKalemSorusu(null);
    setReddetSorusu(null);
    yenile();
  }

  async function kalemReddet(s: Siparis, k: SiparisKalemi) {
    const supabase = createClient();
    const { error } = await supabase
      .from("siparis_kalemi")
      .update({ reddedildi: true, red_nedeni: "Ürün bitti" })
      .eq("id", k.id);
    if (error) { alert("Kalem reddedilemedi: " + error.message); return; }
    // Ürünü menüden pasife çek (güvenli RPC — mutfak menü fiyatını değiştiremez)
    await supabase.rpc("urun_bitti", { p_urun_id: k.urun_id });
    const kalanlar = s.siparis_kalemi.filter((x) => x.id !== k.id && !x.reddedildi);
    if (kalanlar.length === 0) {
      await supabase.from("siparis").update({ durum: "reddedildi" }).eq("id", s.id);
    }
    setKalemSorusu(null);
    yenile();
  }

  async function siparisReddet(s: Siparis) {
    const supabase = createClient();
    const { error } = await supabase.from("siparis").update({ durum: "reddedildi" }).eq("id", s.id);
    if (error) alert("Sipariş reddedilemedi: " + error.message);
    setReddetSorusu(null);
    yenile();
  }

  // Müşteri vazgeçti / sorun çözme: sipariş iptal edilir (stok ve puan
  // iadelerini DB trigger'ları üstlenir, boş kalan adisyon kendiliğinden kapanır)
  async function siparisIptal(s: Siparis) {
    const supabase = createClient();
    const { error } = await supabase.from("siparis").update({ durum: "iptal" }).eq("id", s.id);
    if (error) alert("Sipariş iptal edilemedi: " + error.message);
    setIptalSorusu(null);
    yenile();
  }

  if (yukleniyor) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-kds-zemin">
        <p className="animate-pulse text-kds-soluk">Yükleniyor…</p>
      </main>
    );
  }

  // İstasyon görünümünde: bu istasyonu ilgilendiren ve işi bitmemiş kartlar
  const gorunenler = siparisler.filter((s) => {
    if (istasyon === "tumu") return true;
    if (s.durum === "hazir") return false; // istasyonun işi bitti
    const kendi = kendiKalemleri(s);
    return kendi.length > 0 && kendi.some((k) => !k.hazir);
  });

  const sayilar = {
    bekliyor: gorunenler.filter((s) => s.durum === "bekliyor").length,
    hazirlaniyor: gorunenler.filter((s) => s.durum === "hazirlaniyor").length,
    hazir: siparisler.filter((s) => s.durum === "hazir").length,
  };

  return (
    <main
      className="flex min-h-dvh flex-col bg-kds-zemin font-sans text-kds-metin"
      onClick={sesHazirla}
    >
      {/* Üst bar */}
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3.5 border-b border-kds-cizgi bg-kds-bar px-5 py-3.5">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="SofraKur logosu" className="h-[38px] w-[38px] rounded-[11px]" />
          <div>
            <div className="text-[16.5px] font-extrabold leading-tight">
              {istasyon === "tumu" ? "Mutfak Ekranı" : `${ISTASYON_SIMGE[istasyon]} ${istasyon.toLocaleUpperCase("tr")}`}
            </div>
            <div className="text-[12.5px] text-kds-soluk">{kullanici?.cafe_ad ?? ""}</div>
          </div>
        </div>

        {/* İstasyon seçici */}
        <div className="flex gap-1 rounded-[13px] bg-kds-kart p-1">
          {["tumu", ...ISTASYONLAR].map((i) => (
            <button
              key={i}
              onClick={() => istasyonSec(i)}
              className={
                "rounded-[10px] px-3 py-1.5 text-[13px] font-bold " +
                (istasyon === i ? "bg-kds-rozet text-kds-metin" : "text-kds-soluk")
              }
            >
              {i === "tumu" ? "Tümü" : `${ISTASYON_SIMGE[i]} ${i}`}
            </button>
          ))}
        </div>

        <span className="flex-1" />
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["bekliyor", "sırada"],
              ["hazirlaniyor", "hazırlanıyor"],
              ["hazir", "hazır"],
            ] as const
          ).map(([durum, etiket]) => (
            <span
              key={durum}
              className="flex items-center gap-1.5 rounded-full border border-kds-cizgi bg-kds-kart px-3 py-1.5 text-[13px] font-bold"
            >
              <span className="h-2 w-2 rounded-full" style={{ background: DURUM[durum].renk }} />
              {sayilar[durum]} {etiket}
            </span>
          ))}
          <button
            onClick={otoDegistir}
            title="Yeni siparişte otomatik fiş yazdır"
            className={
              "rounded-full border border-kds-cizgi px-3 py-1.5 text-[13px] font-bold " +
              (otoYazdir ? "bg-basari text-white" : "bg-kds-kart text-kds-soluk")
            }
          >
            🖨 oto {otoYazdir ? "açık" : "kapalı"}
          </button>
          <button
            onClick={bildirimAc}
            title={bildirimDurum === "acik" ? "Bildirimler açık" : "Bildirimleri aç"}
            className={
              "rounded-full border border-kds-cizgi px-3 py-1.5 text-[13px] font-bold " +
              (bildirimDurum === "acik" ? "bg-kds-rozet text-kds-metin" : "bg-kds-kart text-kds-soluk")
            }
          >
            {bildirimDurum === "acik" ? "🔔" : "🔕"}
          </button>
          <span className="ml-1.5 text-sm font-bold tabular-nums text-kds-soluk">{saat}</span>
          <CikisButonu />
        </div>
      </header>

      {/* Sipariş satırları — en eski en üstte */}
      <div className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-3 px-5 pb-6 pt-4">
        {gorunenler.length === 0 ? (
          <div className="px-5 py-24 text-center text-kds-silik">
            <div className="text-[34px]">{istasyon === "tumu" ? "☕" : ISTASYON_SIMGE[istasyon]}</div>
            <p className="mt-3 text-lg font-bold text-kds-soluk">Bekleyen sipariş yok</p>
            <p className="mt-1 text-[13.5px]">
              Yeni sipariş geldiğinde sesli uyarıyla burada belirir.
            </p>
          </div>
        ) : (
          gorunenler.map((s) => {
            const d = DURUM[s.durum] ?? DURUM.bekliyor;
            const dk = Math.round((Date.now() - new Date(s.created_at).getTime()) / 60000);
            const acil = dk >= 10;
            const digerKalemler =
              istasyon === "tumu"
                ? []
                : s.siparis_kalemi.filter(
                    (k) => !k.reddedildi && (k.istasyon ?? "mutfak") !== istasyon
                  );
            const anaEtiket =
              istasyon !== "tumu" && s.durum === "hazirlaniyor"
                ? `${ISTASYON_SIMGE[istasyon]} Hazır ✓`
                : SONRAKI[s.durum]?.etiket;
            return (
              <div
                key={s.id}
                className={
                  "flex flex-wrap items-start gap-4 rounded-2xl border border-kds-cizgi bg-kds-kart px-[18px] py-4 " +
                  (s.durum === "hazir" ? "anim-nabiz" : "anim-kart")
                }
                style={{ borderLeft: `5px solid ${d.renk}` }}
              >
                {/* Sol: durum + masa + süre */}
                <div className="flex w-[172px] flex-shrink-0 flex-col items-start gap-[7px]">
                  <span className="text-xs font-extrabold tracking-[1.4px]" style={{ color: d.renk }}>
                    {d.etiket}
                  </span>
                  <span className="text-[27px] font-extrabold leading-tight tracking-tight">
                    {s.siparis_no != null ? `#${s.siparis_no}` : s.masa?.ad ?? "Sipariş"}
                  </span>
                  {s.siparis_no != null && s.masa && (
                    <span className="text-[13px] font-bold text-kds-soluk">{s.masa.ad}</span>
                  )}
                  <span
                    className={
                      "whitespace-nowrap rounded-full px-3 py-1 text-[13.5px] font-extrabold tabular-nums " +
                      (acil ? "bg-kds-acil-zemin text-kds-acil" : "bg-kds-rozet text-kds-soluk")
                    }
                  >
                    {dk < 1 ? "az önce" : `${dk} dk`}
                  </span>
                  <button
                    onClick={() => setFisKuyrugu((k) => [...k, fisYap(s)])}
                    title="Fiş yazdır"
                    className="rounded-lg border border-kds-cizgi px-2.5 py-1 text-[12px] font-bold text-kds-soluk hover:bg-kds-rozet"
                  >
                    🖨 fiş
                  </button>
                </div>

                {/* Orta: kalemler + not */}
                <div className="flex min-w-[240px] flex-1 flex-col gap-2">
                  {kendiKalemleri(s).map((k) => {
                    const soruAnahtari = `${s.id}:${k.id}`;
                    return (
                      <div key={k.id}>
                        <div className="flex items-start gap-2.5">
                          <span
                            className={
                              "min-w-0 text-[19px] font-semibold leading-normal " +
                              (k.hazir ? "opacity-45 line-through" : "")
                            }
                          >
                            <strong className="text-durum-hazirlaniyor">{k.adet} ×</strong>{" "}
                            {k.urun_ad}
                            {k.secilen_opsiyonlar.length > 0 && (
                              <span className="text-sm font-medium text-kds-soluk">
                                {" "}
                                — {kalemOpsiyonStr(k)}
                              </span>
                            )}
                            {k.kalem_notu && (
                              <span className="mt-0.5 block text-[15px] font-bold italic text-durum-hazir">
                                ✎ {k.kalem_notu}
                              </span>
                            )}
                          </span>
                          {!k.hazir && s.durum !== "hazir" && kalemSorusu !== soruAnahtari && (
                            <button
                              onClick={() => {
                                setKalemSorusu(soruAnahtari);
                                setReddetSorusu(null);
                              }}
                              className="mt-0.5 flex-shrink-0 rounded-lg border border-[#4a3527] px-2 py-1 text-[11.5px] font-bold text-[#d98a76] hover:bg-kds-kirmizi-kutu"
                              title="Ürün bitti / kalemi reddet"
                            >
                              bitti
                            </button>
                          )}
                        </div>
                        {kalemSorusu === soruAnahtari && (
                          <div className="mt-1.5 flex max-w-[420px] items-center gap-2 rounded-[10px] bg-kds-kirmizi-kutu px-3 py-2">
                            <span className="flex-1 text-[12.5px] font-bold text-[#d98a76]">
                              Kalem reddedilsin, ürün pasife alınsın mı?
                            </span>
                            <button
                              onClick={() => setKalemSorusu(null)}
                              className="px-1.5 py-1 text-[12.5px] font-bold text-kds-soluk"
                            >
                              Vazgeç
                            </button>
                            <button
                              onClick={() => kalemReddet(s, k)}
                              className="rounded-lg bg-tehlike px-3 py-1.5 text-[12.5px] font-extrabold text-white"
                            >
                              Evet
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {digerKalemler.length > 0 && (
                    <p className="text-[12.5px] text-kds-silik">
                      diğer istasyonlar:{" "}
                      {digerKalemler
                        .map((k) => `${ISTASYON_SIMGE[k.istasyon ?? "mutfak"]} ${k.adet}× ${k.urun_ad}${k.hazir ? " ✓" : ""}`)
                        .join(" · ")}
                    </p>
                  )}

                  {s.musteri_notu && (
                    <p className="mt-0.5 max-w-[520px] rounded-[10px] border border-[rgba(224,138,60,0.25)] bg-[rgba(224,138,60,0.1)] px-3 py-2 text-sm italic text-kds-not-metin">
                      “{s.musteri_notu}”
                    </p>
                  )}

                  {reddetSorusu === s.id && (
                    <div className="mt-0.5 flex max-w-[480px] items-center gap-2.5 rounded-xl bg-kds-kirmizi-kutu px-3 py-2.5">
                      <span className="flex-1 text-[13px] font-bold text-[#d98a76]">
                        Siparişin tamamı reddedilsin mi?
                      </span>
                      <button
                        onClick={() => setReddetSorusu(null)}
                        className="px-2 py-1.5 text-[13px] font-bold text-kds-soluk"
                      >
                        Vazgeç
                      </button>
                      <button
                        onClick={() => siparisReddet(s)}
                        className="rounded-[9px] bg-tehlike px-3.5 py-2 text-[13px] font-extrabold text-white"
                      >
                        Evet, reddet
                      </button>
                    </div>
                  )}

                  {iptalSorusu === s.id && (
                    <div className="mt-0.5 flex max-w-[480px] items-center gap-2.5 rounded-xl bg-kds-kirmizi-kutu px-3 py-2.5">
                      <span className="flex-1 text-[13px] font-bold text-[#d98a76]">
                        Sipariş iptal edilsin mi? (müşteri vazgeçti / alınamadı)
                      </span>
                      <button
                        onClick={() => setIptalSorusu(null)}
                        className="px-2 py-1.5 text-[13px] font-bold text-kds-soluk"
                      >
                        Vazgeç
                      </button>
                      <button
                        onClick={() => siparisIptal(s)}
                        className="rounded-[9px] bg-tehlike px-3.5 py-2 text-[13px] font-extrabold text-white"
                      >
                        Evet, iptal et
                      </button>
                    </div>
                  )}
                </div>

                {/* Sağ: aksiyonlar */}
                <div className="flex w-[210px] flex-shrink-0 flex-col justify-center gap-2">
                  <button
                    onClick={() => durumIlerlet(s)}
                    className={
                      "w-full rounded-xl px-3.5 py-3.5 text-[15.5px] font-extrabold " +
                      (s.durum === "bekliyor"
                        ? "marka-gradyan text-white"
                        : s.durum === "hazirlaniyor"
                          ? "bg-basari text-white"
                          : "bg-[#3d3226] text-[#d8cbb8]")
                    }
                  >
                    {anaEtiket}
                  </button>
                  {s.durum === "bekliyor" && reddetSorusu !== s.id && (
                    <button
                      onClick={() => {
                        setReddetSorusu(s.id);
                        setKalemSorusu(null);
                        setIptalSorusu(null);
                      }}
                      className="rounded-[10px] px-2.5 py-2 text-[13.5px] font-bold text-[#d98a76] hover:bg-kds-kirmizi-kutu"
                    >
                      Reddet
                    </button>
                  )}
                  {["bekliyor", "hazirlaniyor"].includes(s.durum) && iptalSorusu !== s.id && (
                    <button
                      onClick={() => {
                        setIptalSorusu(s.id);
                        setReddetSorusu(null);
                        setKalemSorusu(null);
                      }}
                      className="rounded-[10px] px-2.5 py-2 text-[13.5px] font-bold text-kds-soluk hover:bg-kds-kirmizi-kutu"
                    >
                      İptal
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <SiparisFisi fis={fisKuyrugu[0] ?? null} />
    </main>
  );
}
