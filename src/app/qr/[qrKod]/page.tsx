"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  tl,
  type Kategori,
  type OpsiyonGrubu,
  type Opsiyon,
  type SecilenOpsiyon,
  type SiparisDurum,
  type Urun,
} from "@/lib/types";

interface Oturum {
  token: string;
  cafe_id: string;
  cafe_ad: string;
  masa_id: string;
  masa_ad: string;
  bitis: number;
}

interface SepetKalemi {
  urun: Urun;
  adet: number;
  opsiyonlar: SecilenOpsiyon[];
  not?: string;
}

interface OturumSiparisKalem {
  ad: string;
  adet: number;
  tutar: number;
  urun_id?: string;
  opsiyonlar?: SecilenOpsiyon[];
  not?: string | null;
}

interface OturumSiparis {
  siparis_id: string;
  durum: SiparisDurum;
  created_at: string;
  kalemler?: OturumSiparisKalem[];
  toplam?: number;
  benim?: boolean;
  siparis_no?: number | null;
}

const ROZET: Record<SiparisDurum, { zemin: string; renk: string; etiket: string }> = {
  odeme_bekliyor: { zemin: "#fbeeda", renk: "#9a5b13", etiket: "Onay bekliyor" },
  bekliyor: { zemin: "#f0ebe4", renk: "#6d5b49", etiket: "Sırada" },
  hazirlaniyor: { zemin: "#e9f0f9", renk: "#31639c", etiket: "Hazırlanıyor" },
  hazir: { zemin: "#e6f3ea", renk: "#2f7a4c", etiket: "Hazır" },
  teslim: { zemin: "#f0ebe4", renk: "#7a6a58", etiket: "Teslim edildi" },
  iptal: { zemin: "#fbe7e4", renk: "#a63b2a", etiket: "İptal" },
  reddedildi: { zemin: "#fbe7e4", renk: "#a63b2a", etiket: "Reddedildi" },
};

function birimFiyat(k: SepetKalemi): number {
  return Number(k.urun.fiyat) + k.opsiyonlar.reduce((t, o) => t + Number(o.ek_fiyat), 0);
}

export default function QrMenuPage() {
  const { qrKod } = useParams<{ qrKod: string }>();
  const [oturum, setOturum] = useState<Oturum | null>(null);
  const [odemeModu, setOdemeModu] = useState<"once_odeme" | "acik_hesap">("once_odeme");
  const [hata, setHata] = useState<string | null>(null);
  const [menu, setMenu] = useState<Kategori[]>([]);
  const [aktifKat, setAktifKat] = useState("Tümü");
  const [sepet, setSepet] = useState<SepetKalemi[]>([]);
  const [seciliUrun, setSeciliUrun] = useState<Urun | null>(null);
  const [gorunum, setGorunum] = useState<"menu" | "sepet" | "durum">("menu");
  const [not, setNot] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [siparisler, setSiparisler] = useState<OturumSiparis[]>([]);
  const [cagriMesaji, setCagriMesaji] = useState<string | null>(null);
  const [iptalSorulan, setIptalSorulan] = useState<string | null>(null);
  const oturumRef = useRef<Oturum | null>(null);
  oturumRef.current = oturum;

  const oturumAc = useCallback(async (): Promise<Oturum | null> => {
    const supabase = createClient();
    const anahtar = `sofrakur-oturum-${qrKod}`;
    const kayitli = typeof window !== "undefined" ? localStorage.getItem(anahtar) : null;
    if (kayitli) {
      const o = JSON.parse(kayitli) as Oturum;
      if (o.bitis > Date.now() + 5 * 60_000) {
        setOturum(o);
        return o;
      }
    }
    const { data, error } = await supabase.rpc("masa_oturumu_ac", { p_qr_kod: qrKod });
    if (error || !data?.[0]) {
      setHata("Bu QR kodu geçerli değil. Lütfen garsona haber verin.");
      return null;
    }
    const yeni: Oturum = {
      token: data[0].oturum_token,
      cafe_id: data[0].cafe_id,
      cafe_ad: data[0].cafe_ad,
      masa_id: data[0].masa_id,
      masa_ad: data[0].masa_ad,
      bitis: Date.now() + 3 * 60 * 60_000,
    };
    localStorage.setItem(anahtar, JSON.stringify(yeni));
    setOturum(yeni);
    return yeni;
  }, [qrKod]);

  useEffect(() => {
    (async () => {
      const o = await oturumAc();
      if (!o) return;
      const supabase = createClient();
      const [{ data, error }, { data: cafe }] = await Promise.all([
        supabase
          .from("kategori")
          .select(
            "id, ad, sira, aktif, urun(id, ad, aciklama, fiyat, gorsel_url, aktif, sira, kampanya, " +
              "opsiyon_grubu(id, ad, min_secim, max_secim, sira, opsiyon(id, ad, ek_fiyat, aktif, sira)))"
          )
          .eq("cafe_id", o.cafe_id)
          .order("sira"),
        supabase.from("cafe").select("odeme_modu").eq("id", o.cafe_id).single(),
      ]);
      if (cafe) setOdemeModu(cafe.odeme_modu);
      if (error) {
        setHata("Menü yüklenemedi. Lütfen sayfayı yenileyin.");
        return;
      }
      // Personel girişli tarayıcıda da müşteri ne görüyorsa o görünsün:
      // pasif ürün/kategori istemci tarafında da elenir (anonim için RLS zaten eler)
      const kategoriler = ((data ?? []) as unknown as Kategori[])
        .filter((k) => k.aktif)
        .map((k) => ({
          ...k,
          urun: [...k.urun]
            .filter((u) => u.aktif)
            .sort((a, b) => a.sira - b.sira)
            .map((u) => ({
              ...u,
              // Seçeneği kalmayan grupları ele: zorunlu ama boş grup ürünü
              // sipariş edilemez hale getirirdi (Sepete Ekle kilitli kalırdı)
              opsiyon_grubu: [...u.opsiyon_grubu]
                .filter((g) => g.opsiyon.some((o) => o.aktif))
                .sort((a, b) => a.sira - b.sira)
                .map((g) => ({
                  ...g,
                  opsiyon: [...g.opsiyon].filter((o) => o.aktif).sort((a, b) => a.sira - b.sira),
                })),
            })),
        }))
        .filter((k) => k.urun.length > 0);
      setMenu(kategoriler);
    })();
  }, [oturumAc]);

  // Siparişler açıkken 5 sn'de bir durum sorgula
  useEffect(() => {
    if (gorunum !== "durum" || !oturum) return;
    siparisSorgula();
    const z = setInterval(siparisSorgula, 5_000);
    return () => clearInterval(z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gorunum, oturum]);

  function sepeteEkle(urun: Urun, adet: number, opsiyonlar: SecilenOpsiyon[], urunNotu?: string) {
    setSepet((s) => [...s, { urun, adet, opsiyonlar, not: urunNotu?.trim() || undefined }]);
    setSeciliUrun(null);
  }

  async function siparisVer() {
    if (!sepet.length || gonderiliyor) return;
    setGonderiliyor(true);
    const supabase = createClient();
    const kalemler = sepet.map((k) => ({
      urun_id: k.urun.id,
      adet: k.adet,
      opsiyonlar: k.opsiyonlar,
      not: k.not ?? null,
    }));

    async function dene(token: string) {
      return supabase.rpc("siparis_olustur", {
        p_token: token,
        p_kalemler: kalemler,
        p_musteri_notu: not.trim() || null,
      });
    }

    let sonuc = await dene(oturum!.token);
    if (sonuc.error && sonuc.error.message.includes("Oturum")) {
      localStorage.removeItem(`sofrakur-oturum-${qrKod}`);
      const yeni = await oturumAc();
      if (yeni) sonuc = await dene(yeni.token);
    }
    setGonderiliyor(false);
    if (sonuc.error) {
      alert(sonuc.error.message);
      return;
    }
    setSepet([]);
    setNot("");
    setGorunum("durum");
  }

  async function siparisSorgula() {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("oturum_siparisleri", {
      p_token: oturumRef.current?.token,
    });
    if (error) {
      // masa sıfırlanmış / süre dolmuş: sessizce taze oturum aç, güncel durumu göster
      if (error.message.includes("Oturum")) {
        localStorage.removeItem(`sofrakur-oturum-${qrKod}`);
        const yeni = await oturumAc();
        if (yeni) {
          const tekrar = await supabase.rpc("oturum_siparisleri", { p_token: yeni.token });
          if (tekrar.data) setSiparisler(tekrar.data as OturumSiparis[]);
        }
      }
      return;
    }
    if (data) setSiparisler(data as OturumSiparis[]);
  }

  // Ödeme onayı öncesi iptal; duzenle=true ise kalemler sepete geri yüklenir
  async function siparisIptal(s: OturumSiparis, duzenle: boolean) {
    if (gonderiliyor) return; // çift tıklama / çift kopyalama koruması
    setGonderiliyor(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("oturum_siparis_iptal", {
      p_token: oturum!.token,
      p_siparis_id: s.siparis_id,
    });
    setGonderiliyor(false);
    setIptalSorulan(null);
    if (error) {
      alert(error.message);
      siparisSorgula();
      return;
    }
    if (duzenle && s.kalemler) {
      const tumUrunler = menu.flatMap((k) => k.urun);
      const yeniSepet: SepetKalemi[] = [];
      let atlanan = 0;
      for (const kalem of s.kalemler) {
        const urun = tumUrunler.find((u) => u.id === kalem.urun_id);
        if (urun) {
          yeniSepet.push({
            urun,
            adet: kalem.adet,
            opsiyonlar: kalem.opsiyonlar ?? [],
            not: kalem.not ?? undefined,
          });
        } else {
          atlanan++;
        }
      }
      setSepet((mevcut) => [...mevcut, ...yeniSepet]);
      if (atlanan > 0) alert("Bazı ürünler artık menüde olmadığı için sepete eklenemedi.");
      setGorunum("sepet");
    } else {
      siparisSorgula();
    }
  }

  async function garsonCagir(tur: "garson" | "hesap") {
    const supabase = createClient();
    let sonuc = await supabase.rpc("garson_cagir", { p_token: oturum!.token, p_tur: tur });
    if (sonuc.error && sonuc.error.message.includes("Oturum")) {
      localStorage.removeItem(`sofrakur-oturum-${qrKod}`);
      const yeni = await oturumAc();
      if (yeni) sonuc = await supabase.rpc("garson_cagir", { p_token: yeni.token, p_tur: tur });
    }
    setCagriMesaji(
      sonuc.error
        ? "Çağrı gönderilemedi — lütfen tekrar deneyin."
        : tur === "garson"
          ? "Garson çağrıldı ✓"
          : "Hesap istendi ✓"
    );
    setTimeout(() => setCagriMesaji(null), 4000);
  }

  const sepetToplam = sepet.reduce((t, k) => t + birimFiyat(k) * k.adet, 0);
  const sepetAdet = sepet.reduce((t, k) => t + k.adet, 0);

  if (hata) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-krem p-8 text-center">
        <p className="text-lg text-metin-orta">{hata}</p>
      </main>
    );
  }
  if (!oturum) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-krem p-8">
        <p className="animate-pulse text-lg text-metin-soluk">Menü açılıyor…</p>
      </main>
    );
  }

  const tabTemel =
    "w-full whitespace-nowrap rounded-[11px] px-1 py-2 text-[12.5px] font-bold transition-all";

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-krem text-metin">
      {/* Başlık */}
      <header className="marka-gradyan flex-shrink-0 px-5 pb-3.5 pt-5 text-white">
        <div className="flex items-center gap-2.5">
          <span className="font-serif text-[25px] font-bold tracking-wide">
            {oturum.cafe_ad}
          </span>
          <span className="flex-1" />
          <button
            onClick={() => garsonCagir("garson")}
            title="Garson çağır"
            className="rounded-full border border-white/30 bg-white/15 px-3 py-1 text-sm"
          >
            🔔
          </button>
          <span className="rounded-full border border-white/30 bg-white/15 px-3.5 py-1 text-sm font-semibold">
            {oturum.masa_ad}
          </span>
        </div>
        <div className="mt-0.5 text-xs tracking-wide opacity-80">
          SofraKur ile temassız sipariş
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1 rounded-[14px] bg-[rgba(60,30,8,0.28)] p-1">
          {(
            [
              ["menu", "Menü"],
              ["sepet", sepetAdet ? `Sepet (${sepetAdet})` : "Sepet"],
              ["durum", siparisler.length ? `Siparişler (${siparisler.length})` : "Siparişler"],
            ] as ["menu" | "sepet" | "durum", string][]
          ).map(([gor, etiket]) => (
            <button
              key={gor}
              onClick={() => setGorunum(gor)}
              className={
                tabTemel +
                (gorunum === gor ? " bg-white text-marka-koyu shadow" : " text-white/85")
              }
            >
              {etiket}
            </button>
          ))}
        </div>
      </header>

      <div className="kaydirmasiz flex-1 overflow-auto">
        {/* ═══ MENÜ ═══ */}
        {gorunum === "menu" && (
          <div>
            <div className="kaydirmasiz sticky top-0 z-10 flex gap-2 overflow-x-auto bg-krem/95 px-4 pb-2.5 pt-3 backdrop-blur">
              {["Tümü", ...menu.map((k) => k.ad)].map((ad) => (
                <button
                  key={ad}
                  onClick={() => setAktifKat(ad)}
                  className={
                    "flex-shrink-0 rounded-full px-4 py-2 text-[13px] font-bold " +
                    (ad === aktifKat
                      ? "marka-gradyan border border-transparent text-white"
                      : "border border-cizgi-koyu bg-kart text-metin-orta")
                  }
                >
                  {ad}
                </button>
              ))}
            </div>

            {/* Kampanya vitrini */}
            {aktifKat === "Tümü" &&
              (() => {
                const kampanyalar = menu.flatMap((k) => k.urun).filter((u) => u.kampanya);
                if (!kampanyalar.length) return null;
                return (
                  <div className="px-4 pt-1">
                    <h2 className="mb-2 font-serif text-[19px] font-semibold text-metin-baslik">
                      🎉 Kampanyalar
                    </h2>
                    <div className="kaydirmasiz -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
                      {kampanyalar.map((u) => (
                        <button
                          key={u.id}
                          onClick={() => setSeciliUrun(u)}
                          className="anim-kart w-[210px] flex-shrink-0 overflow-hidden rounded-2xl border border-[#e8b57f] bg-kart text-left shadow-[0_2px_8px_rgba(138,75,31,0.12)]"
                        >
                          {u.gorsel_url ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={u.gorsel_url}
                              alt={u.ad}
                              className="h-[110px] w-full object-cover"
                            />
                          ) : (
                            <div className="marka-gradyan flex h-[110px] w-full items-center justify-center text-4xl">
                              🎉
                            </div>
                          )}
                          <span className="block px-3 py-2.5">
                            <span className="block text-[14px] font-bold leading-snug">{u.ad}</span>
                            <span className="mt-1 block text-sm font-extrabold text-marka-koyu">
                              {tl(Number(u.fiyat))}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

            <div className="flex flex-col gap-5 px-4 pb-32 pt-0.5">
              {menu
                .filter((k) => aktifKat === "Tümü" || k.ad === aktifKat)
                .map((kat) => (
                  <section key={kat.id}>
                    <h2 className="mb-2.5 mt-1.5 font-serif text-[19px] font-semibold text-metin-baslik">
                      {kat.ad}
                    </h2>
                    <div className="flex flex-col gap-2.5">
                      {kat.urun.map((u) => (
                        <button
                          key={u.id}
                          onClick={() => setSeciliUrun(u)}
                          className="anim-kart flex items-center gap-3 rounded-2xl border border-cizgi bg-kart p-2.5 text-left shadow-[0_1px_3px_rgba(90,58,29,0.05)]"
                        >
                          {u.gorsel_url ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={u.gorsel_url}
                              alt={u.ad}
                              className="h-14 w-14 flex-shrink-0 rounded-xl object-cover"
                            />
                          ) : (
                            <span
                              aria-hidden
                              className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-krem-koyu text-[22px] opacity-60"
                            >
                              🍽️
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            {/* içerik listede gösterilmez; ürüne dokununca detayda görünür */}
                            <span className="block text-[15px] font-bold">{u.ad}</span>
                            <span className="mt-1 block text-sm font-extrabold text-marka-koyu">
                              {tl(Number(u.fiyat))}
                            </span>
                          </span>
                          <span className="marka-gradyan flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full text-xl font-semibold text-white shadow-[0_2px_6px_rgba(138,75,31,0.35)]">
                            +
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
            </div>
          </div>
        )}

        {/* ═══ SEPET ═══ */}
        {gorunum === "sepet" && (
          <div className="px-4 pb-32 pt-4">
            <h2 className="mb-3 mt-1 font-serif text-[21px] font-semibold text-metin-baslik">
              Sepetiniz
            </h2>

            {sepet.length === 0 ? (
              <div className="px-5 py-12 text-center text-metin-soluk">
                <p className="text-[15px] font-semibold">Sepetiniz boş</p>
                <button
                  onClick={() => setGorunum("menu")}
                  className="marka-gradyan mt-3.5 rounded-full px-5 py-2.5 text-sm font-bold text-white"
                >
                  Menüye dön
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2.5">
                  {sepet.map((k, i) => (
                    <div key={i} className="rounded-2xl border border-cizgi bg-kart px-3.5 py-3">
                      <div className="flex items-start gap-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-bold">{k.urun.ad}</span>
                          {k.opsiyonlar.length > 0 && (
                            <span className="mt-0.5 block text-[12.5px] text-metin-soluk">
                              {k.opsiyonlar.map((o) => o.secim).join(", ")}
                            </span>
                          )}
                          {k.not && (
                            <span className="mt-0.5 block text-[12.5px] italic text-marka-koyu">
                              ✎ {k.not}
                            </span>
                          )}
                        </span>
                        <span className="whitespace-nowrap text-sm font-extrabold text-marka-koyu">
                          {tl(birimFiyat(k) * k.adet)}
                        </span>
                      </div>
                      <div className="mt-2.5 flex items-center gap-2.5">
                        <div className="flex items-center rounded-full border border-cizgi-koyu bg-krem">
                          <button
                            onClick={() =>
                              setSepet((s) =>
                                s.map((x, j) =>
                                  j === i ? { ...x, adet: Math.max(1, x.adet - 1) } : x
                                )
                              )
                            }
                            className="h-8 w-[34px] text-lg text-marka-koyu"
                          >
                            −
                          </button>
                          <span className="min-w-[18px] text-center text-sm font-bold">
                            {k.adet}
                          </span>
                          <button
                            onClick={() =>
                              setSepet((s) =>
                                s.map((x, j) => (j === i ? { ...x, adet: x.adet + 1 } : x))
                              )
                            }
                            className="h-8 w-[34px] text-lg text-marka-koyu"
                          >
                            +
                          </button>
                        </div>
                        <span className="flex-1" />
                        <button
                          onClick={() => setSepet((s) => s.filter((_, j) => j !== i))}
                          className="px-2 py-1.5 text-[13px] font-semibold text-tehlike-yumusak"
                        >
                          Kaldır
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <textarea
                  value={not}
                  onChange={(e) => setNot(e.target.value)}
                  placeholder="Sipariş notu (isteğe bağlı)"
                  rows={2}
                  className="mt-3.5 w-full resize-none rounded-[14px] border border-cizgi-koyu bg-kart px-3.5 py-3 text-base outline-none"
                />

                <div className="mt-3.5 flex items-center justify-between rounded-2xl border border-cizgi bg-kart px-4 py-3.5">
                  <span className="text-sm font-semibold text-metin-soluk">Toplam</span>
                  <span className="text-[19px] font-extrabold text-metin-baslik">
                    {tl(sepetToplam)}
                  </span>
                </div>

                <button
                  onClick={siparisVer}
                  disabled={gonderiliyor}
                  className="marka-gradyan mt-3.5 w-full rounded-[18px] p-4 text-[16.5px] font-extrabold text-white shadow-[0_6px_18px_rgba(138,75,31,0.3)] disabled:opacity-50"
                >
                  {gonderiliyor ? "Gönderiliyor…" : `Sipariş Ver · ${tl(sepetToplam)}`}
                </button>
                <p className="mt-3 px-1 text-center text-[12.5px] leading-relaxed text-metin-soluk">
                  {odemeModu === "once_odeme"
                    ? "Siparişiniz, kasada ödemenizi yaptıktan sonra hazırlanmaya başlar."
                    : "Siparişiniz doğrudan mutfağa iletilir; hesabınızı kasada kapatabilirsiniz."}
                </p>
              </>
            )}
          </div>
        )}

        {/* ═══ SİPARİŞLERİM ═══ */}
        {gorunum === "durum" && (
          <div className="px-4 pb-32 pt-4">
            <div className="mb-3 mt-1 flex items-center gap-2">
              <h2 className="font-serif text-[21px] font-semibold text-metin-baslik">
                Siparişlerim
              </h2>
              <span className="flex-1" />
              {odemeModu === "acik_hesap" && siparisler.length > 0 && (
                <button
                  onClick={() => garsonCagir("hesap")}
                  className="rounded-full border border-cizgi-koyu bg-kart px-3.5 py-1.5 text-[13px] font-bold text-metin-baslik"
                >
                  Hesap iste
                </button>
              )}
            </div>
            {siparisler.length === 0 ? (
              <div>
                <p className="text-sm text-metin-soluk">
                  Bu masada henüz mutfağa gönderilmiş sipariş yok.
                </p>
                {sepet.length > 0 && (
                  <button
                    onClick={() => setGorunum("sepet")}
                    className="marka-gradyan mt-3.5 w-full rounded-xl p-3.5 text-[14.5px] font-extrabold text-white"
                  >
                    Sepetinde {sepetAdet} ürün var — siparişi tamamla →
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {siparisler.map((s) => {
                  const rozet = ROZET[s.durum];
                  return (
                    <div
                      key={s.siparis_id}
                      className="anim-kart rounded-[18px] border border-cizgi bg-kart px-4 py-3.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-semibold text-metin-soluk">
                          {s.siparis_no != null && (
                            <strong className="mr-1.5 text-metin-baslik">#{s.siparis_no}</strong>
                          )}
                          {new Date(s.created_at).toLocaleTimeString("tr-TR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span
                          className="rounded-full px-3 py-1 text-[12.5px] font-bold"
                          style={{ background: rozet.zemin, color: rozet.renk }}
                        >
                          {rozet.etiket}
                        </span>
                      </div>

                      {s.kalemler && s.kalemler.length > 0 && (
                        <>
                          <div className="mt-2.5 flex flex-col gap-1.5">
                            {s.kalemler.map((k, i) => (
                              <div key={i} className="flex justify-between text-sm">
                                <span>
                                  {k.adet} × {k.ad}
                                </span>
                                <span className="text-metin-soluk">{tl(k.tutar)}</span>
                              </div>
                            ))}
                          </div>
                          <div className="mt-2.5 flex justify-between border-t border-dashed border-cizgi-koyu pt-2.5 text-[14.5px] font-extrabold">
                            <span>Toplam</span>
                            <span className="text-metin-baslik">{tl(s.toplam ?? 0)}</span>
                          </div>
                        </>
                      )}

                      {s.durum === "odeme_bekliyor" && (
                        <>
                          <p className="mt-2.5 rounded-[10px] bg-uyari-zemin px-3 py-2 text-[12.5px] leading-relaxed text-uyari">
                            Siparişiniz garsona iletildi; onaylanınca hazırlanmaya başlar.
                            Önden ödemek isterseniz kasaya <strong>&quot;{oturum.masa_ad}&quot;</strong>{" "}
                            diyebilirsiniz.
                          </p>
                          {s.benim === false ? null : iptalSorulan === s.siparis_id ? (
                            <div className="mt-2.5 flex items-center gap-2.5 rounded-xl bg-tehlike-zemin px-3 py-2.5">
                              <span className="flex-1 text-[12.5px] font-bold text-tehlike">
                                Sipariş iptal edilsin mi?
                              </span>
                              <button
                                onClick={() => setIptalSorulan(null)}
                                className="px-1.5 py-1 text-[12.5px] font-bold text-metin-orta"
                              >
                                Vazgeç
                              </button>
                              <button
                                onClick={() => siparisIptal(s, false)}
                                className="rounded-lg bg-tehlike px-3 py-1.5 text-[12.5px] font-extrabold text-white"
                              >
                                Evet, iptal et
                              </button>
                            </div>
                          ) : (
                            <div className="mt-2.5 flex gap-2">
                              <button
                                onClick={() => siparisIptal(s, true)}
                                className="flex-1 rounded-xl border border-cizgi-koyu bg-krem px-3 py-2.5 text-[13.5px] font-bold text-metin-baslik"
                              >
                                ✏️ Düzenle
                              </button>
                              <button
                                onClick={() => setIptalSorulan(s.siparis_id)}
                                className="rounded-xl px-3 py-2.5 text-[13.5px] font-bold text-tehlike-yumusak"
                              >
                                İptal et
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Çağrı bildirimi */}
      {cagriMesaji && (
        <div className="anim-fade fixed inset-x-0 top-4 z-40 mx-auto w-fit rounded-full bg-basari px-5 py-2.5 text-sm font-extrabold text-white shadow-lg">
          {cagriMesaji}
        </div>
      )}

      {/* Sepet çubuğu */}
      {gorunum === "menu" && sepet.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg bg-gradient-to-t from-krem from-55% to-transparent px-4 pb-6 pt-3">
          <button
            onClick={() => setGorunum("sepet")}
            className="marka-gradyan flex w-full items-center justify-between rounded-[18px] px-4.5 py-4 text-white shadow-[0_6px_18px_rgba(138,75,31,0.32)]"
          >
            <span className="text-[15px] font-bold">Sepeti gör · {sepetAdet} ürün</span>
            <span className="text-base font-extrabold">{tl(sepetToplam)}</span>
          </button>
        </div>
      )}

      {/* Ürün detay sayfası */}
      {seciliUrun && (
        <UrunDetay urun={seciliUrun} kapat={() => setSeciliUrun(null)} ekle={sepeteEkle} />
      )}
    </main>
  );
}

// Tam sayfa ürün detayı: fotoğraf, içerik, opsiyonlar, ürün notu, sepete ekle
function UrunDetay({
  urun,
  kapat,
  ekle,
}: {
  urun: Urun;
  kapat: () => void;
  ekle: (u: Urun, adet: number, o: SecilenOpsiyon[], not?: string) => void;
}) {
  const [secimler, setSecimler] = useState<Record<string, Opsiyon[]>>(() =>
    Object.fromEntries(
      urun.opsiyon_grubu.map((g) => [g.id, g.min_secim >= 1 && g.opsiyon[0] ? [g.opsiyon[0]] : []])
    )
  );
  const [adet, setAdet] = useState(1);
  const [urunNotu, setUrunNotu] = useState("");

  function sec(grup: OpsiyonGrubu, o: Opsiyon) {
    setSecimler((s) => {
      const mevcut = s[grup.id] ?? [];
      if (grup.max_secim === 1) return { ...s, [grup.id]: [o] };
      const varMi = mevcut.some((x) => x.id === o.id);
      if (varMi) return { ...s, [grup.id]: mevcut.filter((x) => x.id !== o.id) };
      if (mevcut.length >= grup.max_secim) return s;
      return { ...s, [grup.id]: [...mevcut, o] };
    });
  }

  const eksikGrup = urun.opsiyon_grubu.find((g) => (secimler[g.id]?.length ?? 0) < g.min_secim);
  const ekToplam = Object.values(secimler)
    .flat()
    .reduce((t, o) => t + Number(o.ek_fiyat), 0);
  const tutar = (Number(urun.fiyat) + ekToplam) * adet;

  return (
    <div className="anim-fade fixed inset-0 z-40 mx-auto flex max-w-lg flex-col bg-krem">
      {/* Üst: fotoğraf ya da başlık bandı */}
      <div className="kaydirmasiz flex-1 overflow-auto pb-36">
        <div className="relative">
          {urun.gorsel_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={urun.gorsel_url} alt={urun.ad} className="h-64 w-full object-cover" />
          ) : (
            <div className="marka-gradyan flex h-36 w-full items-end px-5 pb-4">
              <span className="font-serif text-2xl font-bold text-white">{urun.ad}</span>
            </div>
          )}
          <button
            onClick={kapat}
            aria-label="Menüye dön"
            className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-xl text-marka-koyu shadow-[0_2px_10px_rgba(43,28,16,0.25)]"
          >
            ←
          </button>
        </div>

        <div className="px-5 pt-4">
          {urun.kampanya && (
            <span className="mb-1.5 inline-block rounded-full bg-uyari-zemin px-2.5 py-1 text-[11.5px] font-extrabold text-uyari">
              🎉 KAMPANYA
            </span>
          )}
          {urun.gorsel_url && (
            <h1 className="font-serif text-[23px] font-semibold text-[#3d2814]">{urun.ad}</h1>
          )}
          <div className="mt-1 text-lg font-extrabold text-marka-koyu">
            {tl(Number(urun.fiyat))}
          </div>
          {urun.aciklama && (
            <p className="mt-2 text-[14px] leading-relaxed text-metin-orta">{urun.aciklama}</p>
          )}
        </div>

        <div className="px-5">
          {urun.opsiyon_grubu.map((g) => (
          <fieldset key={g.id} className="mt-4.5">
            <legend className="text-sm font-extrabold text-metin-baslik">
              {g.min_secim >= 1 ? `${g.ad} (zorunlu)` : g.ad}
            </legend>
            <div className="mt-2 flex flex-col gap-[7px]">
              {g.opsiyon.map((o) => {
                const secili = (secimler[g.id] ?? []).some((x) => x.id === o.id);
                return (
                  <button
                    key={o.id}
                    onClick={() => sec(g, o)}
                    className={
                      "flex items-center justify-between rounded-[13px] px-3.5 py-3 text-left " +
                      (secili
                        ? "border-[1.5px] border-marka bg-[#fdf5ec]"
                        : "border border-[#ece1d1] bg-kart")
                    }
                  >
                    <span className="flex items-center gap-2.5">
                      <span
                        className="box-border h-[18px] w-[18px] flex-shrink-0 rounded-full bg-white"
                        style={{
                          border: secili ? "5.5px solid #c86f2c" : "2px solid #d8c9b4",
                        }}
                      />
                      <span className="text-[14.5px] font-semibold">{o.ad}</span>
                    </span>
                    {Number(o.ek_fiyat) > 0 && (
                      <span className="text-[13px] font-semibold text-metin-soluk">
                        +{tl(Number(o.ek_fiyat))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

          {/* Ürüne özel not */}
          <label className="mt-5 block">
            <span className="text-sm font-extrabold text-metin-baslik">
              Ürün notu <span className="font-semibold text-metin-soluk">(isteğe bağlı)</span>
            </span>
            <textarea
              value={urunNotu}
              onChange={(e) => setUrunNotu(e.target.value)}
              placeholder="Örn. az şekerli olsun, soğuk süt…"
              rows={2}
              className="mt-2 w-full resize-none rounded-[14px] border border-cizgi-koyu bg-kart px-3.5 py-3 text-base outline-none"
            />
          </label>
        </div>
      </div>

      {/* Alt sabit çubuk: adet + sepete ekle */}
      <div className="absolute inset-x-0 bottom-0 border-t border-cizgi bg-kart px-5 pb-7 pt-3.5 shadow-[0_-6px_18px_rgba(90,58,29,0.1)]">
        {eksikGrup && (
          <p className="mb-2 text-center text-xs font-semibold text-tehlike-yumusak">
            &quot;{eksikGrup.ad}&quot; seçimi zorunlu.
          </p>
        )}
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-full border border-cizgi-koyu bg-krem">
            <button
              onClick={() => setAdet((a) => Math.max(1, a - 1))}
              className="h-[46px] w-11 text-xl text-marka-koyu"
            >
              −
            </button>
            <span className="min-w-5 text-center text-[15px] font-extrabold">{adet}</span>
            <button
              onClick={() => setAdet((a) => a + 1)}
              className="h-[46px] w-11 text-xl text-marka-koyu"
            >
              +
            </button>
          </div>
          <button
            onClick={() =>
              !eksikGrup &&
              ekle(
                urun,
                adet,
                urun.opsiyon_grubu.flatMap((g) =>
                  (secimler[g.id] ?? []).map((o) => ({
                    grup: g.ad,
                    secim: o.ad,
                    ek_fiyat: Number(o.ek_fiyat),
                  }))
                ),
                urunNotu
              )
            }
            className={
              "marka-gradyan flex-1 rounded-2xl px-4 py-3.5 text-[15.5px] font-extrabold text-white " +
              (eksikGrup
                ? "cursor-default opacity-45"
                : "shadow-[0_4px_14px_rgba(138,75,31,0.3)]")
            }
          >
            Sepete Ekle · {tl(tutar)}
          </button>
        </div>
      </div>
    </div>
  );
}
