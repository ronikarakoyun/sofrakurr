"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CikisButonu } from "@/components/CikisButonu";
import { GunSonuBolumu } from "@/components/GunSonuBolumu";
import { SiparisGirisi } from "@/components/SiparisGirisi";
import { TedarikciBolumu } from "@/components/TedarikciBolumu";
import { useKullanici } from "@/lib/useKullanici";
import { useSiparisler } from "@/lib/useSiparisler";
import { sesHazirla, yeniSiparisSesi } from "@/lib/beep";
import {
  dakikaOnce,
  kalemTutar,
  siparisKimlik,
  siparisTutar,
  tl,
  yetkiVar,
  type Siparis,
  type SiparisDurum,
  type SiparisKalemi,
} from "@/lib/types";

interface AcikAdisyon {
  id: string;
  acilis: string;
  masa_id: string | null;
  iskonto_tutar: number;
  masa: { id: string; ad: string } | null; // self-servis (masasız) adisyonda null
  siparis: {
    id: string;
    durum: SiparisDurum;
    siparis_kalemi: SiparisKalemi[];
  }[];
}

// Kapatılmış hesap (arşiv): kalemleriyle birlikte saklanır, istenince yazdırılır
interface KapaliAdisyon {
  id: string;
  kapanis: string;
  odeme_turu: "nakit" | "kart" | "cari" | null;
  iskonto_tutar: number;
  masa: { ad: string } | null; // self-servis (masasız) adisyonda null
  siparis: {
    id: string;
    durum: SiparisDurum;
    siparis_kalemi: SiparisKalemi[];
  }[];
}

type Sekme = "siparis" | "odeme" | "gecmis" | "gunsonu" | "tedarikci";
const SEKMELER: Sekme[] = ["siparis", "odeme", "gecmis", "gunsonu", "tedarikci"];

export default function KasaPage() {
  const { kullanici, yukleniyor } = useKullanici(["admin", "kasa"]);
  // Açılış sekmesi URL'den okunur (/kasa?sekme=gunsonu eski Gün Sonu adresinden yönlenir)
  const [sekme, setSekme] = useState<Sekme>(() => {
    if (typeof window === "undefined") return "odeme";
    const s = new URLSearchParams(window.location.search).get("sekme") as Sekme | null;
    return s && SEKMELER.includes(s) ? s : "odeme";
  });
  const [gecmisTarih, setGecmisTarih] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [gecmisler, setGecmisler] = useState<KapaliAdisyon[]>([]);
  const [gecmisAcik, setGecmisAcik] = useState<string | null>(null);
  const [gecmisFis, setGecmisFis] = useState<string | null>(null);
  const [odemeModu, setOdemeModu] = useState<"once_odeme" | "acik_hesap">("once_odeme");
  const [masaDuzeni, setMasaDuzeni] = useState(true); // false = self-servis kafe
  const [iptalSorulan, setIptalSorulan] = useState<string | null>(null);
  const [odemeSorulan, setOdemeSorulan] = useState<string | null>(null);
  const [gonderilenler, setGonderilenler] = useState<string[]>([]);
  const [adisyonlar, setAdisyonlar] = useState<AcikAdisyon[]>([]);
  const [masalar, setMasalar] = useState<{ id: string; ad: string }[]>([]);
  const [saat, setSaat] = useState("");
  const [uyari, setUyari] = useState<string | null>(null);
  const [mujde, setMujde] = useState<string | null>(null); // yeşil bilgi bandı (puan vb.)
  const [puanKod, setPuanKod] = useState(""); // ödeme onayındaki müşteri kodu
  const [meskul, setMeskul] = useState(false); // para işlemi sürüyor (çift tıklama kilidi)
  const { siparisler, yenile } = useSiparisler(["odeme_bekliyor"], yeniSiparisSesi);

  function hataGoster(metin: string) {
    setUyari(metin);
    setTimeout(() => setUyari(null), 6000);
  }

  function mujdeGoster(metin: string) {
    setMujde(metin);
    setTimeout(() => setMujde(null), 6000);
  }

  // Müşteri koduyla adisyona sadakat puanı işler (çift işleme sunucuda engelli)
  async function puanIsle(adisyonId: string, kod: string) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("sadakat_puan_isle", {
      p_adisyon_id: adisyonId,
      p_musteri_kod: kod.trim(),
    });
    if (error) {
      hataGoster("Puan işlenemedi: " + error.message);
      return;
    }
    const d = data as { musteri_ad: string; kazanilan: number; yeni_bakiye: number };
    mujdeGoster(`⭐ ${d.musteri_ad}: +${d.kazanilan} puan (bakiye ${d.yeni_bakiye})`);
  }

  useEffect(() => {
    const guncelle = () =>
      setSaat(new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }));
    guncelle();
    const z = setInterval(guncelle, 30_000);
    return () => clearInterval(z);
  }, []);

  useEffect(() => {
    if (!kullanici) return;
    const supabase = createClient();
    supabase
      .from("cafe")
      .select("odeme_modu, masa_duzeni")
      .eq("id", kullanici.cafe_id)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setOdemeModu(data.odeme_modu);
        setMasaDuzeni(data.masa_duzeni ?? true);
      });
    supabase
      .from("masa")
      .select("id, ad")
      .eq("cafe_id", kullanici.cafe_id)
      .eq("aktif", true)
      .order("ad")
      .then(({ data }) => setMasalar(data ?? []));
  }, [kullanici]);

  const adisyonYenile = useCallback(async () => {
    if (!kullanici) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("adisyon")
      .select(
        "id, acilis, masa_id, iskonto_tutar, masa(id, ad), siparis(id, durum, siparis_kalemi(id, urun_id, urun_ad, birim_fiyat, adet, secilen_opsiyonlar, opsiyon_ek_fiyat, reddedildi, red_nedeni, ikram, kalem_notu))"
      )
      .eq("durum", "acik")
      .order("acilis");
    setAdisyonlar((data ?? []) as unknown as AcikAdisyon[]);
  }, [kullanici]);

  // Kapatılan hesap arşivi: seçilen günün odendi adisyonları (kalemleriyle)
  const gecmisYukle = useCallback(async () => {
    if (!kullanici) return;
    const supabase = createClient();
    const baslangic = new Date(gecmisTarih + "T00:00:00");
    const bitis = new Date(baslangic.getTime() + 24 * 60 * 60_000);
    const { data, error } = await supabase
      .from("adisyon")
      .select(
        "id, kapanis, odeme_turu, iskonto_tutar, masa(ad), siparis(id, durum, siparis_kalemi(id, urun_id, urun_ad, birim_fiyat, adet, secilen_opsiyonlar, opsiyon_ek_fiyat, reddedildi, red_nedeni, ikram, kalem_notu))"
      )
      .eq("cafe_id", kullanici.cafe_id)
      .eq("durum", "odendi")
      .gte("kapanis", baslangic.toISOString())
      .lt("kapanis", bitis.toISOString())
      .order("kapanis", { ascending: false });
    if (error) return hataGoster("Geçmiş yüklenemedi: " + error.message);
    setGecmisler((data ?? []) as unknown as KapaliAdisyon[]);
  }, [kullanici, gecmisTarih]);

  useEffect(() => {
    if (sekme === "gecmis") gecmisYukle();
  }, [sekme, gecmisYukle]);

  // Kapalı hesabın fişini yazıcıya gönder (tezgah yazıcısından basılır)
  async function gecmisFisYazdir(adisyonId: string) {
    if (!kullanici) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("yazdirma_kuyrugu")
      .insert({ cafe_id: kullanici.cafe_id, adisyon_id: adisyonId });
    if (error) return hataGoster("Fiş gönderilemedi: " + error.message);
    setGecmisFis(adisyonId);
    setTimeout(() => setGecmisFis(null), 3000);
  }

  function kapaliToplam(a: KapaliAdisyon): number {
    const ara = a.siparis
      .filter((s) => !["iptal", "reddedildi"].includes(s.durum))
      .flatMap((s) => s.siparis_kalemi)
      .filter((k) => !k.reddedildi && !k.ikram)
      .reduce((t, k) => t + kalemTutar(k), 0);
    return Math.max(0, ara - Number(a.iskonto_tutar));
  }

  useEffect(() => {
    adisyonYenile();
    const z = setInterval(adisyonYenile, 10_000);
    return () => clearInterval(z);
  }, [adisyonYenile]);

  async function odendi(s: Siparis, odemeTuru: "nakit" | "kart") {
    if (meskul) return;
    setMeskul(true);
    setOdemeSorulan(null);
    const kod = puanKod.trim();
    setPuanKod("");
    setGonderilenler((g) => [...g, s.id]);
    const supabase = createClient();
    try {
      // Sipariş hâlâ ödeme bekliyor mu? (bayat ekran / iptal edilmiş sipariş dirilmesin)
      const { data: guncel, error: okuHata } = await supabase
        .from("siparis").select("durum").eq("id", s.id).single();
      if (okuHata) throw okuHata;
      if (guncel?.durum !== "odeme_bekliyor") {
        hataGoster("Bu siparişin durumu değişmiş — ekran yenilendi.");
        return;
      }
      const { error: sipHata } = await supabase
        .from("siparis").update({ durum: "bekliyor" })
        .eq("id", s.id).eq("durum", "odeme_bekliyor");
      if (sipHata) throw sipHata;

      if (odemeModu === "once_odeme") {
        const { data } = await supabase
          .from("siparis").select("id")
          .eq("adisyon_id", s.adisyon_id).eq("durum", "odeme_bekliyor");
        if (!data?.length) {
          const { data: kapandi, error: kapHata } = await supabase
            .rpc("adisyon_kapat", { p_adisyon_id: s.adisyon_id, p_odeme_turu: odemeTuru });
          if (kapHata) throw kapHata;
          if (kapandi === false) hataGoster("Hesap zaten kapatılmış olabilir.");
        }
      }

      // Müşteri kodu okutulduysa sadakat puanını işle (ödeme akışını bloklamaz)
      if (kod) await puanIsle(s.adisyon_id, kod);
    } catch (e) {
      setGonderilenler((g) => g.filter((id) => id !== s.id));
      hataGoster("İşlem tamamlanamadı: " + (e as { message?: string }).message);
      setMeskul(false);
      yenile();
      adisyonYenile();
      return;
    }
    setTimeout(() => {
      yenile();
      adisyonYenile();
      setGonderilenler((g) => g.filter((id) => id !== s.id));
      setMeskul(false);
    }, 900);
  }

  async function iptalOnayla(s: Siparis) {
    if (meskul) return;
    setMeskul(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("siparis").update({ durum: "iptal" })
      .eq("id", s.id).eq("durum", "odeme_bekliyor");
    setMeskul(false);
    setIptalSorulan(null);
    if (error) hataGoster("İptal edilemedi: " + error.message);
    yenile();
    adisyonYenile();
  }

  if (yukleniyor) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-krem">
        <p className="animate-pulse text-metin-soluk">Yükleniyor…</p>
      </main>
    );
  }

  const sekmeTemel = "rounded-[11px] px-4 py-2 text-sm font-bold";

  return (
    <main className="flex min-h-dvh flex-col bg-krem text-metin" onClick={sesHazirla}>
      {uyari && (
        <div className="anim-fade fixed inset-x-0 top-3 z-50 mx-auto w-fit max-w-[92%] rounded-xl bg-tehlike px-4 py-3 text-center text-sm font-bold text-white shadow-lg">
          {uyari}
        </div>
      )}
      {mujde && !uyari && (
        <div className="anim-fade fixed inset-x-0 top-3 z-50 mx-auto w-fit max-w-[92%] rounded-xl bg-basari px-4 py-3 text-center text-sm font-bold text-white shadow-lg">
          {mujde}
        </div>
      )}
      {/* Üst bar */}
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3.5 border-b border-[#eee2d2] bg-kart px-5 py-3.5">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="SofraKur logosu" className="h-[38px] w-[38px] rounded-[11px]" />
          <div>
            <div className="text-[16.5px] font-extrabold leading-tight">Kasa</div>
            <div className="text-[12.5px] text-metin-soluk">
              {kullanici?.cafe_ad ?? "Kafe"} — {odemeModu === "once_odeme" ? "önce ödeme modu" : "açık hesap modu"}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 rounded-[13px] bg-krem-koyu p-1">
          {(
            [
              ["siparis", "Sipariş", yetkiVar(kullanici, "siparis")],
              ["odeme", `Ödeme Bekleyenler${siparisler.length ? ` (${siparisler.length})` : ""}`, true],
              ["gecmis", "Geçmiş", yetkiVar(kullanici, "gecmis")],
              ["gunsonu", "Gün Sonu", yetkiVar(kullanici, "gunsonu")],
              ["tedarikci", "Tedarikçi", yetkiVar(kullanici, "tedarikci")],
            ] as [Sekme, string, boolean][]
          )
            .filter(([, , izin]) => izin)
            .map(([id, etiket]) => (
              <button
                key={id}
                onClick={() => setSekme(id)}
                className={sekmeTemel + (sekme === id ? " bg-kart text-marka-koyu shadow-sm" : " text-metin-orta")}
              >
                {etiket}
              </button>
            ))}
        </div>
        <span className="flex-1" />
        <div className="flex items-center gap-2.5">
          {kullanici && kullanici.rol !== "kasa" && (
            <a
              href="/admin"
              className="rounded-[10px] border border-cizgi-koyu bg-kart px-3 py-2 text-[13px] font-bold text-metin-orta hover:border-marka"
            >
              Yönetim →
            </a>
          )}
          <span className="text-sm font-bold tabular-nums text-metin-orta">{saat}</span>
          <CikisButonu />
        </div>
      </header>

      <div className="flex-1 px-5 pb-2.5 pt-4">
        {/* ═══ SİPARİŞ (masa haritası + sipariş girme — eski garson ekranı) ═══ */}
        {sekme === "siparis" && kullanici && (
          <SiparisGirisi
            kullanici={kullanici}
            selfServis={!masaDuzeni}
            odemeyeGec={() => setSekme("odeme")}
          />
        )}

        {/* ═══ ÖDEME BEKLEYENLER ═══ */}
        {sekme === "odeme" &&
          (siparisler.length === 0 ? (
            <div className="px-5 py-20 text-center text-metin-silik">
              <div className="mx-auto flex h-[60px] w-[60px] items-center justify-center rounded-full bg-[#f1e7da] text-[26px] text-marka-koyu">
                ✓
              </div>
              <p className="mt-3.5 text-[17px] font-bold text-metin-soluk">Ödeme bekleyen sipariş yok</p>
              <p className="mt-1 text-[13.5px]">Yeni sipariş geldiğinde burada belirir ve sesli uyarı çalar.</p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(295px,1fr))] items-start gap-3.5">
              {siparisler.map((s) => {
                const dk = Math.round((Date.now() - new Date(s.created_at).getTime()) / 60000);
                const gonderildi = gonderilenler.includes(s.id);
                const soruluyor = iptalSorulan === s.id && !gonderildi;
                return (
                  <div
                    key={s.id}
                    className="anim-kart rounded-[18px] border border-[#f0e0c9] bg-kart px-4 py-4 shadow-[0_1px_4px_rgba(90,58,29,0.06)] transition-all duration-500"
                    style={{ opacity: gonderildi ? 0.35 : 1, transform: gonderildi ? "scale(0.97)" : "none" }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[23px] font-extrabold tracking-tight">{siparisKimlik(s)}</span>
                      <span
                        className={
                          "whitespace-nowrap rounded-full px-2.5 py-1 text-[12.5px] font-bold " +
                          (dk >= 8 ? "bg-tehlike-zemin text-tehlike" : "bg-[#f1e7da] text-metin-soluk")
                        }
                      >
                        {dakikaOnce(s.created_at)}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-col gap-[7px]">
                      {s.siparis_kalemi.map((k) => (
                        <div key={k.id} className="flex justify-between gap-2.5 text-sm">
                          <span className="min-w-0">
                            <span className="font-semibold">
                              {k.adet} × {k.urun_ad}
                            </span>
                            {k.secilen_opsiyonlar.length > 0 && (
                              <span className="block text-xs text-metin-soluk">
                                {k.secilen_opsiyonlar.map((o) => o.secim).join(", ")}
                              </span>
                            )}
                            {k.kalem_notu && (
                              <span className="block text-xs italic text-marka-koyu">
                                ✎ {k.kalem_notu}
                              </span>
                            )}
                          </span>
                          <span className="whitespace-nowrap tabular-nums text-metin-orta">{tl(kalemTutar(k))}</span>
                        </div>
                      ))}
                    </div>

                    {s.musteri_notu && (
                      <p className="mt-2.5 rounded-[10px] bg-krem px-3 py-2 text-[13px] italic text-metin-orta">
                        “{s.musteri_notu}”
                      </p>
                    )}

                    <div className="mt-3 flex items-center justify-between gap-2.5 border-t border-dashed border-[#eadcc8] pt-3">
                      <span className="text-[19px] font-extrabold tabular-nums text-metin-baslik">
                        {tl(siparisTutar(s.siparis_kalemi))}
                      </span>
                      {!gonderildi && !soruluyor && odemeSorulan !== s.id && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => setIptalSorulan(s.id)}
                            className="rounded-[10px] px-2.5 py-2.5 text-[13.5px] font-bold text-tehlike-yumusak hover:bg-tehlike-zemin"
                          >
                            İptal
                          </button>
                          <button
                            onClick={() => {
                              setOdemeSorulan(s.id);
                              setIptalSorulan(null);
                            }}
                            className="rounded-xl bg-basari px-5 py-2.5 text-[14.5px] font-extrabold text-white shadow-[0_3px_10px_rgba(47,122,76,0.25)] hover:bg-[#28693f]"
                          >
                            Ödendi ✓
                          </button>
                        </div>
                      )}
                      {!gonderildi && odemeSorulan === s.id && (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <input
                            value={puanKod}
                            onChange={(e) => setPuanKod(e.target.value)}
                            placeholder="⭐ Müşteri kodu"
                            autoCapitalize="characters"
                            className="w-36 rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2 text-center text-[13px] font-bold uppercase tracking-widest outline-none focus:border-marka"
                          />
                          <button
                            onClick={() => { setOdemeSorulan(null); setPuanKod(""); }}
                            className="px-2 py-2 text-[13px] font-bold text-metin-orta"
                          >
                            Vazgeç
                          </button>
                          <button
                            onClick={() => odendi(s, "nakit")}
                            disabled={meskul}
                            className="rounded-xl bg-basari px-4 py-2.5 text-[14px] font-extrabold text-white disabled:opacity-50"
                          >
                            💵 Nakit
                          </button>
                          <button
                            onClick={() => odendi(s, "kart")}
                            disabled={meskul}
                            className="rounded-xl bg-basari px-4 py-2.5 text-[14px] font-extrabold text-white disabled:opacity-50"
                          >
                            💳 Kart
                          </button>
                        </div>
                      )}
                    </div>

                    {soruluyor && (
                      <div className="mt-2.5 flex items-center gap-2.5 rounded-xl bg-tehlike-zemin px-3 py-2.5">
                        <span className="flex-1 text-[13px] font-bold text-tehlike">Sipariş iptal edilsin mi?</span>
                        <button onClick={() => setIptalSorulan(null)} className="px-2 py-1.5 text-[13px] font-bold text-metin-orta">
                          Vazgeç
                        </button>
                        <button
                          onClick={() => iptalOnayla(s)}
                          className="rounded-[9px] bg-tehlike px-3.5 py-2 text-[13px] font-extrabold text-white"
                        >
                          Evet, iptal et
                        </button>
                      </div>
                    )}

                    {gonderildi && (
                      <div className="mt-2.5 rounded-xl bg-basari-zemin px-3 py-2.5 text-center text-[13.5px] font-extrabold text-basari">
                        Mutfağa gönderildi ✓
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

        {/* ═══ GEÇMİŞ: kapatılan hesaplar arşivi ═══ */}
        {sekme === "gecmis" && (
          <div className="mx-auto max-w-[760px]">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="text-base font-extrabold">Kapatılan Hesaplar</h2>
              <input
                type="date"
                value={gecmisTarih}
                onChange={(e) => setGecmisTarih(e.target.value)}
                className="rounded-[10px] border border-cizgi-koyu bg-kart px-3 py-2 text-sm font-bold outline-none"
              />
              <span className="text-[13px] text-metin-soluk">
                {gecmisler.length} hesap ·{" "}
                {tl(gecmisler.reduce((t, a) => t + kapaliToplam(a), 0))}
              </span>
            </div>

            {gecmisler.length === 0 ? (
              <p className="py-8 text-center text-sm text-metin-soluk">
                Bu tarihte kapatılmış hesap yok.
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {gecmisler.map((a) => {
                  const acik = gecmisAcik === a.id;
                  const kalemler = a.siparis
                    .filter((s) => !["iptal", "reddedildi"].includes(s.durum))
                    .flatMap((s) => s.siparis_kalemi.filter((k) => !k.reddedildi));
                  return (
                    <div key={a.id} className="rounded-2xl border border-cizgi bg-kart px-4 py-3">
                      <button
                        onClick={() => setGecmisAcik(acik ? null : a.id)}
                        className="flex w-full items-center gap-3 text-left"
                      >
                        <span className="text-[15px] font-extrabold">{a.masa?.ad ?? "Tezgah"}</span>
                        <span className="text-[12.5px] text-metin-soluk">
                          {new Date(a.kapanis).toLocaleTimeString("tr-TR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span
                          className={
                            "rounded-full px-2.5 py-0.5 text-[11px] font-extrabold " +
                            (a.odeme_turu === "nakit"
                              ? "bg-basari-zemin text-basari"
                              : a.odeme_turu === "kart"
                                ? "bg-[#e9f0f9] text-[#31639c]"
                                : "bg-uyari-zemin text-uyari")
                          }
                        >
                          {a.odeme_turu === "nakit" ? "💵 nakit" : a.odeme_turu === "kart" ? "💳 kart" : "cari"}
                        </span>
                        <span className="flex-1" />
                        <span className="text-[15px] font-extrabold tabular-nums text-metin-baslik">
                          {tl(kapaliToplam(a))}
                        </span>
                        <span className="text-metin-soluk">{acik ? "▴" : "▾"}</span>
                      </button>

                      {acik && (
                        <div className="mt-3 border-t border-dashed border-cizgi-koyu pt-2.5">
                          <div className="flex flex-col gap-1">
                            {kalemler.map((k) => (
                              <div key={k.id} className="flex justify-between gap-2.5 text-[13.5px]">
                                <span className={k.ikram ? "opacity-60" : ""}>
                                  {k.adet} × {k.urun_ad}
                                  {k.ikram && (
                                    <span className="ml-1.5 rounded bg-basari-zemin px-1.5 py-0.5 text-[10px] font-extrabold text-basari">
                                      İKRAM
                                    </span>
                                  )}
                                  {k.secilen_opsiyonlar.length > 0 && (
                                    <span className="block text-[11.5px] text-metin-soluk">
                                      {k.secilen_opsiyonlar.map((o) => o.secim).join(", ")}
                                    </span>
                                  )}
                                </span>
                                <span className={"tabular-nums " + (k.ikram ? "line-through opacity-50" : "text-metin-soluk")}>
                                  {tl(kalemTutar(k))}
                                </span>
                              </div>
                            ))}
                          </div>
                          {Number(a.iskonto_tutar) > 0 && (
                            <div className="mt-1.5 flex justify-between text-[13px] text-uyari">
                              <span>İskonto</span>
                              <span className="tabular-nums">−{tl(Number(a.iskonto_tutar))}</span>
                            </div>
                          )}
                          <button
                            onClick={() => gecmisFisYazdir(a.id)}
                            className={
                              "mt-3 w-full rounded-xl border px-3.5 py-2.5 text-[13.5px] font-extrabold " +
                              (gecmisFis === a.id
                                ? "border-basari bg-basari-zemin text-basari"
                                : "border-cizgi-koyu bg-kart text-metin-orta")
                            }
                          >
                            {gecmisFis === a.id ? "Fiş yazıcıya gönderildi ✓" : "🧾 Hesap Fişini Yazdır"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ GÜN SONU ═══ */}
        {sekme === "gunsonu" && kullanici && <GunSonuBolumu kullanici={kullanici} />}

        {/* ═══ TEDARİKÇİ BELGELERİ ═══ */}
        {sekme === "tedarikci" && kullanici && <TedarikciBolumu kullanici={kullanici} />}
      </div>

      <p className="px-5 pb-5 pt-3.5 text-center text-[12.5px] text-metin-silik">
        Ödemeyi mevcut POS/yazarkasadan alın; &quot;Ödendi&quot; siparişi mutfağa gönderir.
        Masalı hesapları Sipariş sekmesinden masaya dokunarak kapatırsınız.
      </p>
    </main>
  );
}
