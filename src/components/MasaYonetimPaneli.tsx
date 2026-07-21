"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { kalemTutar, tl, type SiparisDurum, type SiparisKalemi } from "@/lib/types";

export interface YonetimAdisyon {
  id: string;
  masa: { id?: string; ad: string } | null; // self-servis (masasız) adisyonda null
  masa_id?: string;
  iskonto_tutar: number;
  siparis: {
    id: string;
    durum: SiparisDurum;
    siparis_kalemi: SiparisKalemi[];
  }[];
}

export interface MasaSecenegi {
  id: string;
  ad: string;
  dolu: boolean;
}

export interface CariOzet {
  id: string;
  ad: string;
  bakiye: number;
}

// Açık bir masanın tam yönetimi: ikram, kalem iptali/transferi,
// iskonto, masa taşıma, POS'la veya cariye kapatma.
export function MasaYonetimPaneli({
  adisyon,
  masalar,
  cariler,
  cafeId,
  kapat,
  degisti,
}: {
  adisyon: YonetimAdisyon;
  masalar: MasaSecenegi[];
  cariler: CariOzet[];
  cafeId: string;
  kapat: () => void;
  degisti: () => void;
}) {
  const [mod, setMod] = useState<
    | { tip: "yok" }
    | { tip: "kalemIptal"; kalemId: string }
    | { tip: "kalemTasi"; kalemId: string }
    | { tip: "iskonto" }
    | { tip: "masaTasi" }
    | { tip: "kapat" }
    | { tip: "cariSec" }
    | { tip: "odul" }
  >({ tip: "yok" });
  const [iskontoDeger, setIskontoDeger] = useState("");
  const [iskontoYuzde, setIskontoYuzde] = useState(false);
  const [yeniCariAd, setYeniCariAd] = useState("");
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [yazdirildi, setYazdirildi] = useState(false);
  const [musteriKod, setMusteriKod] = useState(""); // sadakat: kasada okutulan kod
  const [puanBilgi, setPuanBilgi] = useState<string | null>(null);
  const [oduller, setOduller] = useState<{ id: string; ad: string; puan_bedeli: number }[] | null>(null);

  const supabase = createClient();

  const aktifSiparisler = adisyon.siparis.filter(
    (s) => !["iptal", "reddedildi"].includes(s.durum)
  );
  const kalemler = aktifSiparisler.flatMap((s) =>
    s.siparis_kalemi
      .filter((k) => !k.reddedildi)
      .map((k) => ({ ...k, siparisId: s.id, siparisDurum: s.durum }))
  );
  const araToplam = kalemler.filter((k) => !k.ikram).reduce((t, k) => t + kalemTutar(k), 0);
  const iskonto = Math.min(Number(adisyon.iskonto_tutar), araToplam);
  const toplam = Math.max(0, araToplam - iskonto);
  const ikramToplam = kalemler.filter((k) => k.ikram).reduce((t, k) => t + kalemTutar(k), 0);
  const digerMasalar = masalar.filter((m) => m.id !== (adisyon.masa_id ?? adisyon.masa?.id));

  async function islem(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await fn();
    if (error) {
      setMesaj(error.message);
      setTimeout(() => setMesaj(null), 4000);
    }
    setMod({ tip: "yok" });
    degisti();
  }

  const ikramToggle = (k: SiparisKalemi) =>
    islem(() => supabase.from("siparis_kalemi").update({ ikram: !k.ikram }).eq("id", k.id));

  const kalemIptal = (k: SiparisKalemi & { siparisId: string }) =>
    islem(async () => {
      const sonuc = await supabase
        .from("siparis_kalemi")
        .update({ reddedildi: true, red_nedeni: "Kasa iptali" })
        .eq("id", k.id);
      // siparişte geçerli kalem kalmadıysa siparişi de iptal et
      const kalanlar = kalemler.filter((x) => x.siparisId === k.siparisId && x.id !== k.id);
      if (!kalanlar.length) {
        await supabase.from("siparis").update({ durum: "iptal" }).eq("id", k.siparisId);
      }
      return sonuc;
    });

  const kalemTasi = (kalemId: string, hedefMasaId: string) =>
    islem(() => supabase.rpc("kalem_tasi", { p_kalem_id: kalemId, p_hedef_masa_id: hedefMasaId }));

  const masaTasi = (hedefMasaId: string) =>
    islem(() => supabase.rpc("adisyon_tasi", { p_adisyon_id: adisyon.id, p_hedef_masa_id: hedefMasaId }));

  const iskontoUygula = () => {
    const n = parseFloat(iskontoDeger.replace(",", "."));
    if (isNaN(n) || n < 0) return;
    const tutar = iskontoYuzde ? Math.round(araToplam * Math.min(n, 100)) / 100 : n;
    return islem(() =>
      supabase
        .from("adisyon")
        .update({ iskonto_tutar: Math.round(tutar * 100) / 100 })
        .eq("id", adisyon.id)
    );
  };

  const posKapat = (odemeTuru: "nakit" | "kart") =>
    islem(async () => {
      // Guard'lı RPC: yalnız 'acik' adisyonu kapatır (çift kapanış / bayat ekran ezmesi yok)
      const { data: kapandi, error } = await supabase.rpc("adisyon_kapat", {
        p_adisyon_id: adisyon.id,
        p_odeme_turu: odemeTuru,
      });
      if (!error && kapandi === false) {
        return { error: { message: "Hesap zaten kapatılmış olabilir." } };
      }
      if (!error) kapat();
      return { error };
    });

  const cariyeKapat = (cariId: string) =>
    islem(async () => {
      const sonuc = await supabase.rpc("adisyon_cariye_kapat", {
        p_adisyon_id: adisyon.id,
        p_cari_id: cariId,
      });
      if (!sonuc.error) kapat();
      return sonuc;
    });

  function hataVer(metin: string) {
    setMesaj(metin);
    setTimeout(() => setMesaj(null), 5000);
  }

  // Sadakat: müşteri koduyla bu adisyona puan işler (adisyon başına tek kazanım)
  async function puanIsle() {
    if (!musteriKod.trim()) return;
    const { data, error } = await supabase.rpc("sadakat_puan_isle", {
      p_adisyon_id: adisyon.id,
      p_musteri_kod: musteriKod.trim(),
    });
    if (error) return hataVer("Puan işlenemedi: " + error.message);
    const d = data as { musteri_ad: string; kazanilan: number; yeni_bakiye: number };
    setPuanBilgi(`⭐ ${d.musteri_ad}: +${d.kazanilan} puan (bakiye ${d.yeni_bakiye})`);
    setMusteriKod("");
  }

  async function odulAc() {
    setMod({ tip: "odul" });
    if (oduller === null) {
      const { data } = await supabase
        .from("odul")
        .select("id, ad, puan_bedeli")
        .eq("cafe_id", cafeId)
        .eq("aktif", true)
        .order("sira")
        .order("ad");
      setOduller((data as typeof oduller) ?? []);
    }
  }

  // Ödülü puandan düşer; ürünü kasiyer mevcut İkram akışıyla 0 TL yazar
  async function odulKullan(odulId: string) {
    if (!musteriKod.trim()) return hataVer("Önce müşteri kodunu okut ya da yaz.");
    const { data, error } = await supabase.rpc("odul_kullan", {
      p_musteri_kod: musteriKod.trim(),
      p_odul_id: odulId,
    });
    if (error) return hataVer("Ödül kullanılamadı: " + error.message);
    const d = data as { musteri_ad: string; odul_ad: string; yeni_bakiye: number };
    setPuanBilgi(
      `🎁 ${d.musteri_ad}: "${d.odul_ad}" kullanıldı (kalan ${d.yeni_bakiye} puan) — ürünü listeden İkram olarak işaretle`
    );
    setMusteriKod("");
    setMod({ tip: "yok" });
  }

  // Adisyon fişini kafedeki yazıcı ajanının kuyruğuna bırakır (tezgah yazıcısı basar)
  async function adisyonYazdir() {
    const { error } = await supabase
      .from("yazdirma_kuyrugu")
      .insert({ cafe_id: cafeId, adisyon_id: adisyon.id });
    if (error) {
      setMesaj(error.message);
      setTimeout(() => setMesaj(null), 4000);
      return;
    }
    setYazdirildi(true);
    setTimeout(() => setYazdirildi(false), 3000);
  }

  async function yeniCariAcVeKapat() {
    if (!yeniCariAd.trim()) return;
    const { data, error } = await supabase
      .from("cari")
      .insert({ cafe_id: cafeId, ad: yeniCariAd.trim() })
      .select("id")
      .single();
    if (error || !data) {
      setMesaj(error?.message ?? "Cari açılamadı");
      setTimeout(() => setMesaj(null), 4000);
      return;
    }
    setYeniCariAd("");
    cariyeKapat(data.id);
  }

  const masaSecici = (secim: (masaId: string) => void) => (
    <div className="mt-2 grid grid-cols-3 gap-1.5">
      {digerMasalar.map((m) => (
        <button
          key={m.id}
          onClick={() => secim(m.id)}
          className={
            "rounded-xl border px-2 py-2.5 text-[13px] font-bold " +
            (m.dolu
              ? "border-[#e0cdb2] bg-[#f1e7da] text-metin-baslik"
              : "border-dashed border-[#ddccb4] bg-kart text-metin-orta")
          }
        >
          {m.ad}
          {m.dolu && <span className="block text-[10px] font-semibold opacity-70">dolu · birleşir</span>}
        </button>
      ))}
    </div>
  );

  return (
    <div
      className="anim-fade fixed inset-0 z-30 flex items-end justify-center bg-[rgba(43,28,16,0.45)] sm:items-center"
      onClick={kapat}
    >
      <div
        className="anim-sheet kaydirmasiz max-h-[88dvh] w-full max-w-lg overflow-auto rounded-t-3xl bg-kart px-5 pb-10 pt-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[22px] font-extrabold">{adisyon.masa?.ad ?? "Tezgah"}</span>
          <span className="rounded-full bg-krem-koyu px-3 py-1 text-xs font-extrabold text-metin-orta">
            açık hesap
          </span>
          <span className="flex-1" />
          <button
            onClick={kapat}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-krem-koyu text-[17px] text-marka-koyu"
          >
            ×
          </button>
        </div>

        {mesaj && (
          <p className="mt-3 rounded-xl bg-tehlike-zemin px-3 py-2 text-[13px] font-bold text-tehlike">
            {mesaj}
          </p>
        )}
        {puanBilgi && !mesaj && (
          <p className="mt-3 rounded-xl bg-basari-zemin px-3 py-2 text-[13px] font-bold text-basari">
            {puanBilgi}
          </p>
        )}

        {/* Kalemler */}
        <div className="mt-4 flex flex-col gap-1.5">
          {kalemler.map((k) => (
            <div key={k.id} className="rounded-xl border border-cizgi bg-krem px-3 py-2.5">
              <div className="flex items-center gap-2.5 text-sm">
                <span className={"min-w-0 flex-1 font-semibold " + (k.ikram ? "opacity-70" : "")}>
                  {k.adet} × {k.urun_ad}
                  {k.ikram && (
                    <span className="ml-1.5 rounded bg-basari-zemin px-1.5 py-0.5 text-[10.5px] font-extrabold text-basari">
                      İKRAM
                    </span>
                  )}
                  {k.siparisDurum === "odeme_bekliyor" && (
                    <span className="ml-1.5 rounded bg-uyari-zemin px-1.5 py-0.5 text-[10.5px] font-extrabold text-uyari">
                      onay bekliyor
                    </span>
                  )}
                  {k.secilen_opsiyonlar.length > 0 && (
                    <span className="block text-xs font-normal text-metin-soluk">
                      {k.secilen_opsiyonlar.map((o) => o.secim).join(", ")}
                    </span>
                  )}
                </span>
                <span
                  className={
                    "whitespace-nowrap tabular-nums " +
                    (k.ikram ? "text-metin-silik line-through" : "text-metin-orta")
                  }
                >
                  {tl(kalemTutar(k))}
                </span>
              </div>

              {mod.tip === "kalemIptal" && mod.kalemId === k.id ? (
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-tehlike-zemin px-2.5 py-2">
                  <span className="flex-1 text-xs font-bold text-tehlike">
                    Kalem iptal edilsin mi? (stok iade edilir)
                  </span>
                  <button onClick={() => setMod({ tip: "yok" })} className="px-1 text-xs font-bold text-metin-orta">
                    Vazgeç
                  </button>
                  <button
                    onClick={() => kalemIptal(k)}
                    className="rounded-lg bg-tehlike px-2.5 py-1.5 text-xs font-extrabold text-white"
                  >
                    Evet
                  </button>
                </div>
              ) : mod.tip === "kalemTasi" && mod.kalemId === k.id ? (
                <div className="mt-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-metin-soluk">
                    Hangi masaya?
                    <span className="flex-1" />
                    <button onClick={() => setMod({ tip: "yok" })} className="text-metin-orta">
                      Vazgeç
                    </button>
                  </div>
                  {masaSecici((masaId) => kalemTasi(k.id, masaId))}
                </div>
              ) : (
                <div className="mt-1.5 flex gap-1.5">
                  <button
                    onClick={() => ikramToggle(k)}
                    className={
                      "rounded-lg px-2.5 py-1.5 text-[11.5px] font-extrabold " +
                      (k.ikram
                        ? "bg-basari-zemin text-basari"
                        : "bg-krem-koyu text-metin-orta hover:bg-basari-zemin hover:text-basari")
                    }
                  >
                    {k.ikram ? "İkramı geri al" : "🎁 İkram"}
                  </button>
                  <button
                    onClick={() => setMod({ tip: "kalemTasi", kalemId: k.id })}
                    className="rounded-lg bg-krem-koyu px-2.5 py-1.5 text-[11.5px] font-extrabold text-metin-orta"
                  >
                    ⇄ Taşı
                  </button>
                  <button
                    onClick={() => setMod({ tip: "kalemIptal", kalemId: k.id })}
                    className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-extrabold text-tehlike-yumusak hover:bg-tehlike-zemin"
                  >
                    ✕ İptal
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Toplam */}
        <div className="mt-3.5 rounded-2xl border border-cizgi px-4 py-3 text-sm">
          <div className="flex justify-between text-metin-orta">
            <span>Ara toplam</span>
            <span className="tabular-nums">{tl(araToplam)}</span>
          </div>
          {ikramToplam > 0 && (
            <div className="mt-1 flex justify-between text-basari">
              <span>İkram</span>
              <span className="tabular-nums">{tl(ikramToplam)}</span>
            </div>
          )}
          {iskonto > 0 && (
            <div className="mt-1 flex justify-between text-uyari">
              <span>
                İskonto{" "}
                <button
                  onClick={() =>
                    islem(() =>
                      supabase.from("adisyon").update({ iskonto_tutar: 0 }).eq("id", adisyon.id)
                    )
                  }
                  className="text-[11px] font-bold underline"
                >
                  kaldır
                </button>
              </span>
              <span className="tabular-nums">−{tl(iskonto)}</span>
            </div>
          )}
          <div className="mt-2 flex justify-between border-t border-dashed border-cizgi-koyu pt-2 text-base font-extrabold">
            <span>Toplam</span>
            <span className="tabular-nums text-metin-baslik">{tl(toplam)}</span>
          </div>
        </div>

        {/* Alt aksiyonlar */}
        {mod.tip === "iskonto" ? (
          <div className="mt-3 rounded-2xl border-[1.5px] border-[#e0a95c] p-3.5">
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={iskontoDeger}
                onChange={(e) => setIskontoDeger(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && iskontoUygula()}
                inputMode="decimal"
                placeholder={iskontoYuzde ? "yüzde" : "TL"}
                className="w-24 rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2 text-right text-sm font-bold outline-none"
              />
              <div className="flex rounded-[10px] bg-krem-koyu p-0.5 text-xs font-extrabold">
                <button
                  onClick={() => setIskontoYuzde(false)}
                  className={"rounded-lg px-2.5 py-1.5 " + (!iskontoYuzde ? "bg-kart" : "text-metin-soluk")}
                >
                  TL
                </button>
                <button
                  onClick={() => setIskontoYuzde(true)}
                  className={"rounded-lg px-2.5 py-1.5 " + (iskontoYuzde ? "bg-kart" : "text-metin-soluk")}
                >
                  %
                </button>
              </div>
              <span className="flex-1" />
              <button onClick={() => setMod({ tip: "yok" })} className="px-1.5 text-[13px] font-bold text-metin-soluk">
                Vazgeç
              </button>
              <button
                onClick={iskontoUygula}
                className="rounded-[10px] bg-uyari px-3.5 py-2 text-[13px] font-extrabold text-white"
              >
                Uygula
              </button>
            </div>
          </div>
        ) : mod.tip === "masaTasi" ? (
          <div className="mt-3 rounded-2xl border border-cizgi p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-metin-soluk">
              Hesap hangi masaya taşınsın? (dolu masaya taşınırsa hesaplar birleşir)
              <span className="flex-1" />
              <button onClick={() => setMod({ tip: "yok" })} className="text-metin-orta">
                Vazgeç
              </button>
            </div>
            {masaSecici((masaId) => masaTasi(masaId))}
          </div>
        ) : mod.tip === "cariSec" ? (
          <div className="mt-3 rounded-2xl border border-cizgi p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-metin-soluk">
              {tl(toplam)} hangi cari hesaba yazılsın?
              <span className="flex-1" />
              <button onClick={() => setMod({ tip: "yok" })} className="text-metin-orta">
                Vazgeç
              </button>
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {cariler.map((c) => (
                <button
                  key={c.id}
                  onClick={() => cariyeKapat(c.id)}
                  className="flex items-center justify-between rounded-xl border border-cizgi bg-krem px-3 py-2.5 text-sm font-bold"
                >
                  {c.ad}
                  <span className={"tabular-nums text-[13px] " + (c.bakiye > 0 ? "text-tehlike" : "text-metin-soluk")}>
                    {c.bakiye > 0 ? `borç ${tl(c.bakiye)}` : "borcu yok"}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={yeniCariAd}
                onChange={(e) => setYeniCariAd(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && yeniCariAcVeKapat()}
                placeholder="Yeni cari adı (örn. Ahmet Bey)"
                className="flex-1 rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2 text-sm outline-none"
              />
              <button
                onClick={yeniCariAcVeKapat}
                className="rounded-[10px] bg-basari px-3.5 text-[13px] font-extrabold text-white"
              >
                Aç ve yaz
              </button>
            </div>
          </div>
        ) : mod.tip === "odul" ? (
          <div className="mt-3 rounded-2xl border-[1.5px] border-marka/40 p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-metin-soluk">
              Müşteri kodunu okut, kullanılacak ödüle dokun.
              <span className="flex-1" />
              <button onClick={() => setMod({ tip: "yok" })} className="text-metin-orta">
                Vazgeç
              </button>
            </div>
            <input
              autoFocus
              value={musteriKod}
              onChange={(e) => setMusteriKod(e.target.value)}
              placeholder="⭐ Müşteri kodu"
              autoCapitalize="characters"
              className="mt-2 w-44 rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2 text-center text-sm font-bold uppercase tracking-widest outline-none focus:border-marka"
            />
            <div className="mt-2 flex flex-col gap-1.5">
              {oduller === null && <p className="text-[13px] text-metin-silik">Ödüller yükleniyor…</p>}
              {oduller?.length === 0 && (
                <p className="text-[13px] text-metin-silik">
                  Tanımlı ödül yok — Yönetim → Sadakat&apos;ten eklenir.
                </p>
              )}
              {oduller?.map((o) => (
                <button
                  key={o.id}
                  onClick={() => odulKullan(o.id)}
                  className="flex items-center justify-between rounded-xl border border-cizgi bg-krem px-3 py-2.5 text-sm font-bold"
                >
                  🎁 {o.ad}
                  <span className="tabular-nums text-[13px] text-marka">{o.puan_bedeli} puan</span>
                </button>
              ))}
            </div>
          </div>
        ) : mod.tip === "kapat" ? (
          <div className="mt-3 rounded-2xl border-[1.5px] border-[#9bc4a8] bg-basari-zemin/40 p-3.5">
            <p className="text-[13px] font-bold text-basari">
              {tl(toplam)} nasıl tahsil edildi? Hesap kapanacak.
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <input
                value={musteriKod}
                onChange={(e) => setMusteriKod(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && puanIsle()}
                placeholder="⭐ Müşteri kodu"
                autoCapitalize="characters"
                className="w-36 rounded-[10px] border border-cizgi-koyu bg-kart px-3 py-2 text-center text-[13px] font-bold uppercase tracking-widest outline-none focus:border-marka"
              />
              <button
                onClick={puanIsle}
                disabled={!musteriKod.trim()}
                className="rounded-[10px] border border-cizgi-koyu bg-kart px-3 py-2 text-[13px] font-extrabold text-metin-orta disabled:opacity-40"
              >
                Puan İşle
              </button>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button onClick={() => setMod({ tip: "yok" })} className="px-2.5 text-[13px] font-bold text-metin-orta">
                Vazgeç
              </button>
              <span className="flex-1" />
              <button
                onClick={() => setMod({ tip: "cariSec" })}
                className="rounded-xl border border-cizgi-koyu bg-kart px-3.5 py-2.5 text-[13px] font-extrabold text-metin-orta"
              >
                Cariye yaz
              </button>
              <button
                onClick={() => posKapat("nakit")}
                className="rounded-xl bg-basari px-4 py-2.5 text-[13.5px] font-extrabold text-white"
              >
                💵 Nakit ✓
              </button>
              <button
                onClick={() => posKapat("kart")}
                className="rounded-xl bg-basari px-4 py-2.5 text-[13.5px] font-extrabold text-white"
              >
                💳 Kart ✓
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3.5 flex flex-wrap gap-2">
            <button
              onClick={() => {
                setIskontoDeger("");
                setMod({ tip: "iskonto" });
              }}
              className="rounded-xl border border-cizgi-koyu bg-kart px-3.5 py-3 text-[13.5px] font-bold text-metin-orta"
            >
              % İskonto
            </button>
            <button
              onClick={() => setMod({ tip: "masaTasi" })}
              className="rounded-xl border border-cizgi-koyu bg-kart px-3.5 py-3 text-[13.5px] font-bold text-metin-orta"
            >
              ⇄ Masayı Taşı
            </button>
            <button
              onClick={adisyonYazdir}
              className={
                "rounded-xl border px-3.5 py-3 text-[13.5px] font-bold " +
                (yazdirildi
                  ? "border-basari bg-basari-zemin text-basari"
                  : "border-cizgi-koyu bg-kart text-metin-orta")
              }
            >
              {yazdirildi ? "Gönderildi ✓" : "🧾 Yazdır"}
            </button>
            <button
              onClick={odulAc}
              className="rounded-xl border border-cizgi-koyu bg-kart px-3.5 py-3 text-[13.5px] font-bold text-metin-orta"
            >
              🎁 Ödül
            </button>
            <span className="flex-1" />
            <button
              onClick={() => setMod({ tip: "kapat" })}
              className="rounded-xl bg-basari px-5 py-3 text-[14.5px] font-extrabold text-white shadow-[0_3px_10px_rgba(47,122,76,0.25)]"
            >
              Hesabı Kapat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
