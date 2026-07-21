import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";

// Tek oturum dinleyicisi: giriş ekranı ve sekmeler aynı kaynaktan beslenir.
interface OturumDurumu {
  oturum: Session | null;
  yukleniyor: boolean;
}

const OturumBaglami = createContext<OturumDurumu>({ oturum: null, yukleniyor: true });

export function OturumSaglayici({ children }: { children: React.ReactNode }) {
  const [oturum, setOturum] = useState<Session | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setOturum(data.session);
      setYukleniyor(false);
    });
    const { data: abonelik } = supabase.auth.onAuthStateChange((_olay, yeni) => {
      setOturum(yeni);
    });
    return () => abonelik.subscription.unsubscribe();
  }, []);

  return (
    <OturumBaglami.Provider value={{ oturum, yukleniyor }}>
      {children}
    </OturumBaglami.Provider>
  );
}

export function useOturum() {
  return useContext(OturumBaglami);
}
