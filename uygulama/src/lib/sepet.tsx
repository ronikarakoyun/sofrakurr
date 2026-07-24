import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import type { Kategori, SecilenOpsiyon, SepetKalemi, Urun } from "./tipler";

const SEPET_ANAHTAR = "sofrakur-sepet";
const KAFE_ANAHTAR = "sofrakur-secili-kafe";

export interface Kafe {
  id: string;
  ad: string;
  slug: string;
  il?: string | null;
  ilce?: string | null;
  enlem?: number | null;
  boylam?: number | null;
}

interface SepetDurumu {
  kafeler: Kafe[];
  seciliKafe: Kafe | null;
  menu: Kategori[];
  sepet: SepetKalemi[];
  menuYukleniyor: boolean;
  // Kafeler sekmesinden kafe seçimi: menüsünü yükler;
  // farklı kafeye geçilirse sepet sıfırlanır.
  kafeSec: (kafe: Kafe | null) => void;
  sepeteEkle: (urun: Urun, adet: number, opsiyonlar: SecilenOpsiyon[], not?: string) => void;
  sepetGuncelle: (index: number, adet: number) => void;
  sepetCikar: (index: number) => void;
  sepetTemizle: () => void;
  // p_puan: 10'un katı; 10 puan = 1 TL indirim (sunucu doğrular)
  siparisVer: (not: string, puan: number) => Promise<string | null>;
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
  const [menu, setMenu] = useState<Kategori[]>([]);
  const [sepet, setSepet] = useState<SepetKalemi[]>([]);
  const [menuYukleniyor, setMenuYukleniyor] = useState(false);
  const tekrarBekleyen = useRef<TekrarKalem[] | null>(null);

  // Sistemdeki aktif kafeler (anon vitrin policy'si yalnız zararsız kolonları açar)
  useEffect(() => {
    supabase
      .from("cafe")
      .select("id, ad, slug, il, ilce, enlem, boylam")
      .eq("aktif", true)
      .order("ad")
      .then(({ data }) => setKafeler((data as Kafe[]) ?? []));
  }, []);

  // Son seçilen kafe + sepeti geri yükle (uygulama kapanıp açılınca)
  useEffect(() => {
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

  // Kafe seçimi: kafe değişirse sepet sıfırlanır; menü yüklenince bekleyen
  // "aynısını tekrar" kalemleri otomatik uygulanır
  const kafeSec = useCallback(
    (kafe: Kafe | null) => {
      if (kafe && seciliKafe && kafe.id !== seciliKafe.id) {
        setSepet([]);
      }
      setSeciliKafe(kafe);
      if (kafe) {
        // "hangi kafedeydim" uygulama kapanınca da hatırlansın
        AsyncStorage.setItem(KAFE_ANAHTAR, JSON.stringify(kafe));
        menuYukle(kafe.id).then((guncelMenu) => {
          if (tekrarBekleyen.current) {
            tekrarUygula(tekrarBekleyen.current, guncelMenu);
            tekrarBekleyen.current = null;
          }
        });
      } else {
        AsyncStorage.removeItem(KAFE_ANAHTAR);
        setMenu([]);
      }
    },
    [seciliKafe, menuYukle, tekrarUygula]
  );

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
    async (not: string, puan: number): Promise<string | null> => {
      if (!sepet.length) return "Sepet boş.";
      if (!seciliKafe) return "Önce Kafeler sekmesinden kafeni seç.";
      const kalemler = sepet.map((k) => ({
        urun_id: k.urun.id,
        adet: k.adet,
        opsiyonlar: k.opsiyonlar,
        not: k.not ?? null,
      }));

      const sonuc = await supabase.rpc("musteri_siparis_olustur", {
        p_cafe_id: seciliKafe.id,
        p_kalemler: kalemler,
        p_musteri_notu: not.trim() || null,
        p_puan: puan,
      });
      if (sonuc.error) return sonuc.error.message;
      setSepet([]);
      return null;
    },
    [sepet, seciliKafe]
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
        menu,
        sepet,
        menuYukleniyor,
        kafeSec,
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
