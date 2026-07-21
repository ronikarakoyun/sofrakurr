"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useKullanici } from "@/lib/useKullanici";

interface Zincir {
  id: string;
  ad: string;
  kafe_sayisi: number;
  franchise_adlari: string | null;
  menu_kaynak_cafe_id: string | null;
  menu_kaynak_ad: string | null;
}

interface KafeSatir {
  cafe_id: string;
  cafe_ad: string;
  cafe_aktif: boolean;
  zincir_id: string | null;
}

const ALAN = "rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2.5 text-sm outline-none";

// Zincir & franchise yönetimi (yalnız süper admin): zincir aç, kafeleri
// zincire bağla, zincir sahibine franchise girişi ver. Franchise hesabı
// /panel'de yalnız kendi zincirindeki kafeleri görür ve yönetir.
export default function ZincirlerSayfasi() {
  const { kullanici, yukleniyor } = useKullanici(["super_admin"]);
  const supabase = createClient();

  const [zincirler, setZincirler] = useState<Zincir[]>([]);
  const [kafeler, setKafeler] = useState<KafeSatir[]>([]);
  const [yeniZincirAd, setYeniZincirAd] = useState("");
  const [frAd, setFrAd] = useState("");
  const [frEposta, setFrEposta] = useState("");
  const [frSifre, setFrSifre] = useState("");
  const [frZincirId, setFrZincirId] = useState("");
  const [meskul, setMeskul] = useState(false);
  const [mesaj, setMesaj] = useState<{ metin: string; hata: boolean } | null>(null);

  const yukle = useCallback(async () => {
    const [z, k] = await Promise.all([
      supabase.rpc("zincir_listesi"),
      supabase.rpc("kafe_zincir_listesi"),
    ]);
    if (z.error || k.error) {
      setMesaj({ metin: (z.error ?? k.error)!.message, hata: true });
      return;
    }
    setZincirler((z.data as Zincir[]) ?? []);
    setKafeler((k.data as KafeSatir[]) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (kullanici) yukle();
  }, [kullanici, yukle]);

  async function zincirEkle() {
    if (meskul || !yeniZincirAd.trim()) return;
    setMeskul(true);
    setMesaj(null);
    const { error } = await supabase.rpc("zincir_olustur", { p_ad: yeniZincirAd.trim() });
    setMeskul(false);
    if (error) {
      setMesaj({ metin: error.message, hata: true });
      return;
    }
    setYeniZincirAd("");
    setMesaj({ metin: "Zincir oluşturuldu", hata: false });
    yukle();
  }

  async function kafeAta(cafeId: string, zincirId: string) {
    if (meskul) return;
    setMeskul(true);
    setMesaj(null);
    const { error } = await supabase.rpc("kafe_zincire_ata", {
      p_cafe_id: cafeId,
      p_zincir_id: zincirId || null,
    });
    setMeskul(false);
    if (error) {
      setMesaj({ metin: error.message, hata: true });
      return;
    }
    yukle();
  }

  async function kaynakAta(zincirId: string, cafeId: string) {
    if (meskul || !cafeId) return;
    setMeskul(true);
    setMesaj(null);
    const { error } = await supabase.rpc("zincir_menu_kaynak_ata", {
      p_cafe_id: cafeId,
      p_zincir_id: zincirId,
    });
    setMeskul(false);
    if (error) return setMesaj({ metin: error.message, hata: true });
    setMesaj({ metin: "Ana şube atandı — artık menü şablonu bu şube", hata: false });
    yukle();
  }

  async function menuSenkronla(zincirId: string) {
    if (meskul) return;
    if (!confirm("Ana şubenin menüsü zincirdeki TÜM şubelere uygulanacak. Devam?")) return;
    setMeskul(true);
    setMesaj(null);
    const { data, error } = await supabase.rpc("zincir_menu_senkronla", {
      p_zincir_id: zincirId,
    });
    setMeskul(false);
    if (error) return setMesaj({ metin: error.message, hata: true });
    const ozet = data as { sube: number };
    setMesaj({ metin: `Menü ${ozet?.sube ?? 0} şubeye uygulandı ✓`, hata: false });
  }

  async function franchiseAc() {
    if (meskul) return;
    setMeskul(true);
    setMesaj(null);
    const yanit = await fetch("/api/platform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        islem: "franchise",
        ad: frAd,
        eposta: frEposta,
        sifre: frSifre,
        zincirId: frZincirId,
      }),
    });
    const veri = await yanit.json().catch(() => ({}));
    setMeskul(false);
    if (!yanit.ok) {
      setMesaj({ metin: veri.hata ?? "Hesap açılamadı", hata: true });
      return;
    }
    setFrAd("");
    setFrEposta("");
    setFrSifre("");
    setMesaj({ metin: "Franchise hesabı açıldı — bu e-posta ve şifreyle giriş yapabilir", hata: false });
    yukle();
  }

  if (yukleniyor || !kullanici) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-krem">
        <p className="animate-pulse text-metin-soluk">Yükleniyor…</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-krem px-5 pb-12 pt-6 text-metin">
      <div className="mx-auto max-w-[720px]">
        <Link href="/panel" className="text-[13px] font-bold text-metin-soluk">
          ← Panele dön
        </Link>
        <h1 className="mt-2 font-serif text-2xl font-semibold text-metin-baslik">
          Zincirler &amp; Franchise
        </h1>
        <p className="mt-1 text-[13px] text-metin-soluk">
          Zincir aç, kafeleri bağla, zincir sahibine giriş hesabı ver. Franchise hesabı
          panelde yalnız kendi zincirindeki kafeleri görür.
        </p>

        {mesaj && (
          <p
            className={
              "mt-4 rounded-xl px-3.5 py-2.5 text-[13.5px] font-bold " +
              (mesaj.hata ? "bg-tehlike-zemin text-tehlike" : "bg-basari-zemin text-basari")
            }
          >
            {mesaj.metin}
          </p>
        )}

        {/* Zincirler */}
        <div className="mt-5 rounded-2xl border border-cizgi bg-kart p-4">
          <h2 className="text-sm font-extrabold text-metin-baslik">Zincirler</h2>
          {zincirler.length === 0 && (
            <p className="mt-2 text-[13px] text-metin-soluk">Henüz zincir yok.</p>
          )}
          <div className="mt-3 flex flex-col gap-1.5">
            {zincirler.map((z) => (
              <div key={z.id} className="rounded-xl border border-cizgi bg-krem px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-sm font-extrabold text-metin-baslik">{z.ad}</span>
                  <span className="text-[12px] font-bold text-metin-soluk">
                    {z.kafe_sayisi} kafe
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] text-metin-soluk">
                  {z.franchise_adlari
                    ? "Sahip: " + z.franchise_adlari
                    : "Henüz franchise hesabı yok"}
                </p>
                {/* Zincir menüsü: ana şube (şablon) + tüm şubelere uygula */}
                <div className="mt-2.5 flex items-center gap-2 border-t border-dashed border-cizgi-koyu pt-2.5">
                  <span className="text-[12px] font-bold text-metin-soluk">Menü şablonu:</span>
                  <select
                    value={z.menu_kaynak_cafe_id ?? ""}
                    onChange={(e) => kaynakAta(z.id, e.target.value)}
                    disabled={meskul}
                    className={ALAN + " flex-1 py-1.5 text-[12.5px]"}
                  >
                    <option value="">Ana şube seç…</option>
                    {kafeler
                      .filter((k) => k.zincir_id === z.id)
                      .map((k) => (
                        <option key={k.cafe_id} value={k.cafe_id}>
                          {k.cafe_ad}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => menuSenkronla(z.id)}
                    disabled={meskul || !z.menu_kaynak_cafe_id}
                    className="marka-gradyan rounded-lg px-3 py-1.5 text-[12px] font-extrabold text-white disabled:opacity-45"
                  >
                    Tüm Şubelere Uygula
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={yeniZincirAd}
              onChange={(e) => setYeniZincirAd(e.target.value)}
              placeholder="Yeni zincir adı (örn. BUTİKEK)"
              className={ALAN + " flex-1"}
            />
            <button
              onClick={zincirEkle}
              disabled={meskul}
              className="marka-gradyan rounded-xl px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-60"
            >
              Ekle
            </button>
          </div>
        </div>

        {/* Kafe atamaları */}
        <div className="mt-4 rounded-2xl border border-cizgi bg-kart p-4">
          <h2 className="text-sm font-extrabold text-metin-baslik">Kafe atamaları</h2>
          <div className="mt-3 flex flex-col gap-1.5">
            {kafeler.map((k) => (
              <div key={k.cafe_id} className="flex items-center gap-2">
                <span className={"flex-1 text-sm font-bold " + (k.cafe_aktif ? "" : "opacity-55")}>
                  {k.cafe_ad}
                </span>
                <select
                  value={k.zincir_id ?? ""}
                  onChange={(e) => kafeAta(k.cafe_id, e.target.value)}
                  disabled={meskul}
                  className={ALAN + " w-48"}
                >
                  <option value="">Bağımsız</option>
                  {zincirler.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.ad}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* Franchise hesabı */}
        <div className="mt-4 rounded-2xl border border-cizgi bg-kart p-4">
          <h2 className="text-sm font-extrabold text-metin-baslik">Franchise hesabı aç</h2>
          <p className="mt-0.5 text-[12px] text-metin-soluk">
            Zincir sahibinin giriş hesabı — /panel&apos;den zincirindeki tüm kafeleri yönetir.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input value={frAd} onChange={(e) => setFrAd(e.target.value)} placeholder="Ad Soyad" className={ALAN} />
            <select value={frZincirId} onChange={(e) => setFrZincirId(e.target.value)} className={ALAN}>
              <option value="">Zincir seç…</option>
              {zincirler.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.ad}
                </option>
              ))}
            </select>
            <input
              value={frEposta}
              onChange={(e) => setFrEposta(e.target.value)}
              placeholder="E-posta (girişte kullanılır)"
              inputMode="email"
              autoCapitalize="none"
              className={ALAN}
            />
            <input
              value={frSifre}
              onChange={(e) => setFrSifre(e.target.value)}
              placeholder="Şifre (en az 8 karakter)"
              className={ALAN}
            />
          </div>
          <button
            onClick={franchiseAc}
            disabled={meskul}
            className="marka-gradyan mt-3 rounded-xl px-5 py-2.5 text-sm font-extrabold text-white disabled:opacity-60"
          >
            {meskul ? "Açılıyor…" : "Hesap Aç"}
          </button>
        </div>
      </div>
    </main>
  );
}
