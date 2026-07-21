"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Siparis, SiparisDurum } from "@/lib/types";

const SORGU =
  "id, adisyon_id, durum, musteri_notu, created_at, siparis_no, masa(ad), " +
  "siparis_kalemi(id, urun_id, urun_ad, birim_fiyat, adet, secilen_opsiyonlar, opsiyon_ek_fiyat, reddedildi, red_nedeni, ikram, istasyon, hazir, kalem_notu)";

// Kasa ve KDS için sipariş akışı: Supabase realtime dinler,
// kafe Wi-Fi'ı koptuğunda diye her 10 sn'de bir de kendisi yeniler (polling yedeği).
export function useSiparisler(durumlar: SiparisDurum[], yeniSiparisCb?: () => void) {
  const [siparisler, setSiparisler] = useState<Siparis[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const bilinenler = useRef<Set<string>>(new Set());
  const ilkYukleme = useRef(true);
  const cbRef = useRef(yeniSiparisCb);
  cbRef.current = yeniSiparisCb;

  const yenile = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("siparis")
      .select(SORGU)
      .in("durum", durumlar)
      .order("created_at", { ascending: true });
    if (error) return;
    const liste = (data ?? []) as unknown as Siparis[];
    const yeniVar = liste.some((s) => !bilinenler.current.has(s.id));
    liste.forEach((s) => bilinenler.current.add(s.id));
    if (yeniVar && !ilkYukleme.current) cbRef.current?.();
    ilkYukleme.current = false;
    setSiparisler(liste);
    setYukleniyor(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(durumlar)]);

  useEffect(() => {
    const supabase = createClient();
    yenile();

    const kanal = supabase
      .channel("siparis-akisi")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "siparis" },
        () => yenile()
      )
      .subscribe();

    const zamanlayici = setInterval(yenile, 10_000);
    // Sekme uykuya alınınca tarayıcı interval'ı kısar ve realtime kopar;
    // öne gelince / internet dönünce anında tazele (bayat sipariş listesi kalmasın)
    const tazele = () => { if (document.visibilityState === "visible") yenile(); };
    document.addEventListener("visibilitychange", tazele);
    window.addEventListener("online", tazele);
    return () => {
      supabase.removeChannel(kanal);
      clearInterval(zamanlayici);
      document.removeEventListener("visibilitychange", tazele);
      window.removeEventListener("online", tazele);
    };
  }, [yenile]);

  return { siparisler, yukleniyor, yenile };
}
