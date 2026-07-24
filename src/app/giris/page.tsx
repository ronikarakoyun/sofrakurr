"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createClient,
  createGirisClient,
  beniHatirla,
  HATIRLA_ANAHTARI,
} from "@/lib/supabase/client";

const ROL_SAYFA: Record<string, string> = {
  admin: "/admin",
  kasa: "/kds", // kasa ekranı emekli: tezgah personeli de mutfak ekranını kullanır
  mutfak: "/kds",
  franchise: "/panel",
  super_admin: "/panel",
};

function GirisIcerik() {
  const router = useRouter();
  const arama = useSearchParams();
  const pasif = arama.get("pasif") === "1";
  const [eposta, setEposta] = useState("");
  const [sifre, setSifre] = useState("");
  const [hatirla, setHatirla] = useState(true);
  const [hata, setHata] = useState<string | null>(
    pasif ? "Hesabınız pasife alınmış. Yöneticinize başvurun." : null
  );
  const [bekliyor, setBekliyor] = useState(false);
  const [oturumKontrol, setOturumKontrol] = useState(!pasif);

  // Oturum zaten açıksa şifre sormadan doğrudan rol sayfasına geç
  // ("Beni hatırla" deneyimi). Pasif yönlendirmesinde oturum zaten kapatıldı.
  useEffect(() => {
    setHatirla(beniHatirla());
    if (pasif) return;
    let iptal = false;
    const supabase = createClient();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (iptal) return;
      if (!user) {
        setOturumKontrol(false);
        return;
      }
      const { data: kayit } = await supabase
        .from("kullanici")
        .select("rol, aktif")
        .eq("id", user.id)
        .single();
      if (iptal) return;
      if (kayit && kayit.aktif !== false) {
        router.replace(ROL_SAYFA[kayit.rol] ?? "/");
        return;
      }
      setOturumKontrol(false);
    })();
    return () => { iptal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function hatirlaDegistir(deger: boolean) {
    setHatirla(deger);
    try {
      window.localStorage.setItem(HATIRLA_ANAHTARI, deger ? "1" : "0");
    } catch {
      /* localStorage kapalıysa tercih kaydedilemez, giriş yine çalışır */
    }
  }

  async function girisYap(e: React.FormEvent) {
    e.preventDefault();
    setHata(null);
    setBekliyor(true);
    const supabase = createGirisClient(hatirla);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: eposta,
      password: sifre,
    });
    if (error || !data.user) {
      setHata("E-posta veya şifre hatalı.");
      setBekliyor(false);
      return;
    }
    const { data: kayit } = await supabase
      .from("kullanici")
      .select("rol, aktif")
      .eq("id", data.user.id)
      .single();
    if (!kayit) {
      setHata("Bu hesaba personel rolü tanımlanmamış.");
      await supabase.auth.signOut();
      setBekliyor(false);
      return;
    }
    if (kayit.aktif === false) {
      setHata("Hesabınız pasife alınmış. Yöneticinize başvurun.");
      await supabase.auth.signOut();
      setBekliyor(false);
      return;
    }
    router.replace(ROL_SAYFA[kayit.rol] ?? "/");
  }

  if (oturumKontrol) {
    return (
      <main className="flex flex-1 items-center justify-center bg-krem p-6">
        <p className="text-sm font-semibold text-metin-soluk">
          Oturum kontrol ediliyor…
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-krem p-6">
      <form onSubmit={girisYap} className="w-full max-w-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="SofraKur logosu"
          className="mx-auto h-14 w-14 rounded-2xl shadow-[0_6px_18px_rgba(138,75,31,0.3)]"
        />
        <h1 className="mt-4 text-center font-serif text-2xl font-semibold text-metin-baslik">
          Personel Girişi
        </h1>
        <p className="mt-1 text-center text-[13px] text-metin-soluk">SofraKur</p>
        <div className="mt-6 space-y-3">
          <input
            type="email"
            required
            value={eposta}
            onChange={(e) => setEposta(e.target.value)}
            placeholder="E-posta"
            className="w-full rounded-xl border border-cizgi-koyu bg-kart px-3.5 py-3 text-sm outline-none focus:border-marka"
          />
          <input
            type="password"
            required
            value={sifre}
            onChange={(e) => setSifre(e.target.value)}
            placeholder="Şifre"
            className="w-full rounded-xl border border-cizgi-koyu bg-kart px-3.5 py-3 text-sm outline-none focus:border-marka"
          />
        </div>
        <label className="mt-4 flex cursor-pointer items-center gap-2.5 px-1 text-sm font-semibold text-metin-orta">
          <input
            type="checkbox"
            checked={hatirla}
            onChange={(e) => hatirlaDegistir(e.target.checked)}
            className="h-4.5 w-4.5 accent-marka"
          />
          Beni hatırla
        </label>
        <p className="mt-1 px-1 text-xs text-metin-soluk">
          {hatirla
            ? "Bu cihazda tekrar şifre sorulmaz."
            : "Oturum 12 saat sonra kapanır (ortak cihazlar için)."}
        </p>
        {hata && <p className="mt-3 text-sm font-semibold text-tehlike">{hata}</p>}
        <button
          type="submit"
          disabled={bekliyor}
          className="marka-gradyan mt-4 w-full rounded-xl p-3.5 text-[15px] font-extrabold text-white shadow-[0_6px_18px_rgba(138,75,31,0.25)] disabled:opacity-50"
        >
          {bekliyor ? "Giriş yapılıyor…" : "Giriş Yap"}
        </button>
      </form>
    </main>
  );
}

export default function GirisPage() {
  return (
    <Suspense fallback={<main className="flex flex-1 items-center justify-center bg-krem" />}>
      <GirisIcerik />
    </Suspense>
  );
}
