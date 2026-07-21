import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import type { Kategori, MasaOturumu, SecilenOpsiyon, SepetKalemi, Urun } from "./tipler";

const OTURUM_ANAHTAR = "sofrakur-masa-oturumu";
const SEPET_ANAHTAR = "sofrakur-sepet";
const KAFE_ANAHTAR = "sofrakur-secili-kafe";

export interface Kafe {
  id: string;
  ad: string;
  slug: string;
  // false = self-servis: masa adımı yok, sipariş numarayla tezgahtan alınır
  masa_duzeni: boolean;
  il?: string | null;
  ilce?: string | null;
  enlem?: number | null;
  boylam?: number | null;
}

interface SepetDurumu {
  kafeler: Kafe[];
  seciliKafe: Kafe | null;
  oturum: MasaOturumu | null;
  menu: Kategori[];
  sepet: SepetKalemi[];
  menuYukleniyor: boolean;
  // Kafeler sekmesinden kafe seçimi: menüsünü yükler (masa gerekmez);
  // farklı kafeye geçilirse sepet ve masa oturumu sıfırlanır.
  kafeSec: (kafe: Kafe | null) => void;
  // Manuel seçilen masa için oturum açar; hata mesajı döndürür (yoksa null)
  masaSec: (masaId: string) => Promise<string | null>;
  // Masayı bırak (masa değiştirme): sepet korunur, yalnız oturum düşer
  masaBirak: () => void;
  oturumKapat: () => void;
  sepeteEkle: (urun: Urun, adet: number, opsiyonlar: SecilenOpsiyon[], not?: string) => void;
  sepetGuncelle: (index: number, adet: number) => void;
  sepetCikar: (index: number) => void;
  sepetTemizle: () => void;
  siparisVer: (not: string) => Promise<string | null>;
  // "Aynısını tekrar": geçmişten gelen kalemleri sepete koymayı dener; menü yoksa
  // kuyruğa alır ve menü yüklenince otomatik ekler.
  tekrarKuyrukla: (kalemler: TekrarKalem[]) => void;
}

export interface TekrarKalem {
  urun_id: string;
  adet: number;
  opsiyonlar: SecilenOpsiyon[];
  not: string | null;
}

const Baglam = createContext<SepetDurumu | null>(null);

export function SepetSaglayici({ children }: { children: React.ReactNode }) {
  const [kafeler, setKafeler] = useState<Kafe[]>([]);
  const [seciliKafe, setSeciliKafe] = useState<Kafe | null>(null);
  const [oturum, setOturum] = useState<MasaOturumu | null>(null);
  const [menu, setMenu] = useState<Kategori[]>([]);
  const [sepet, setSepet] = useState<SepetKalemi[]>([]);
  const [menuYukleniyor, setMenuYukleniyor] = useState(false);
  const tekrarBekleyen = useRef<TekrarKalem[] | null>(null);

  // Sistemdeki aktif kafeler (anon vitrin policy'si yalnız zararsız kolonları açar)
  useEffect(() => {
    supabase
      .from("cafe")
      .select("id, ad, slug, masa_duzeni, il, ilce, enlem, boylam")
      .eq("aktif", true)
      .order("ad")
      .then(({ data }) => setKafeler((data as Kafe[]) ?? []));
  }, []);

  // Kaydedilmiş masa oturumu + sepeti geri yükle (uygulama kapanıp açılınca)
  useEffect(() => {
    AsyncStorage.getItem(OTURUM_ANAHTAR).then((ham) => {
      if (!ham) {
        // masa oturumu yoksa (self-servis) son seçilen kafeyi geri yükle
        AsyncStorage.getItem(KAFE_ANAHTAR).then((kham) => {
          if (!kham) return;
          try {
            const k = JSON.parse(kham) as Kafe;
            setSeciliKafe(k);
            menuYukle(k.id);
          } catch {
            AsyncStorage.removeItem(KAFE_ANAHTAR);
          }
        });
        return;
      }
      const o = JSON.parse(ham) as MasaOturumu;
      if (o.bitis > Date.now() + 5 * 60_000) {
        setOturum(o);
          setSeciliKafe({ id: o.cafe_id, ad: o.cafe_ad, slug: "", masa_duzeni: true });
        menuYukle(o.cafe_id);
      } else {
        AsyncStorage.removeItem(OTURUM_ANAHTAR);
      }
    });
    AsyncStorage.getItem(SEPET_ANAHTAR).then((ham) => {
      if (!ham) return;
      try {
        const s = JSON.parse(ham) as SepetKalemi[];
        if (Array.isArray(s) && s.length) setSepet(s);
      } catch {
        AsyncStorage.removeItem(SEPET_ANAHTAR);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sepet her değiştiğinde sakla (fiyatlar yine de sunucuda doğrulanır)
  useEffect(() => {
    if (sepet.length) AsyncStorage.setItem(SEPET_ANAHTAR, JSON.stringify(sepet));
    else AsyncStorage.removeItem(SEPET_ANAHTAR);
  }, [sepet]);

  const menuYukle = useCallback(async (cafeId: string) => {
    setMenuYukleniyor(true);
    const { data } = await supabase
      .from("kategori")
      .select(
        "id, ad, sira, aktif, urun(id, ad, aciklama, fiyat, gorsel_url, aktif, sira, kampanya, " +
          "opsiyon_grubu(id, ad, min_secim, max_secim, sira, opsiyon(id, ad, ek_fiyat, aktif, sira)))"
      )
      .eq("cafe_id", cafeId)
      .order("sira");
    const kategoriler = ((data ?? []) as unknown as Kategori[])
      .filter((k) => k.aktif)
      .map((k) => ({
        ...k,
        urun: [...k.urun]
          .filter((u) => u.aktif)
          .sort((a, b) => a.sira - b.sira)
          .map((u) => ({
            ...u,
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
    setMenuYukleniyor(false);
    return kategoriler;
  }, []);

  // Bekleyen "aynısını tekrar" kalemlerini yüklü menüye göre sepete ekler
  const tekrarUygula = useCallback((kalemler: TekrarKalem[], guncelMenu: Kategori[]) => {
    const tumUrunler = guncelMenu.flatMap((k) => k.urun);
    const yeni: SepetKalemi[] = [];
    let atlanan = 0;
    for (const k of kalemler) {
      const urun = tumUrunler.find((u) => u.id === k.urun_id);
      if (urun) {
        yeni.push({ urun, adet: k.adet, opsiyonlar: k.opsiyonlar, not: k.not ?? undefined });
      } else {
        atlanan++;
      }
    }
    if (yeni.length) setSepet((s) => [...s, ...yeni]);
    return atlanan;
  }, []);

  const masaSec = useCallback(
    async (masaId: string): Promise<string | null> => {
      const { data, error } = await supabase.rpc("masa_sec", { p_masa_id: masaId });
      if (error || !data?.[0]) return "Masa seçilemedi — lütfen tekrar dene.";
      const cafe = await supabase
        .from("cafe")
        .select("odeme_modu")
        .eq("id", data[0].cafe_id)
        .single();
      const yeni: MasaOturumu = {
        token: data[0].oturum_token,
        cafe_id: data[0].cafe_id,
        cafe_ad: data[0].cafe_ad,
        masa_id: data[0].masa_id,
        masa_ad: data[0].masa_ad,
        odeme_modu: (cafe.data?.odeme_modu as MasaOturumu["odeme_modu"]) ?? "once_odeme",
        bitis: Date.now() + 3 * 60 * 60_000,
      };
      // farklı kafenin masası okunduysa önceki kafenin sepeti geçersiz
      setSepet((s) => (seciliKafe && seciliKafe.id !== yeni.cafe_id ? [] : s));
      await AsyncStorage.setItem(OTURUM_ANAHTAR, JSON.stringify(yeni));
      setOturum(yeni);
      setSeciliKafe({ id: yeni.cafe_id, ad: yeni.cafe_ad, slug: "", masa_duzeni: true });
      const guncelMenu = await menuYukle(yeni.cafe_id);
      // masa okununca bekleyen "aynısını tekrar" varsa uygula
      if (tekrarBekleyen.current) {
        tekrarUygula(tekrarBekleyen.current, guncelMenu);
        tekrarBekleyen.current = null;
      }
      return null;
    },
    [menuYukle, tekrarUygula, seciliKafe]
  );

  // Kafe seçimi (masasız menü gezinme): kafe değişirse sepet + masa sıfırlanır
  const kafeSec = useCallback(
    (kafe: Kafe | null) => {
      if (kafe && seciliKafe && kafe.id !== seciliKafe.id) {
        setSepet([]);
        setOturum(null);
        AsyncStorage.removeItem(OTURUM_ANAHTAR);
      }
      setSeciliKafe(kafe);
      if (kafe) {
        // self-serviste "hangi kafedeydim" uygulama kapanınca da hatırlansın
        AsyncStorage.setItem(KAFE_ANAHTAR, JSON.stringify(kafe));
        menuYukle(kafe.id);
      } else {
        AsyncStorage.removeItem(KAFE_ANAHTAR);
        setMenu([]);
      }
    },
    [seciliKafe, menuYukle]
  );

  function masaBirak() {
    AsyncStorage.removeItem(OTURUM_ANAHTAR);
    setOturum(null);
  }

  function oturumKapat() {
    AsyncStorage.removeItem(OTURUM_ANAHTAR);
    setOturum(null);
    setSepet([]);
  }

  function sepeteEkle(urun: Urun, adet: number, opsiyonlar: SecilenOpsiyon[], not?: string) {
    setSepet((s) => [...s, { urun, adet, opsiyonlar, not: not?.trim() || undefined }]);
  }
  function sepetGuncelle(index: number, adet: number) {
    setSepet((s) => s.map((x, j) => (j === index ? { ...x, adet: Math.max(1, adet) } : x)));
  }
  function sepetCikar(index: number) {
    setSepet((s) => s.filter((_, j) => j !== index));
  }
  function sepetTemizle() {
    setSepet([]);
  }

  const siparisVer = useCallback(
    async (not: string): Promise<string | null> => {
      if (!sepet.length) return "Sepet boş.";
      const kalemler = sepet.map((k) => ({
        urun_id: k.urun.id,
        adet: k.adet,
        opsiyonlar: k.opsiyonlar,
        not: k.not ?? null,
      }));

      // Self-servis kafe: masa oturumu yok, sipariş doğrudan kafeye gider
      if (seciliKafe && !seciliKafe.masa_duzeni) {
        const sonuc = await supabase.rpc("musteri_siparis_olustur", {
          p_cafe_id: seciliKafe.id,
          p_kalemler: kalemler,
          p_musteri_notu: not.trim() || null,
        });
        if (sonuc.error) return sonuc.error.message;
        setSepet([]);
        return null;
      }

      if (!oturum) return "Sepet boş.";
      const sonuc = await supabase.rpc("siparis_olustur", {
        p_token: oturum.token,
        p_kalemler: kalemler,
        p_musteri_notu: not.trim() || null,
      });
      if (sonuc.error) {
        // Oturum düşmüşse tekrar okutma iste (elimizde QR kodu kalmadı)
        if (sonuc.error.message.includes("Oturum")) {
          oturumKapat();
          return "Masa oturumun sona ermiş. Lütfen masadaki QR'ı tekrar okut.";
        }
        return sonuc.error.message;
      }
      setSepet([]);
      return null;
    },
    [oturum, sepet, seciliKafe]
  );

  const tekrarKuyrukla = useCallback(
    (kalemler: TekrarKalem[]) => {
      if (menu.length) {
        tekrarUygula(kalemler, menu);
      } else {
        tekrarBekleyen.current = kalemler;
      }
    },
    [menu, tekrarUygula]
  );

  return (
    <Baglam.Provider
      value={{
        kafeler,
        seciliKafe,
        oturum,
        menu,
        sepet,
        menuYukleniyor,
        kafeSec,
        masaSec,
        masaBirak,
        oturumKapat,
        sepeteEkle,
        sepetGuncelle,
        sepetCikar,
        sepetTemizle,
        siparisVer,
        tekrarKuyrukla,
      }}
    >
      {children}
    </Baglam.Provider>
  );
}

export function useSepet() {
  const b = useContext(Baglam);
  if (!b) throw new Error("useSepet, SepetSaglayici içinde kullanılmalı");
  return b;
}
