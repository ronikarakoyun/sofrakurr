"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { sesHazirla, yeniSiparisSesi } from "@/lib/beep";
import { KaydirilabilirKart } from "@/components/KaydirilabilirKart";
import { useKlavyeYuksekligi } from "@/lib/useKlavye";
import { kalemTutar, tl, type Kullanici, type SecilenOpsiyon, type SiparisDurum } from "@/lib/types";

interface Bolum {
  id: string;
  ad: string;
}

interface MasaRow {
  id: string;
  ad: string;
  bolum_id: string | null;
  aktif: boolean;
}

interface KalemRow {
  id: string;
  urun_ad: string;
  birim_fiyat: number;
  adet: number;
  opsiyon_ek_fiyat: number;
  secilen_opsiyonlar: { secim: string }[];
  reddedildi: boolean;
  odul_karsiligi?: boolean; // ödül karşılığı bedava (ciro dışı)
  kalem_notu?: string | null;
}

interface SiparisRow {
  id: string;
  durum: SiparisDurum;
  masa_id: string | null;
  siparis_no: number | null;
  siparis_kalemi: KalemRow[];
}

interface AdisyonRow {
  id: string;
  masa_id: string;
  siparis: SiparisRow[];
}

interface CagriRow {
  id: string;
  masa_id: string;
  tur: "garson" | "hesap";
}

interface MenuOpsiyon {
  id: string;
  ad: string;
  ek_fiyat: number;
  aktif: boolean;
  sira: number;
}

interface MenuUrun {
  id: string;
  ad: string;
  fiyat: number;
  aciklama: string | null;
  gorsel_url: string | null;
  opsiyon_grubu: {
    id: string;
    ad: string;
    min_secim: number;
    max_secim: number;
    sira: number;
    opsiyon: MenuOpsiyon[];
  }[];
}

// Garson sepeti: aynı ürün farklı opsiyon/notla ayrı kalem olabilir
interface GarsonSepetKalemi {
  urun: MenuUrun;
  adet: number;
  opsiyonlar: SecilenOpsiyon[];
  not?: string;
}

interface MenuKategori {
  id: string;
  ad: string;
  urun: MenuUrun[];
}

type MasaDurum = "bos" | "dolu" | "onay" | "hazir" | "hesap" | "cagri";

const MASA_STIL: Record<MasaDurum, string> = {
  bos: "border-[1.5px] border-dashed border-[#ddccb4] bg-kart text-metin-silik",
  dolu: "border border-[#e0cdb2] bg-[#f1e7da] text-metin-baslik",
  onay: "border-[1.5px] border-[#8fb7dd] bg-[#e9f0f9] text-[#31639c] anim-nabiz",
  hazir: "border-[1.5px] border-durum-hazir bg-basari-zemin text-basari anim-nabiz",
  hesap: "border-[1.5px] border-[#e0a95c] bg-uyari-zemin text-uyari",
  cagri: "border-[1.5px] border-[#d98a76] bg-tehlike-zemin text-tehlike",
};

const ROZET: Record<MasaDurum, { zemin: string; renk: string; etiket: string }> = {
  bos: { zemin: "#f0ebe4", renk: "#93806f", etiket: "Boş" },
  dolu: { zemin: "#f1e7da", renk: "#5b3a1d", etiket: "Dolu" },
  onay: { zemin: "#e9f0f9", renk: "#31639c", etiket: "Onay bekliyor" },
  hazir: { zemin: "#e6f3ea", renk: "#2f7a4c", etiket: "Sipariş hazır" },
  hesap: { zemin: "#fbeeda", renk: "#9a5b13", etiket: "Hesap bekliyor" },
  cagri: { zemin: "#fbe7e4", renk: "#a63b2a", etiket: "Garson çağrısı" },
};

function kalemEtiket(k: KalemRow): string {
  const ops = k.secilen_opsiyonlar.map((o) => o.secim).join(", ");
  const not = k.kalem_notu ? ` ✎ ${k.kalem_notu}` : "";
  return `${k.adet} × ${k.urun_ad}${ops ? ` (${ops})` : ""}${not}`;
}

// selfServis: masa haritası yerine tezgah satışı + numaralı sipariş şeridi.
// odemeyeGec: şeritteki "Ödeme Al" kasanın Ödeme Bekleyenler sekmesine götürür
// (para akışı tek yerden — mevcut Ödendi/puan akışı çoğaltılmaz).
export function SiparisGirisi({
  kullanici,
  selfServis = false,
  odemeyeGec,
}: {
  kullanici: Kullanici;
  selfServis?: boolean;
  odemeyeGec?: () => void;
}) {
  const [bolumler, setBolumler] = useState<Bolum[]>([]);
  const [masalar, setMasalar] = useState<MasaRow[]>([]);
  const [adisyonlar, setAdisyonlar] = useState<AdisyonRow[]>([]);
  const [mutfaktakiler, setMutfaktakiler] = useState<SiparisRow[]>([]);
  const [cagrilar, setCagrilar] = useState<CagriRow[]>([]);
  const [menu, setMenu] = useState<MenuKategori[]>([]);
  const [bolumSecim, setBolumSecim] = useState<string | null>(null);
  const [acilirAcik, setAcilirAcik] = useState(false);
  const [seciliMasa, setSeciliMasa] = useState<string | null>(null);
  const [tezgahPaneli, setTezgahPaneli] = useState(false);
  // tezgah satışı gönderilince ödeme adımı: yeni siparişin adisyonu hemen kapatılabilir
  const [tezgahOdeme, setTezgahOdeme] = useState<{ siparisNo: number | null; adisyonId: string; tutar: number } | null>(null);
  const [sepet, setSepet] = useState<GarsonSepetKalemi[]>([]);
  const [notMetni, setNotMetni] = useState("");
  const [kategoriSecim, setKategoriSecim] = useState<string | null>(null);
  const [arama, setArama] = useState("");
  const [aramaOdak, setAramaOdak] = useState(false);
  const [detayUrun, setDetayUrun] = useState<MenuUrun | null>(null);
  const [sikIdler, setSikIdler] = useState<string[]>([]);
  const [fisGonderildi, setFisGonderildi] = useState(false);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [saat, setSaat] = useState("");
  const [bildirimDurum, setBildirimDurum] = useState<"yok" | "acik" | "kapali">("yok");
  // Masa panelinde puan/ödül işleme (hesap kapatmadan önce)
  const [musteriKod, setMusteriKod] = useState("");
  const [puanBilgi, setPuanBilgi] = useState<string | null>(null);
  const [oduller, setOduller] = useState<{ id: string; ad: string; puan_bedeli: number }[] | null>(null);
  const [odulListeAcik, setOdulListeAcik] = useState(false);
  // Ödül seçilince o ödülün uygulanacağı kalem beklenir (kalemler tıklanabilir olur)
  const [odulSecili, setOdulSecili] = useState<{ id: string; ad: string } | null>(null);
  const dikkatSayisi = useRef(0);
  const klavye = useKlavyeYuksekligi();

  useEffect(() => {
    const g = () => setSaat(new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }));
    g();
    const z = setInterval(g, 30_000);
    return () => clearInterval(z);
  }, []);

  const yenile = useCallback(async () => {
    if (!kullanici) return;
    const supabase = createClient();
    const [b, m, a, c, s] = await Promise.all([
      supabase.from("bolum").select("id, ad").eq("cafe_id", kullanici.cafe_id).order("sira"),
      supabase.from("masa").select("id, ad, bolum_id, aktif").eq("cafe_id", kullanici.cafe_id).eq("aktif", true).order("ad"),
      supabase
        .from("adisyon")
        .select("id, masa_id, siparis(id, durum, masa_id, siparis_no, siparis_kalemi(id, urun_ad, birim_fiyat, adet, opsiyon_ek_fiyat, secilen_opsiyonlar, reddedildi, odul_karsiligi, kalem_notu))")
        .eq("durum", "acik"),
      supabase.from("garson_cagri").select("id, masa_id, tur").eq("acik", true),
      // hazır bildirimi adisyon kapansa bile düşmesin diye siparişler ayrıca izlenir
      supabase
        .from("siparis")
        .select("id, durum, masa_id, siparis_no, siparis_kalemi(id, urun_ad, birim_fiyat, adet, opsiyon_ek_fiyat, secilen_opsiyonlar, reddedildi, kalem_notu)")
        .in("durum", ["bekliyor", "hazirlaniyor", "hazir"]),
    ]);
    setBolumler((b.data ?? []) as Bolum[]);
    setMasalar((m.data ?? []) as MasaRow[]);
    setAdisyonlar((a.data ?? []) as unknown as AdisyonRow[]);
    setCagrilar((c.data ?? []) as CagriRow[]);
    setMutfaktakiler((s.data ?? []) as unknown as SiparisRow[]);

    // yeni dikkat gerektiren durum (hazır sipariş / çağrı / onay bekleyen) gelince ses
    const dikkat =
      (c.data?.length ?? 0) +
      ((s.data ?? []) as unknown as SiparisRow[]).filter((x) => x.durum === "hazir").length +
      ((a.data ?? []) as unknown as AdisyonRow[])
        .flatMap((x) => x.siparis)
        .filter((x) => x.durum === "odeme_bekliyor").length;
    if (dikkat > dikkatSayisi.current) yeniSiparisSesi();
    dikkatSayisi.current = dikkat;
  }, [kullanici]);

  // Menü (manuel sipariş için) bir kez
  useEffect(() => {
    if (!kullanici) return;
    const supabase = createClient();
    supabase
      .from("kategori")
      .select("id, ad, urun(id, ad, fiyat, aktif, sira, aciklama, gorsel_url, opsiyon_grubu(id, ad, min_secim, max_secim, sira, opsiyon(id, ad, ek_fiyat, aktif, sira)))")
      .eq("cafe_id", kullanici.cafe_id)
      .eq("aktif", true)
      .order("sira")
      .then(({ data }) => {
        type HamUrun = MenuUrun & { aktif: boolean; sira: number };
        type HamKategori = { id: string; ad: string; urun: HamUrun[] };
        const kategoriler = ((data ?? []) as unknown as HamKategori[])
          .map((k) => ({
            ...k,
            urun: k.urun
              .filter((u) => u.aktif)
              .sort((a, b) => a.sira - b.sira)
              .map((u) => ({
                ...u,
                // Seçeneği kalmayan zorunlu grubu ele (sepete ekle kilitlenmesin)
                opsiyon_grubu: (u.opsiyon_grubu ?? [])
                  .map((g) => ({ ...g, opsiyon: g.opsiyon.filter((o) => o.aktif) }))
                  .filter((g) => g.opsiyon.length > 0),
              })),
          }))
          .filter((k) => k.urun.length > 0);
        setMenu(kategoriler);
      });

    // Sık gönderilenler: son ~300 sipariş kaleminden en çok satan ürünler
    supabase
      .from("siparis_kalemi")
      .select("urun_id, adet")
      .order("id", { ascending: false })
      .limit(300)
      .then(({ data }) => {
        const toplamlar = new Map<string, number>();
        for (const k of (data ?? []) as { urun_id: string; adet: number }[]) {
          toplamlar.set(k.urun_id, (toplamlar.get(k.urun_id) ?? 0) + k.adet);
        }
        setSikIdler(
          [...toplamlar.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id)
        );
      });
  }, [kullanici]);

  useEffect(() => {
    if (!kullanici) return;
    yenile();
    const supabase = createClient();
    const kanal = supabase
      .channel("garson-akisi")
      .on("postgres_changes", { event: "*", schema: "public", table: "siparis" }, () => yenile())
      .on("postgres_changes", { event: "*", schema: "public", table: "garson_cagri" }, () => yenile())
      .subscribe();
    const z = setInterval(yenile, 10_000);
    return () => {
      supabase.removeChannel(kanal);
      clearInterval(z);
    };
  }, [kullanici, yenile]);

  useEffect(() => {
    if (typeof Notification === "undefined") {
      setBildirimDurum("kapali");
      return;
    }
    if (Notification.permission === "granted") {
      setBildirimDurum("acik");
      // İzin zaten verilmiş: aboneliği sessizce tazele (ölmüş/rotasyona uğramış
      // endpoint yeniden kurulur — prompt çıkmaz çünkü izin granted)
      if (kullanici) bildirimAc();
    } else {
      setBildirimDurum("yok");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kullanici]);

  // Sekme öne gelince / internet dönünce anında tazele (bayat veri kalmasın)
  useEffect(() => {
    const tazele = () => { if (document.visibilityState === "visible") yenile(); };
    document.addEventListener("visibilitychange", tazele);
    window.addEventListener("online", tazele);
    return () => {
      document.removeEventListener("visibilitychange", tazele);
      window.removeEventListener("online", tazele);
    };
  }, [yenile]);

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

  // Masa başına türetilmiş durum
  function masaBilgi(masaId: string) {
    const adisyon = adisyonlar.find((a) => a.masa_id === masaId);
    const aktifSiparisler = (adisyon?.siparis ?? []).filter(
      (s) => !["iptal", "reddedildi"].includes(s.durum)
    );
    // adisyon kapanmış olsa bile mutfakta süren/hazır siparişler masaya bağlıdır
    const mutfakta = mutfaktakiler.filter((s) => s.masa_id === masaId);
    const hazirlar = mutfakta.filter((s) => s.durum === "hazir");
    // QR'dan gelip garson/kasa onayı bekleyen müşteri siparişleri
    const onaylar = aktifSiparisler.filter((s) => s.durum === "odeme_bekliyor");
    const cagri = cagrilar.find((c) => c.masa_id === masaId && c.tur === "garson");
    const hesap = cagrilar.find((c) => c.masa_id === masaId && c.tur === "hesap");
    const toplam = aktifSiparisler.reduce(
      (t, s) =>
        t +
        s.siparis_kalemi
          .filter((k) => !k.reddedildi && !k.odul_karsiligi)
          .reduce((tt, k) => tt + kalemTutar(k), 0),
      0
    );
    const durum: MasaDurum = cagri
      ? "cagri"
      : hazirlar.length
        ? "hazir"
        : onaylar.length
          ? "onay"
          : hesap
            ? "hesap"
            : aktifSiparisler.length || mutfakta.length
              ? "dolu"
              : "bos";
    return { adisyon, aktifSiparisler, hazirlar, onaylar, cagri, hesap, toplam, durum };
  }

  async function teslimEt(masaId: string) {
    const { hazirlar } = masaBilgi(masaId);
    const supabase = createClient();
    const { error } = await supabase
      .from("siparis")
      .update({ durum: "teslim" })
      .in("id", hazirlar.map((s) => s.id));
    if (error) alert("Teslim işaretlenemedi: " + error.message);
    yenile();
  }

  // Garson onayı: sipariş mutfağa düşer, hesap açık kalır (masada sonra ödenir).
  // Önden ödeyen müşteri için kasa onayı (Ödendi) ayrıca çalışmaya devam eder.
  async function siparisOnayla(masaId: string) {
    const { onaylar } = masaBilgi(masaId);
    if (!onaylar.length) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("siparis")
      .update({ durum: "bekliyor" })
      .in("id", onaylar.map((s) => s.id));
    if (error) alert(error.message);
    yenile();
  }

  async function siparisReddet(masaId: string) {
    const { onaylar } = masaBilgi(masaId);
    if (!onaylar.length) return;
    if (!confirm("Bekleyen sipariş reddedilsin mi? Müşteri ekranında 'Reddedildi' görünür.")) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("siparis")
      .update({ durum: "reddedildi" })
      .in("id", onaylar.map((s) => s.id));
    if (error) alert(error.message);
    yenile();
  }

  async function cagriKapat(cagriId: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("garson_cagri")
      .update({ acik: false, kapandi_at: new Date().toISOString() })
      .eq("id", cagriId);
    if (error) alert("İşlem tamamlanamadı: " + error.message);
    yenile();
  }

  // Hesap fişini kafedeki yazıcı ajanının kuyruğuna bırakır (tezgah yazıcısı basar)
  async function hesapFisiYazdir(adisyonId: string) {
    if (!kullanici) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("yazdirma_kuyrugu")
      .insert({ cafe_id: kullanici.cafe_id, adisyon_id: adisyonId });
    if (error) { alert("Fiş gönderilemedi: " + error.message); return; }
    setFisGonderildi(true);
    setTimeout(() => setFisGonderildi(false), 3000);
  }

  function puanBilgiGoster(metin: string) {
    setPuanBilgi(metin);
    setTimeout(() => setPuanBilgi(null), 6000);
  }

  // Müşteri koduyla bu adisyona puan işler (adisyon başına tek kazanım)
  async function puanIsle(adisyonId: string) {
    if (!musteriKod.trim()) return;
    const supabase = createClient();
    const { data, error } = await supabase.rpc("sadakat_puan_isle", {
      p_adisyon_id: adisyonId,
      p_musteri_kod: musteriKod.trim(),
    });
    if (error) return puanBilgiGoster("Puan işlenemedi: " + error.message);
    const d = data as { musteri_ad: string; kazanilan: number; yeni_bakiye: number };
    puanBilgiGoster(`⭐ ${d.musteri_ad}: +${d.kazanilan} puan (bakiye ${d.yeni_bakiye})`);
    setMusteriKod("");
  }

  async function odulListesiAc() {
    if (!musteriKod.trim()) return puanBilgiGoster("Önce müşteri kodunu yaz/okut.");
    setOdulListeAcik(true);
    if (oduller === null) {
      const supabase = createClient();
      const { data } = await supabase
        .from("odul")
        .select("id, ad, puan_bedeli")
        .eq("cafe_id", kullanici.cafe_id)
        .eq("aktif", true)
        .order("sira")
        .order("ad");
      setOduller((data as typeof oduller) ?? []);
    }
  }

  // Seçilen ödülü, kasiyerin dokunduğu kaleme uygular (kalem sunucuda bedava olur)
  async function odulKalemeUygula(kalemId: string) {
    if (!odulSecili) return;
    const supabase = createClient();
    const { data, error } = await supabase.rpc("odul_kullan", {
      p_musteri_kod: musteriKod.trim(),
      p_odul_id: odulSecili.id,
      p_kalem_id: kalemId,
    });
    setOdulSecili(null);
    if (error) return puanBilgiGoster("Ödül kullanılamadı: " + error.message);
    const d = data as { musteri_ad: string; odul_ad: string; yeni_bakiye: number };
    puanBilgiGoster(`🎁 ${d.musteri_ad}: "${d.odul_ad}" uygulandı (kalan ${d.yeni_bakiye} puan)`);
    setMusteriKod("");
    yenile();
  }

  async function manuelGonder(masaId: string | null) {
    const kalemler = sepet
      .filter((k) => k.adet > 0)
      .map((k) => ({
        urun_id: k.urun.id,
        adet: k.adet,
        opsiyonlar: k.opsiyonlar,
        not: k.not ?? null,
      }));
    if (!kalemler.length || gonderiliyor) return;
    const tutar = manuelToplam;
    setGonderiliyor(true);
    const supabase = createClient();
    const { data: siparisId, error } = await supabase.rpc("personel_siparis_olustur", {
      p_masa_id: masaId,
      p_kalemler: kalemler,
      p_musteri_notu: notMetni.trim() || null,
    });
    setGonderiliyor(false);
    if (error) {
      alert(error.message);
      return;
    }
    setSepet([]);
    setNotMetni("");
    setArama("");
    if (masaId === null && siparisId) {
      // Tezgah satışı: müşteri parayı hemen öder — ödeme adımına geç
      const { data: s } = await supabase
        .from("siparis")
        .select("adisyon_id, siparis_no")
        .eq("id", siparisId as string)
        .single();
      if (s) setTezgahOdeme({ siparisNo: s.siparis_no, adisyonId: s.adisyon_id, tutar });
    }
    yenile();
  }

  // Tezgah ödemesi: adisyonu hemen kapatır (Nakit/Kart); "Sonra" açık bırakır
  async function tezgahOdemeAl(tur: "nakit" | "kart" | null) {
    if (!tezgahOdeme) return;
    if (tur) {
      const supabase = createClient();
      const { error } = await supabase.rpc("adisyon_kapat", {
        p_adisyon_id: tezgahOdeme.adisyonId,
        p_odeme_turu: tur,
      });
      if (error) {
        alert("Ödeme kaydedilemedi: " + error.message);
        return;
      }
    }
    setTezgahOdeme(null);
    setTezgahPaneli(false);
    yenile();
  }

  // Numara şeridi: tek dokunuşla hazır. RPC önce 'hazir' yazar (müşteriye push
  // gider), masasız siparişi ardından 'teslim'e taşır — kart listeden düşer.
  async function hazirVer(siparisId: string) {
    const supabase = createClient();
    const { error } = await supabase.rpc("siparis_hazir_ver", { p_siparis_id: siparisId });
    if (error) alert("Hazır işaretlenemedi: " + error.message);
    yenile();
  }

  const aktifBolum = bolumSecim ?? bolumler[0]?.id ?? null;
  const bolumOzet = (bolumId: string) => {
    const grup = masalar.filter((m) => m.bolum_id === bolumId);
    const dolu = grup.filter((m) => masaBilgi(m.id).durum !== "bos").length;
    return `${dolu}/${grup.length} dolu`;
  };
  const bolumDikkat = (bolumId: string) =>
    masalar.some((m) => m.bolum_id === bolumId && ["hazir", "cagri"].includes(masaBilgi(m.id).durum));

  const bildirimler = [
    ...masalar
      .filter((m) => masaBilgi(m.id).durum === "hazir")
      .map((m) => ({ id: `h-${m.id}`, masaId: m.id, tur: "hazir" as const, baslik: `${m.ad} · Sipariş hazır`, alt: "Mutfaktan alın ve masaya götürün" })),
    ...masalar
      .filter((m) => !!masaBilgi(m.id).cagri)
      .map((m) => ({ id: `c-${m.id}`, masaId: m.id, tur: "cagri" as const, baslik: `${m.ad} · Garson çağırıyor`, alt: "Masaya gidin" })),
    ...masalar
      .filter((m) => masaBilgi(m.id).onaylar.length > 0)
      .map((m) => ({ id: `o-${m.id}`, masaId: m.id, tur: "onay" as const, baslik: `${m.ad} · Sipariş verdi, onay bekliyor`, alt: "Onaylayın ya da reddedin" })),
  ];

  // Self-servis numara şeridi: ödeme bekleyen + mutfaktaki tüm aktif siparişler
  // Hazır verilen sipariş şeritten düşer (self-serviste zaten 'teslim'e taşınır;
  // yenileme gecikmesinde de kart görünmesin diye ayrıca elenir)
  const seritSiparisler: SiparisRow[] = selfServis
    ? [
        ...adisyonlar.flatMap((a) => a.siparis).filter((s) => s.durum === "odeme_bekliyor"),
        ...mutfaktakiler.filter((s) => s.durum !== "hazir"),
      ].sort((x, y) => (x.siparis_no ?? 0) - (y.siparis_no ?? 0))
    : [];

  const panelMasa = seciliMasa ? masalar.find((m) => m.id === seciliMasa) : null;
  const panel = panelMasa ? masaBilgi(panelMasa.id) : null;
  const tumUrunler = menu.flatMap((k) => k.urun);
  const kalemFiyat = (k: GarsonSepetKalemi) =>
    (Number(k.urun.fiyat) + k.opsiyonlar.reduce((t, o) => t + Number(o.ek_fiyat), 0)) * k.adet;
  const manuelToplam = sepet.reduce((t, k) => t + kalemFiyat(k), 0);
  const sepetAdet = sepet.reduce((t, k) => t + k.adet, 0);
  const urunAdet = (urunId: string) =>
    sepet.filter((k) => k.urun.id === urunId).reduce((t, k) => t + k.adet, 0);
  const sikUrunler = sikIdler
    .map((id) => tumUrunler.find((u) => u.id === id))
    .filter(Boolean) as MenuUrun[];
  const aktifKategori = kategoriSecim ?? menu[0]?.id ?? null;
  const aramaMetni = arama.trim().toLocaleLowerCase("tr");
  const listelenenUrunler = aramaMetni
    ? tumUrunler.filter((u) => u.ad.toLocaleLowerCase("tr").includes(aramaMetni))
    : (menu.find((k) => k.id === aktifKategori)?.urun ?? []);

  // Detaydan gelen ekleme: aynı ürün + aynı opsiyon + aynı not varsa üstüne yazar
  function sepeteEkle(urun: MenuUrun, adet: number, opsiyonlar: SecilenOpsiyon[], not?: string) {
    setSepet((s) => {
      const anahtar = JSON.stringify(opsiyonlar) + "|" + (not ?? "");
      const i = s.findIndex(
        (k) => k.urun.id === urun.id && JSON.stringify(k.opsiyonlar) + "|" + (k.not ?? "") === anahtar
      );
      if (i >= 0) return s.map((k, j) => (j === i ? { ...k, adet: k.adet + adet } : k));
      return [...s, { urun, adet, opsiyonlar, not }];
    });
    setDetayUrun(null);
  }

  // Satırdaki +: ürünün son kalemine +1 (hiç yoksa: opsiyonluysa detay açılır, değilse yeni kalem)
  function hizliArtir(u: MenuUrun) {
    const son = [...sepet].reverse().find((k) => k.urun.id === u.id);
    if (son) {
      setSepet((s) => s.map((k) => (k === son ? { ...k, adet: k.adet + 1 } : k)));
    } else if (u.opsiyon_grubu.length > 0) {
      setDetayUrun(u);
    } else {
      setSepet((s) => [...s, { urun: u, adet: 1, opsiyonlar: [] }]);
    }
  }

  function hizliAzalt(u: MenuUrun) {
    const son = [...sepet].reverse().find((k) => k.urun.id === u.id);
    if (!son) return;
    setSepet((s) =>
      son.adet <= 1 ? s.filter((k) => k !== son) : s.map((k) => (k === son ? { ...k, adet: k.adet - 1 } : k))
    );
  }

  return (
    <div className="relative flex w-full flex-col text-metin" onClick={sesHazirla}>
      {/* Başlık — geniş ekranda içerik kabıyla aynı hizada kalır */}
      <header className="marka-gradyan flex-shrink-0 px-5 pb-3.5 pt-5 text-white">
        <div className="mx-auto flex w-full max-w-[1280px] items-center gap-2.5">
          <div>
            <div className="text-[19px] font-extrabold leading-tight">
              {kullanici?.ad ?? "Garson"}
            </div>
            <div className="text-xs opacity-80">
              {selfServis ? "Self-Servis Tezgahı" : "Masa Haritası"}
            </div>
          </div>
          <span className="flex-1" />
          <button
            onClick={bildirimAc}
            title={bildirimDurum === "acik" ? "Bildirimler açık" : "Bildirimleri aç"}
            className={
              "rounded-full border border-white/30 px-3 py-1 text-sm font-semibold " +
              (bildirimDurum === "acik" ? "bg-white/25" : "bg-white/10 opacity-80")
            }
          >
            {bildirimDurum === "acik" ? "🔔" : "🔕"}
          </button>
          <span className="text-sm font-bold tabular-nums opacity-90">{saat}</span>
        </div>
        <div className="mx-auto mt-3 flex w-full max-w-[1280px] flex-wrap gap-1.5 text-[10.5px] font-bold">
          {!selfServis && (
            [
              ["bg-white/50", "Boş"],
              ["bg-[#f0d5b4]", "Dolu"],
              ["bg-[#8fb7dd]", "Onay"],
              ["bg-durum-hazir", "Sipariş hazır"],
              ["bg-[#e8b45c]", "Hesap"],
              ["bg-[#f0876a]", "Çağrı"],
            ] as const
          ).map(([renk, etiket]) => (
            <span key={etiket} className="flex items-center gap-1.5 rounded-full bg-[rgba(60,30,8,0.28)] px-2.5 py-1">
              <span className={`h-[7px] w-[7px] rounded-full ${renk}`} />
              {etiket}
            </span>
          ))}
        </div>
      </header>

      <div className="kaydirmasiz flex-1 overflow-auto">
        {/* ── Self-servis: yeni satış + numara şeridi ── */}
        {selfServis && (
          <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-2.5 px-4 pb-10 pt-3.5">
            <button
              onClick={() => {
                setTezgahPaneli(true);
                setTezgahOdeme(null);
                setSepet([]);
                setArama("");
                setKategoriSecim(null);
              }}
              className="marka-gradyan w-full rounded-2xl p-4 text-[15.5px] font-extrabold text-white shadow-[0_4px_14px_rgba(138,75,31,0.3)]"
            >
              + Yeni Sipariş (Tezgah)
            </button>

            {seritSiparisler.length === 0 && (
              <p className="py-6 text-center text-sm text-metin-soluk">
                Aktif sipariş yok — uygulamadan gelen ve tezgahtan girilen siparişler burada
                numarasıyla listelenir.
              </p>
            )}

            {seritSiparisler.map((s) => {
              const kalemler = s.siparis_kalemi.filter((k) => !k.reddedildi);
              // Hazırlanan siparişte sola kaydırmak = "Hazır" (buton da durur)
              const kaydirilabilir = s.durum === "bekliyor" || s.durum === "hazirlaniyor";
              return (
                <KaydirilabilirKart
                  key={s.id}
                  aktif={kaydirilabilir}
                  etiket="Hazır ✓"
                  onKaydir={() => hazirVer(s.id)}
                  className={
                    "rounded-[16px] border bg-kart px-4 py-3.5 " +
                    (s.durum === "hazir"
                      ? "border-[#9bc4a8]"
                      : s.durum === "odeme_bekliyor"
                        ? "border-[#e0a95c]"
                        : "border-cizgi")
                  }
                >
                  {/* Geniş ekranda yatay şerit (KDS kart düzeni), telefonda alt alta */}
                  <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex items-center gap-2.5 sm:w-[190px] sm:flex-shrink-0 sm:flex-col sm:items-start sm:gap-1.5">
                      <span className="text-[21px] font-extrabold leading-none tracking-tight sm:text-[26px]">
                        {s.siparis_no != null ? `#${s.siparis_no}` : "Sipariş"}
                      </span>
                      <span
                        className={
                          "whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-extrabold " +
                          (s.durum === "odeme_bekliyor"
                            ? "bg-uyari-zemin text-uyari"
                            : s.durum === "hazir"
                              ? "bg-basari-zemin text-basari"
                              : "bg-krem-koyu text-metin-orta")
                        }
                      >
                        {s.durum === "odeme_bekliyor"
                          ? "ödeme bekliyor"
                          : s.durum === "hazir"
                            ? "hazır — müşteri bekliyor"
                            : "hazırlanıyor"}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1 text-[13.5px] font-semibold leading-relaxed text-metin-orta sm:text-[15px]">
                      {kalemler.map((k) => kalemEtiket(k)).join(" · ")}
                    </div>

                    <div className="flex gap-2 sm:w-[200px] sm:flex-shrink-0 sm:justify-end">
                      {s.durum === "odeme_bekliyor" && (
                        <button
                          onClick={odemeyeGec}
                          className="flex-1 rounded-xl bg-uyari px-3.5 py-2.5 text-[13px] font-extrabold text-white sm:flex-none"
                        >
                          Ödeme Al →
                        </button>
                      )}
                      {(s.durum === "bekliyor" || s.durum === "hazirlaniyor") && (
                        <button
                          onClick={() => hazirVer(s.id)}
                          className="flex-1 rounded-xl bg-basari px-3.5 py-2.5 text-[13px] font-extrabold text-white sm:flex-none"
                        >
                          Hazır ✓
                        </button>
                      )}
                    </div>
                  </div>
                </KaydirilabilirKart>
              );
            })}
          </div>
        )}

        {/* Bildirimler */}
        {!selfServis && bildirimler.length > 0 && (
          <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-2 px-4 pt-3">
            {bildirimler.map((b) => (
              <button
                key={b.id}
                onClick={() => setSeciliMasa(b.masaId)}
                className={
                  "flex w-full items-center gap-2.5 rounded-[14px] border px-3.5 py-2.5 text-left " +
                  (b.tur === "hazir"
                    ? "anim-nabiz border-[#9bc4a8] bg-basari-zemin text-basari"
                    : b.tur === "onay"
                      ? "anim-nabiz border-[#8fb7dd] bg-[#e9f0f9] text-[#31639c]"
                      : "border-[#e5a898] bg-tehlike-zemin text-tehlike")
                }
              >
                <span className="flex-1">
                  <span className="block text-sm font-extrabold">{b.baslik}</span>
                  <span className="mt-0.5 block text-xs opacity-80">{b.alt}</span>
                </span>
                <span className="text-lg">›</span>
              </button>
            ))}
          </div>
        )}

        {/* Bölüm seçici */}
        {!selfServis && bolumler.length > 1 && (
          <div className="relative z-20 mx-auto w-full max-w-[1280px] px-4 pt-3.5">
            <button
              onClick={() => setAcilirAcik((a) => !a)}
              className="flex w-full items-center gap-2.5 rounded-[14px] border border-cizgi-koyu bg-kart px-4 py-3 shadow-[0_1px_3px_rgba(90,58,29,0.06)]"
            >
              <span className="text-[15.5px] font-extrabold text-metin-baslik">
                {bolumler.find((b) => b.id === aktifBolum)?.ad}
              </span>
              <span className="text-[12.5px] font-bold text-metin-soluk">
                {aktifBolum ? bolumOzet(aktifBolum) : ""}
              </span>
              <span className="flex-1" />
              <span
                className="text-[15px] text-marka-koyu transition-transform"
                style={{ transform: acilirAcik ? "rotate(180deg)" : "none" }}
              >
                ▾
              </span>
            </button>
            {acilirAcik && (
              <div className="anim-fade absolute inset-x-4 top-[calc(100%+6px)] overflow-hidden rounded-[14px] border border-cizgi-koyu bg-kart shadow-[0_12px_30px_rgba(43,28,16,0.18)]">
                {bolumler.map((b, i) => (
                  <button
                    key={b.id}
                    onClick={() => {
                      setBolumSecim(b.id);
                      setAcilirAcik(false);
                    }}
                    className={
                      "flex w-full items-center gap-2.5 px-4 py-3 text-left " +
                      (b.id === aktifBolum ? "bg-krem " : "bg-kart ") +
                      (bolumDikkat(b.id) ? "text-tehlike" : "text-metin-baslik") +
                      (i > 0 ? " border-t border-[#f6ede1]" : "")
                    }
                  >
                    <span className="text-[14.5px] font-extrabold">
                      {b.ad}
                      {bolumDikkat(b.id) ? " •" : ""}
                    </span>
                    <span className="flex-1" />
                    <span className="text-[12.5px] font-bold opacity-70">{bolumOzet(b.id)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Masa haritası */}
        <div
          className={
            selfServis
              ? "hidden"
              : "mx-auto grid w-full max-w-[1280px] grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2.5 px-4 pb-10 pt-3.5"
          }
        >
          {masalar
            .filter((m) => !aktifBolum || m.bolum_id === aktifBolum)
            .map((m) => {
              const bilgi = masaBilgi(m.id);
              const alt: Record<MasaDurum, string> = {
                bos: "boş",
                dolu: bilgi.toplam > 0 ? tl(bilgi.toplam) : "servis sürüyor",
                onay: "onay bekliyor",
                hazir: "hazır ✓",
                hesap: `${tl(bilgi.toplam)} · hesap`,
                cagri: "çağrı!",
              };
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    setSeciliMasa(m.id);
                    setSepet([]);
                    setArama("");
                    setKategoriSecim(null);
                  }}
                  className={`flex min-h-[72px] flex-col items-center justify-center rounded-[15px] px-1 py-2 ${MASA_STIL[bilgi.durum]}`}
                >
                  <span className="text-[15px] font-extrabold">{m.ad}</span>
                  <span className="mt-0.5 text-[11.5px] font-bold opacity-85">{alt[bilgi.durum]}</span>
                </button>
              );
            })}
        </div>
      </div>

      {/* Masa paneli / tezgah satışı */}
      {((panelMasa && panel) || tezgahPaneli) && (
        <div
          className="anim-fade fixed inset-0 z-30 flex items-end justify-center bg-[rgba(43,28,16,0.45)] sm:items-center sm:p-6"
          onClick={() => {
            setSeciliMasa(null);
            setTezgahPaneli(false);
            setTezgahOdeme(null);
          }}
        >
          <div
            className="anim-sheet kaydirmasiz w-full max-w-lg overflow-auto rounded-t-3xl bg-kart px-5 pb-0 pt-5 sm:max-w-3xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
            style={{
              // Klavye açıkken panel klavyenin üstüne oturur; içerik klavye
              // ekranı kapatıyormuş gibi yukarı kayar, hiçbir şey altında kalmaz
              maxHeight: klavye > 0 ? `calc(100dvh - ${klavye + 8}px)` : "88dvh",
              marginBottom: klavye > 0 ? klavye : 0,
            }}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-[22px] font-extrabold">{panelMasa?.ad ?? "Tezgah Satışı"}</span>
              {panel && (
                <span
                  className="rounded-full px-3 py-1 text-xs font-extrabold"
                  style={{ background: ROZET[panel.durum].zemin, color: ROZET[panel.durum].renk }}
                >
                  {ROZET[panel.durum].etiket}
                </span>
              )}
              <span className="flex-1" />
              <button
                onClick={() => {
                  setSeciliMasa(null);
                  setTezgahPaneli(false);
                  setTezgahOdeme(null);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-krem-koyu text-[17px] text-marka-koyu"
              >
                ×
              </button>
            </div>

            {/* Onay bekleyen QR siparişi */}
            {!aramaMetni && panelMasa && panel && panel.onaylar.length > 0 && (
              <div className="mt-3.5 rounded-[14px] border border-[#8fb7dd] bg-[#e9f0f9] px-3.5 py-3">
                <div className="text-xs font-extrabold tracking-[1px] text-[#31639c]">
                  MASA SİPARİŞ VERDİ — ONAY BEKLİYOR
                </div>
                <div className="mt-1.5 flex flex-col gap-1">
                  {panel.onaylar.flatMap((s) =>
                    s.siparis_kalemi.filter((k) => !k.reddedildi).map((k) => (
                      <div key={k.id} className="flex justify-between gap-2 text-[14.5px] font-semibold">
                        <span>{kalemEtiket(k)}</span>
                        <span className="tabular-nums opacity-70">{tl(kalemTutar(k))}</span>
                      </div>
                    ))
                  )}
                </div>
                <p className="mt-1.5 text-[11.5px] leading-snug text-[#31639c] opacity-80">
                  Onaylarsan mutfağa gider, hesap masada açık kalır. Müşteri önden ödemek isterse
                  kasa &quot;Ödendi&quot; dediğinde de mutfağa düşer.
                </p>
                <div className="mt-2.5 flex gap-2">
                  <button
                    onClick={() => siparisReddet(panelMasa.id)}
                    className="rounded-xl border border-[#8fb7dd] bg-kart px-3.5 py-3 text-[14px] font-extrabold text-[#31639c]"
                  >
                    Reddet
                  </button>
                  <button
                    onClick={() => siparisOnayla(panelMasa.id)}
                    className="flex-1 rounded-xl bg-[#31639c] p-3 text-[15px] font-extrabold text-white"
                  >
                    Onayla — Mutfağa Gönder ✓
                  </button>
                </div>
              </div>
            )}

            {/* Mutfakta hazır */}
            {!aramaMetni && panelMasa && panel && panel.hazirlar.length > 0 && (
              <div className="mt-3.5 rounded-[14px] border border-[#9bc4a8] bg-basari-zemin px-3.5 py-3">
                <div className="text-xs font-extrabold tracking-[1px] text-basari">MUTFAKTA HAZIR</div>
                <div className="mt-1.5 flex flex-col gap-1">
                  {panel.hazirlar.flatMap((s) =>
                    s.siparis_kalemi.filter((k) => !k.reddedildi).map((k) => (
                      <div key={k.id} className="text-[14.5px] font-semibold">
                        {kalemEtiket(k)}
                      </div>
                    ))
                  )}
                </div>
                <button
                  onClick={() => teslimEt(panelMasa.id)}
                  className="mt-2.5 w-full rounded-xl bg-basari p-3 text-[15px] font-extrabold text-white"
                >
                  Masaya Götürdüm ✓
                </button>
              </div>
            )}

            {/* Garson çağrısı */}
            {!aramaMetni && panel && panel.cagri && (
              <div className="mt-3.5 rounded-[14px] border border-[#e5a898] bg-tehlike-zemin px-3.5 py-3">
                <div className="text-sm font-bold text-tehlike">Masa garson çağırıyor.</div>
                <button
                  onClick={() => cagriKapat(panel.cagri!.id)}
                  className="mt-2.5 w-full rounded-xl bg-tehlike p-3 text-[15px] font-extrabold text-white"
                >
                  İlgilendim ✓
                </button>
              </div>
            )}

            {/* Hesap istiyor */}
            {!aramaMetni && panel && panel.hesap && (
              <div className="mt-3.5 rounded-xl bg-uyari-zemin px-3.5 py-2.5">
                <p className="text-[13px] font-semibold leading-relaxed text-uyari">
                  Masa hesap istiyor — hesap kasada, mevcut POS&apos;tan kapatılır.
                </p>
                <button
                  onClick={() => cagriKapat(panel.hesap!.id)}
                  className="mt-2 w-full rounded-xl bg-uyari p-2.5 text-sm font-extrabold text-white"
                >
                  Tamam ✓
                </button>
              </div>
            )}

            {/* Açık adisyon (arama sırasında gizle — arama öne çıksın) */}
            {!aramaMetni && panel && panel.aktifSiparisler.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-extrabold tracking-[1px] text-metin-soluk">AÇIK ADİSYON</div>
                <div className="mt-2 flex flex-col gap-1.5">
                  {panel.aktifSiparisler.flatMap((s) =>
                    s.siparis_kalemi.filter((k) => !k.reddedildi).map((k) => {
                      const secilebilir = !!odulSecili && !k.odul_karsiligi;
                      return (
                        <div
                          key={k.id}
                          onClick={secilebilir ? () => odulKalemeUygula(k.id) : undefined}
                          className={
                            "flex justify-between gap-2.5 text-[14.5px] " +
                            (secilebilir ? "-mx-1 cursor-pointer rounded-lg bg-uyari-zemin px-1 py-0.5" : "")
                          }
                        >
                          <span className={"font-semibold " + (k.odul_karsiligi ? "text-metin-soluk line-through" : "")}>
                            {kalemEtiket(k)}
                            {k.odul_karsiligi && (
                              <span className="ml-1.5 rounded bg-basari-zemin px-1.5 py-0.5 text-[10.5px] font-extrabold text-basari no-underline">
                                🎁 ödül
                              </span>
                            )}
                            {s.durum === "odeme_bekliyor" && (
                              <span className="ml-1.5 rounded bg-uyari-zemin px-1.5 py-0.5 text-[10.5px] font-extrabold text-uyari">
                                ödeme bekliyor
                              </span>
                            )}
                          </span>
                          <span className="tabular-nums text-metin-soluk">
                            {k.odul_karsiligi ? tl(0) : tl(kalemTutar(k))}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="mt-2.5 flex items-center justify-between border-t border-dashed border-cizgi-koyu pt-2.5 text-[15px] font-extrabold">
                  <span>Toplam</span>
                  <span className="text-metin-baslik">{tl(panel.toplam)}</span>
                </div>

                {/* Puan / ödül işleme (hesap kapatmadan önce) */}
                <div className="mt-3 rounded-xl border border-cizgi bg-krem px-2.5 py-2.5">
                  {puanBilgi && (
                    <p className="mb-2 rounded-lg bg-basari-zemin px-2.5 py-1.5 text-[12px] font-bold text-basari">
                      {puanBilgi}
                    </p>
                  )}
                  {odulSecili ? (
                    <p className="rounded-lg bg-uyari-zemin px-2.5 py-2 text-[12.5px] font-bold text-uyari">
                      🎁 {odulSecili.ad} — yukarıda bedava yapılacak ürüne dokun
                      <button onClick={() => setOdulSecili(null)} className="ml-2 underline">vazgeç</button>
                    </p>
                  ) : odulListeAcik ? (
                    <div className="flex flex-col gap-1">
                      <p className="text-[11.5px] font-extrabold text-metin-soluk">ÖDÜL SEÇ</p>
                      {(oduller ?? []).length === 0 ? (
                        <p className="text-[12px] text-metin-soluk">Tanımlı ödül yok.</p>
                      ) : (
                        (oduller ?? []).map((o) => (
                          <button
                            key={o.id}
                            onClick={() => { setOdulSecili({ id: o.id, ad: o.ad }); setOdulListeAcik(false); }}
                            className="flex justify-between rounded-lg border border-cizgi-koyu bg-kart px-2.5 py-1.5 text-[12.5px] font-bold"
                          >
                            <span>{o.ad}</span>
                            <span className="text-metin-soluk">{o.puan_bedeli} puan</span>
                          </button>
                        ))
                      )}
                      <button onClick={() => setOdulListeAcik(false)} className="mt-0.5 text-[11.5px] text-metin-soluk">
                        kapat
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-1.5">
                      <input
                        value={musteriKod}
                        onChange={(e) => setMusteriKod(e.target.value.toUpperCase())}
                        placeholder="Müşteri kodu (puan/ödül)"
                        autoCapitalize="characters"
                        className="min-w-0 flex-1 rounded-lg border border-cizgi-koyu bg-kart px-2.5 py-2 text-[13px] outline-none"
                      />
                      <button
                        onClick={() => panel.adisyon && puanIsle(panel.adisyon.id)}
                        disabled={!musteriKod.trim() || !panel.adisyon}
                        className="rounded-lg bg-marka px-2.5 py-2 text-[12.5px] font-extrabold text-white disabled:opacity-40"
                      >
                        ⭐ Puan
                      </button>
                      <button
                        onClick={odulListesiAc}
                        disabled={!musteriKod.trim()}
                        className="rounded-lg border border-cizgi-koyu bg-kart px-2.5 py-2 text-[12.5px] font-extrabold text-metin-orta disabled:opacity-40"
                      >
                        🎁 Ödül
                      </button>
                    </div>
                  )}
                </div>

                {panel.adisyon && (
                  <button
                    onClick={() => hesapFisiYazdir(panel.adisyon!.id)}
                    className={
                      "mt-2.5 w-full rounded-xl border px-3.5 py-2.5 text-[13.5px] font-extrabold " +
                      (fisGonderildi
                        ? "border-basari bg-basari-zemin text-basari"
                        : "border-cizgi-koyu bg-kart text-metin-orta")
                    }
                  >
                    {fisGonderildi ? "Fiş yazıcıya gönderildi ✓" : "🧾 Hesap Fişi Yazdır"}
                  </button>
                )}
                {panel.adisyon && !tezgahOdeme && (
                  <button
                    onClick={() =>
                      setTezgahOdeme({ siparisNo: null, adisyonId: panel.adisyon!.id, tutar: panel.toplam })
                    }
                    className="marka-gradyan mt-2 w-full rounded-xl px-3.5 py-3 text-[14.5px] font-extrabold text-white"
                  >
                    ₺ Ödeme Al · {tl(panel.toplam)}
                  </button>
                )}
              </div>
            )}

            {/* Sipariş ekranı — masa açılınca doğrudan burası */}
            <div className="mt-4">
              <div className="text-xs font-extrabold tracking-[1px] text-metin-soluk">
                YENİ SİPARİŞ
              </div>

              {/* Arama */}
              <input
                value={arama}
                onChange={(e) => setArama(e.target.value)}
                onFocus={() => setAramaOdak(true)}
                onBlur={() => setTimeout(() => setAramaOdak(false), 150)}
                placeholder="🔎 Ürün ara…"
                className="mt-2 w-full rounded-xl border border-cizgi-koyu bg-krem px-3.5 py-3 text-[15px] outline-none focus:border-marka"
              />

              {/* Sık gönderilenler (arama çubuğuna dokununca) */}
              {aramaOdak && !aramaMetni && sikUrunler.length > 0 && (
                <div className="mt-2 rounded-xl border border-cizgi bg-krem px-3 py-2.5">
                  <div className="text-[10.5px] font-extrabold tracking-[1px] text-metin-silik">
                    SIK GÖNDERİLENLER
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {sikUrunler.map((u) => (
                      <button
                        key={u.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => hizliArtir(u)}
                        className={
                          "rounded-full border px-3.5 py-2 text-[13.5px] font-bold " +
                          (urunAdet(u.id) > 0
                            ? "border-marka bg-[#fdf5ec] text-marka-koyu"
                            : "border-cizgi-koyu bg-kart text-metin-orta")
                        }
                      >
                        {u.ad}
                        {urunAdet(u.id) > 0 && ` ×${urunAdet(u.id)}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Kategori seçici — alt satıra sarar, hepsi bir bakışta görünür */}
              {!aramaMetni && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {menu.map((k) => (
                    <button
                      key={k.id}
                      onClick={() => setKategoriSecim(k.id)}
                      className={
                        "whitespace-nowrap rounded-full px-3.5 py-2 text-[12.5px] font-bold " +
                        (k.id === aktifKategori
                          ? "marka-gradyan text-white"
                          : "border border-cizgi-koyu bg-kart text-metin-orta")
                      }
                    >
                      {k.ad}
                    </button>
                  ))}
                </div>
              )}

              {/* Ürünler: satıra dokun = detay/bilgi; + ile hızlı artır */}
              {/* Geniş ekranda ürünler çok sütuna yayılır (tablette 2, masaüstünde 3) */}
              <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {listelenenUrunler.length === 0 && (
                  <p className="py-3 text-center text-sm text-metin-soluk sm:col-span-2 lg:col-span-3">
                    {aramaMetni ? "Aramayla eşleşen ürün yok." : "Bu kategoride ürün yok."}
                  </p>
                )}
                {listelenenUrunler.map((u) => {
                  const adet = urunAdet(u.id);
                  return (
                    <div
                      key={u.id}
                      role="button"
                      onClick={() => setDetayUrun(u)}
                      className={
                        "flex cursor-pointer select-none items-center gap-3 rounded-2xl border px-3.5 py-3.5 " +
                        (adet > 0
                          ? "border-marka bg-[#fdf5ec]"
                          : "border-cizgi bg-krem active:bg-krem-koyu")
                      }
                    >
                      {u.gorsel_url && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={u.gorsel_url}
                          alt={u.ad}
                          className="h-12 w-12 flex-shrink-0 rounded-xl object-cover"
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15.5px] font-bold leading-snug">{u.ad}</span>
                        <span className="mt-0.5 block text-[14px] font-extrabold tabular-nums text-marka-koyu">
                          {tl(Number(u.fiyat))}
                          {u.opsiyon_grubu.length > 0 && (
                            <span className="ml-1.5 font-semibold text-metin-silik">· opsiyonlu</span>
                          )}
                        </span>
                      </span>
                      {adet > 0 && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              hizliAzalt(u);
                            }}
                            aria-label="Azalt"
                            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-cizgi-koyu bg-kart text-[17px] text-marka-koyu"
                          >
                            −
                          </button>
                          <span className="min-w-[28px] rounded-full bg-marka px-1.5 py-1 text-center text-[14px] font-extrabold text-white">
                            {adet}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              hizliArtir(u);
                            }}
                            aria-label="Artır"
                            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-marka bg-kart text-[17px] font-bold text-marka-koyu"
                          >
                            +
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Seçilenler özeti */}
              {sepet.length > 0 && (
                <div className="mt-3 rounded-xl border border-cizgi bg-krem px-3 py-2.5">
                  <div className="text-[10.5px] font-extrabold tracking-[1px] text-metin-silik">
                    SEÇİLENLER
                  </div>
                  <div className="mt-1 flex flex-col gap-1">
                    {sepet.map((k, i) => (
                      <div key={i} className="flex items-center gap-2 text-[13.5px]">
                        <span className="min-w-0 flex-1 font-semibold">
                          {k.adet} × {k.urun.ad}
                          {k.opsiyonlar.length > 0 && (
                            <span className="text-metin-soluk">
                              {" "}({k.opsiyonlar.map((o) => o.secim).join(", ")})
                            </span>
                          )}
                          {k.not && <span className="italic text-marka-koyu"> ✎ {k.not}</span>}
                        </span>
                        <span className="tabular-nums text-metin-soluk">{tl(kalemFiyat(k))}</span>
                        <button
                          onClick={() => setSepet((s) => s.filter((_, j) => j !== i))}
                          aria-label="Kaldır"
                          className="px-1 text-[15px] text-tehlike-yumusak"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <input
                value={notMetni}
                onChange={(e) => setNotMetni(e.target.value)}
                placeholder="Sipariş notu (isteğe bağlı — tüm sipariş için)"
                className="mt-3 w-full rounded-xl border border-cizgi-koyu bg-kart px-3 py-2.5 text-sm outline-none"
              />
            </div>

            {/* Sabit gönder çubuğu / tezgah ödeme adımı */}
            <div className="sticky bottom-0 -mx-5 mt-3.5 border-t border-cizgi bg-kart px-5 pb-8 pt-3 shadow-[0_-6px_16px_rgba(90,58,29,0.08)]">
              {tezgahOdeme ? (
                <div>
                  <p className="text-center text-[14.5px] font-extrabold text-metin-baslik">
                    {tezgahOdeme.siparisNo != null ? `#${tezgahOdeme.siparisNo} · ` : ""}
                    {tl(tezgahOdeme.tutar)} — ödeme nasıl alındı?
                  </p>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      onClick={() => tezgahOdemeAl("nakit")}
                      className="flex-1 rounded-2xl bg-basari p-3.5 text-[15px] font-extrabold text-white"
                    >
                      Nakit ✓
                    </button>
                    <button
                      onClick={() => tezgahOdemeAl("kart")}
                      className="flex-1 rounded-2xl bg-[#31639c] p-3.5 text-[15px] font-extrabold text-white"
                    >
                      Kart ✓
                    </button>
                    <button
                      onClick={() => tezgahOdemeAl(null)}
                      className="rounded-2xl border border-cizgi-koyu bg-kart px-3.5 py-3.5 text-[13.5px] font-bold text-metin-orta"
                    >
                      Sonra
                    </button>
                  </div>
                  <p className="mt-1.5 text-center text-[11.5px] text-metin-soluk">
                    &quot;Sonra&quot; dersen hesap Açık Hesaplar sekmesinde bekler.
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => manuelGonder(panelMasa?.id ?? null)}
                  disabled={manuelToplam <= 0 || gonderiliyor}
                  className={
                    "marka-gradyan w-full rounded-2xl p-4 text-[15.5px] font-extrabold text-white " +
                    (manuelToplam > 0 && !gonderiliyor
                      ? "shadow-[0_4px_14px_rgba(138,75,31,0.3)]"
                      : "cursor-default opacity-45")
                  }
                >
                  {gonderiliyor
                    ? "Gönderiliyor…"
                    : sepetAdet > 0
                      ? `Siparişi Gönder · ${sepetAdet} ürün · ${tl(manuelToplam)}`
                      : "Ürün seçin"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Ürün detayı: bilgi + opsiyonlar + ürün notu + sepete ekle (QR'daki gibi) */}
      {detayUrun && (
        <GarsonUrunDetay
          urun={detayUrun}
          kapat={() => setDetayUrun(null)}
          ekle={sepeteEkle}
        />
      )}
    </div>
  );
}

function GarsonUrunDetay({
  urun,
  kapat,
  ekle,
}: {
  urun: MenuUrun;
  kapat: () => void;
  ekle: (u: MenuUrun, adet: number, o: SecilenOpsiyon[], not?: string) => void;
}) {
  const [secimler, setSecimler] = useState<Record<string, MenuOpsiyon[]>>(() =>
    Object.fromEntries(
      urun.opsiyon_grubu.map((g) => {
        const sirali = [...g.opsiyon].sort((a, b) => a.sira - b.sira);
        return [g.id, g.min_secim >= 1 && sirali[0] ? [sirali[0]] : []];
      })
    )
  );
  const [adet, setAdet] = useState(1);
  const [urunNotu, setUrunNotu] = useState("");

  function sec(grupId: string, maxSecim: number, o: MenuOpsiyon) {
    setSecimler((s) => {
      const mevcut = s[grupId] ?? [];
      if (maxSecim === 1) return { ...s, [grupId]: [o] };
      const varMi = mevcut.some((x) => x.id === o.id);
      if (varMi) return { ...s, [grupId]: mevcut.filter((x) => x.id !== o.id) };
      if (mevcut.length >= maxSecim) return s;
      return { ...s, [grupId]: [...mevcut, o] };
    });
  }

  const eksikGrup = urun.opsiyon_grubu.find((g) => (secimler[g.id]?.length ?? 0) < g.min_secim);
  const ekToplam = Object.values(secimler).flat().reduce((t, o) => t + Number(o.ek_fiyat), 0);
  const tutar = (Number(urun.fiyat) + ekToplam) * adet;
  const klavye = useKlavyeYuksekligi();

  return (
    <div
      className="anim-fade fixed inset-0 z-40 flex items-end justify-center bg-[rgba(43,28,16,0.5)] sm:items-center sm:p-6"
      onClick={kapat}
    >
      <div
        className="anim-sheet kaydirmasiz w-full max-w-lg overflow-auto rounded-t-3xl bg-kart pb-0 sm:max-w-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxHeight: klavye > 0 ? `calc(100dvh - ${klavye + 8}px)` : "88dvh",
          marginBottom: klavye > 0 ? klavye : 0,
        }}
      >
        {urun.gorsel_url && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={urun.gorsel_url} alt={urun.ad} className="h-44 w-full object-cover" />
        )}
        <div className="px-5 pt-4">
          <div className="flex items-start gap-2.5">
            <span className="flex-1 font-serif text-[21px] font-semibold text-metin-baslik">
              {urun.ad}
            </span>
            <span className="text-[16px] font-extrabold text-marka-koyu">
              {tl(Number(urun.fiyat))}
            </span>
            <button
              onClick={kapat}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-krem-koyu text-[17px] text-marka-koyu"
            >
              ×
            </button>
          </div>
          {urun.aciklama && (
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-metin-orta">{urun.aciklama}</p>
          )}

          {urun.opsiyon_grubu.map((g) => (
            <fieldset key={g.id} className="mt-4">
              <legend className="text-sm font-extrabold text-metin-baslik">
                {g.min_secim >= 1 ? `${g.ad} (zorunlu)` : g.ad}
              </legend>
              <div className="mt-2 flex flex-col gap-[7px]">
                {[...g.opsiyon].sort((a, b) => a.sira - b.sira).map((o) => {
                  const secili = (secimler[g.id] ?? []).some((x) => x.id === o.id);
                  return (
                    <button
                      key={o.id}
                      onClick={() => sec(g.id, g.max_secim, o)}
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
                          style={{ border: secili ? "5.5px solid #c86f2c" : "2px solid #d8c9b4" }}
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

          <label className="mt-4 block">
            <span className="text-sm font-extrabold text-metin-baslik">
              Ürün notu <span className="font-semibold text-metin-soluk">(isteğe bağlı)</span>
            </span>
            <textarea
              value={urunNotu}
              onChange={(e) => setUrunNotu(e.target.value)}
              placeholder="Örn. az şekerli, soğuk süt…"
              rows={2}
              className="mt-1.5 w-full resize-none rounded-[14px] border border-cizgi-koyu bg-krem px-3.5 py-2.5 text-[15px] outline-none"
            />
          </label>
        </div>

        <div className="sticky bottom-0 mt-3 border-t border-cizgi bg-kart px-5 pb-8 pt-3">
          {eksikGrup && (
            <p className="mb-2 text-center text-xs font-semibold text-tehlike-yumusak">
              &quot;{eksikGrup.ad}&quot; seçimi zorunlu.
            </p>
          )}
          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-full border border-cizgi-koyu bg-krem">
              <button
                onClick={() => setAdet((a) => Math.max(1, a - 1))}
                className="h-11 w-11 text-xl text-marka-koyu"
              >
                −
              </button>
              <span className="min-w-5 text-center text-[15px] font-extrabold">{adet}</span>
              <button onClick={() => setAdet((a) => a + 1)} className="h-11 w-11 text-xl text-marka-koyu">
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
                  urunNotu.trim() || undefined
                )
              }
              className={
                "marka-gradyan flex-1 rounded-2xl px-4 py-3.5 text-[15.5px] font-extrabold text-white " +
                (eksikGrup ? "cursor-default opacity-45" : "shadow-[0_4px_14px_rgba(138,75,31,0.3)]")
              }
            >
              Sepete Ekle · {tl(tutar)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
