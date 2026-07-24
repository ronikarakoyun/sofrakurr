"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CikisButonu } from "@/components/CikisButonu";
import { useKullanici } from "@/lib/useKullanici";

interface PanelKafe {
  id: string;
  ad: string;
  slug: string;
  aktif: boolean;
  zincir_ad: string | null;
  secili: boolean;
}

// Üst panel: franchise sahibi zincirindeki kafeleri, platform sahibi (süper
// admin) tüm kafeleri görür; "Yönet" ile o kafenin admin bağlamına geçer.
export default function PanelSayfasi() {
  const router = useRouter();
  const { kullanici, yukleniyor } = useKullanici(["franchise", "super_admin"]);
  const supabase = createClient();

  const [kafeler, setKafeler] = useState<PanelKafe[]>([]);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [meskul, setMeskul] = useState<string | null>(null);
  const [zincirim, setZincirim] = useState<{
    id: string;
    ad: string;
    menu_kaynak_cafe_id: string | null;
    menu_kaynak_ad: string | null;
  } | null>(null);
  const [basari, setBasari] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    const { data, error } = await supabase.rpc("erisilebilir_kafeler");
    if (error) {
      setMesaj("Kafeler yüklenemedi: " + error.message);
      return;
    }
    setKafeler((data as PanelKafe[]) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (kullanici) yukle();
    if (kullanici?.rol === "franchise") {
      supabase.rpc("zincirim").then(({ data }) => {
        const z = (data as (typeof zincirim)[]) ?? [];
        setZincirim(z[0] ?? null);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kullanici, yukle]);

  async function kaynakAta(cafeId: string) {
    if (meskul || !cafeId) return;
    setMeskul("menu");
    setMesaj(null);
    const { error } = await supabase.rpc("zincir_menu_kaynak_ata", { p_cafe_id: cafeId });
    setMeskul(null);
    if (error) return setMesaj(error.message);
    setBasari("Ana şube atandı — menü şablonun artık bu şube");
    const { data } = await supabase.rpc("zincirim");
    setZincirim(((data as (typeof zincirim)[]) ?? [])[0] ?? null);
  }

  async function menuSenkronla() {
    if (meskul) return;
    if (!confirm("Ana şubenin menüsü zincirdeki TÜM şubelere uygulanacak. Devam?")) return;
    setMeskul("menu");
    setMesaj(null);
    const { data, error } = await supabase.rpc("zincir_menu_senkronla");
    setMeskul(null);
    if (error) return setMesaj(error.message);
    const ozet = data as { sube: number };
    setBasari(`Menü ${ozet?.sube ?? 0} şubeye uygulandı ✓`);
  }

  async function kafeyeGec(k: PanelKafe, hedef: "/admin" | "/kds") {
    if (meskul) return;
    setMeskul(k.id);
    const { error } = await supabase.rpc("kafe_sec_panel", { p_cafe_id: k.id });
    setMeskul(null);
    if (error) {
      setMesaj(error.message);
      return;
    }
    router.push(hedef);
  }

  if (yukleniyor || !kullanici) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-krem">
        <p className="animate-pulse text-metin-soluk">Yükleniyor…</p>
      </main>
    );
  }

  const superMi = kullanici.rol === "super_admin";

  return (
    <main className="min-h-dvh bg-krem px-5 pb-12 pt-6 text-metin">
      <div className="mx-auto max-w-[860px]">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="SofraKur" className="h-11 w-11 rounded-xl" />
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-2xl font-semibold text-metin-baslik">
              {superMi ? "SofraKur Platform" : "Zincir Paneli"}
            </h1>
            <p className="text-[13px] text-metin-soluk">
              {superMi
                ? "Tüm kafeler — yönetmek istediğine geç."
                : "Zincirine bağlı kafeler — yönetmek istediğine geç."}
            </p>
          </div>
          <CikisButonu />
        </div>

        {mesaj && (
          <p className="mt-4 rounded-xl bg-tehlike-zemin px-3.5 py-2.5 text-[13.5px] font-bold text-tehlike">
            {mesaj}
          </p>
        )}
        {basari && (
          <p className="mt-4 rounded-xl bg-basari-zemin px-3.5 py-2.5 text-[13.5px] font-bold text-basari">
            {basari}
          </p>
        )}

        {/* Franchise: zincir menüsü — ana şube şablonu + tüm şubelere uygula */}
        {kullanici.rol === "franchise" && zincirim && (
          <div className="mt-6 rounded-2xl border border-cizgi bg-kart p-4">
            <p className="text-sm font-extrabold text-metin-baslik">Zincir Menüsü</p>
            <p className="mt-0.5 text-[12.5px] text-metin-soluk">
              Menüyü ana şubede bir kez düzenle (&quot;Yönet&quot; → Menü), sonra tek tuşla tüm
              şubelere uygula. Şubelerin &quot;bitti&quot; işaretleri ve kilitli fiyatları korunur.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <select
                value={zincirim.menu_kaynak_cafe_id ?? ""}
                onChange={(e) => kaynakAta(e.target.value)}
                disabled={!!meskul}
                className="flex-1 rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2.5 text-sm outline-none"
              >
                <option value="">Ana şube seç…</option>
                {kafeler.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.ad}
                  </option>
                ))}
              </select>
              <button
                onClick={menuSenkronla}
                disabled={!!meskul || !zincirim.menu_kaynak_cafe_id}
                className="marka-gradyan rounded-xl px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-45"
              >
                {meskul === "menu" ? "Uygulanıyor…" : "Tüm Şubelere Uygula"}
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {kafeler.map((k) => (
            <div
              key={k.id}
              className={
                "rounded-2xl border bg-kart p-4 " +
                (k.secili ? "border-marka" : "border-cizgi")
              }
            >
              <div className="flex items-center gap-2">
                <span className="text-[16px] font-extrabold text-metin-baslik">{k.ad}</span>
                {k.secili && (
                  <span className="rounded-full bg-basari-zemin px-2 py-0.5 text-[10.5px] font-extrabold text-basari">
                    seçili
                  </span>
                )}
                {!k.aktif && (
                  <span className="rounded-full bg-tehlike-zemin px-2 py-0.5 text-[10.5px] font-extrabold text-tehlike">
                    pasif
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[12.5px] text-metin-soluk">
                {k.zincir_ad ?? "Bağımsız kafe"} · {k.slug}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => kafeyeGec(k, "/admin")}
                  disabled={!!meskul}
                  className="marka-gradyan flex-1 rounded-xl px-3 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-50"
                >
                  {meskul === k.id ? "Geçiliyor…" : "Yönet →"}
                </button>
                <button
                  onClick={() => kafeyeGec(k, "/kds")}
                  disabled={!!meskul}
                  className="rounded-xl border border-cizgi-koyu bg-kart px-3 py-2.5 text-[13px] font-bold text-metin-orta disabled:opacity-50"
                >
                  Mutfak
                </button>
              </div>
            </div>
          ))}
        </div>

        {kafeler.length === 0 && !mesaj && (
          <p className="mt-6 text-sm text-metin-soluk">Erişebildiğin kafe bulunamadı.</p>
        )}

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <Link
            href="/panel/rapor"
            className="rounded-2xl border border-cizgi bg-kart p-4 transition hover:border-marka"
          >
            <p className="text-sm font-extrabold text-metin-baslik">
              {superMi ? "Platform Raporu" : "Zincir Raporu"} →
            </p>
            <p className="mt-0.5 text-[12.5px] text-metin-soluk">
              Kafe kafe ciro, adisyon ve sipariş sayıları.
            </p>
          </Link>
          <Link
            href="/panel/hatalar"
            className="rounded-2xl border border-cizgi bg-kart p-4 transition hover:border-marka"
          >
            <p className="text-sm font-extrabold text-metin-baslik">Hata Kayıtları →</p>
            <p className="mt-0.5 text-[12.5px] text-metin-soluk">
              Canlıda oluşan istemci/sunucu hataları.
            </p>
          </Link>
          {superMi && (
            <>
              <Link
                href="/panel/yeni-kafe"
                className="rounded-2xl border border-cizgi bg-kart p-4 transition hover:border-marka"
              >
                <p className="text-sm font-extrabold text-metin-baslik">Yeni Kafe Aç →</p>
                <p className="mt-0.5 text-[12.5px] text-metin-soluk">
                  Kafe + yönetici hesabı + masalar tek adımda.
                </p>
              </Link>
              <Link
                href="/panel/zincirler"
                className="rounded-2xl border border-cizgi bg-kart p-4 transition hover:border-marka"
              >
                <p className="text-sm font-extrabold text-metin-baslik">Zincirler &amp; Franchise →</p>
                <p className="mt-0.5 text-[12.5px] text-metin-soluk">
                  Zincir aç, kafeleri bağla, franchise girişi ver.
                </p>
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
