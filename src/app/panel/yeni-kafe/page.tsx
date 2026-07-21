"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useKullanici } from "@/lib/useKullanici";

interface Zincir {
  id: string;
  ad: string;
}

interface Bolum {
  ad: string;
  masaSayisi: number;
}

// Türkçe karakterleri sadeleştirip adres (slug) önerir
function slugYap(ad: string) {
  const harita: Record<string, string> = {
    ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u",
    Ç: "c", Ğ: "g", İ: "i", I: "i", Ö: "o", Ş: "s", Ü: "u",
  };
  return ad
    .split("")
    .map((h) => harita[h] ?? h)
    .join("")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const ALAN = "rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2.5 text-sm outline-none";

// Yeni kafe sihirbazı (yalnız süper admin): kafe + yönetici hesabı + bölüm/masalar
// tek adımda açılır; kafe /panel listesine ve müşteri uygulamasına anında düşer.
export default function YeniKafeSayfasi() {
  const router = useRouter();
  const { kullanici, yukleniyor } = useKullanici(["super_admin"]);
  const supabase = createClient();

  const [ad, setAd] = useState("");
  const [slug, setSlug] = useState("");
  const [slugElle, setSlugElle] = useState(false);
  const [zincirler, setZincirler] = useState<Zincir[]>([]);
  const [zincirId, setZincirId] = useState("");
  const [adminAd, setAdminAd] = useState("");
  const [adminEposta, setAdminEposta] = useState("");
  const [adminSifre, setAdminSifre] = useState("");
  const [il, setIl] = useState("");
  const [ilce, setIlce] = useState("");
  const [bolumler, setBolumler] = useState<Bolum[]>([{ ad: "Salon", masaSayisi: 8 }]);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  // Toplu kurulum (100 şubelik zincir): liste yapıştırma
  const [sekme, setSekme] = useState<"tek" | "toplu">("tek");
  const [topluZincir, setTopluZincir] = useState("");
  const [topluMetin, setTopluMetin] = useState("");
  const [ortakSifre, setOrtakSifre] = useState("");
  const [sonuc, setSonuc] = useState<{
    kurulan: { ad: string; slug: string }[];
    hatalar: { satir: number; ad: string; hata: string }[];
    menuNotu: string | null;
  } | null>(null);

  useEffect(() => {
    if (!kullanici) return;
    supabase.rpc("zincir_listesi").then(({ data }) => {
      setZincirler(((data as Zincir[]) ?? []).map((z) => ({ id: z.id, ad: z.ad })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kullanici]);

  function bolumGuncelle(i: number, degisiklik: Partial<Bolum>) {
    setBolumler((eski) => eski.map((b, n) => (n === i ? { ...b, ...degisiklik } : b)));
  }

  async function olustur() {
    if (gonderiliyor) return;
    setHata(null);
    setGonderiliyor(true);
    const yanit = await fetch("/api/platform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        islem: "kafe",
        ad,
        slug,
        zincirId: zincirId || null,
        adminAd,
        adminEposta,
        adminSifre,
        il,
        ilce,
        bolumler: bolumler.filter((b) => b.ad.trim()),
      }),
    });
    const veri = await yanit.json().catch(() => ({}));
    setGonderiliyor(false);
    if (!yanit.ok) {
      setHata(veri.hata ?? "Kafe oluşturulamadı");
      return;
    }
    router.push("/panel");
  }

  // "Ad; adres; il; ilçe; e-posta" satırlarını ayrıştırır (; veya sekme ayracı)
  function satirlariAyristir() {
    return topluMetin
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const p = s.split(/[;\t]/).map((x) => x.trim());
        const ad = p[0] ?? "";
        return {
          ad,
          slug: p[1] ? slugYap(p[1]) : slugYap(ad),
          il: p[2] ?? "",
          ilce: p[3] ?? "",
          adminEposta: p[4] ?? "",
        };
      });
  }

  async function topluKur() {
    if (gonderiliyor) return;
    setHata(null);
    setSonuc(null);
    const satirlar = satirlariAyristir();
    if (!topluZincir) return setHata("Zincir seçin");
    if (!satirlar.length) return setHata("En az bir şube satırı yapıştırın");
    if (!ortakSifre || ortakSifre.length < 8) {
      return setHata("Ortak yönetici şifresi en az 8 karakter olmalı");
    }
    setGonderiliyor(true);
    const yanit = await fetch("/api/platform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ islem: "toplu_kafe", zincirId: topluZincir, ortakSifre, satirlar }),
    });
    const veri = await yanit.json().catch(() => ({}));
    setGonderiliyor(false);
    if (!yanit.ok) return setHata(veri.hata ?? "Toplu kurulum yapılamadı");
    setSonuc(veri);
    setTopluMetin("");
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
      <div className="mx-auto max-w-[640px]">
        <Link href="/panel" className="text-[13px] font-bold text-metin-soluk">
          ← Panele dön
        </Link>
        <h1 className="mt-2 font-serif text-2xl font-semibold text-metin-baslik">Yeni Kafe Aç</h1>
        <p className="mt-1 text-[13px] text-metin-soluk">
          Tek kafe için formu doldur; bir zincirin onlarca şubesini kuracaksan listeyi yapıştır.
        </p>

        <div className="mt-4 flex rounded-xl bg-krem-koyu p-0.5 text-[13px] font-extrabold">
          {(
            [
              ["tek", "Tek kafe"],
              ["toplu", "Toplu şube kurulumu"],
            ] as const
          ).map(([id, etiket]) => (
            <button
              key={id}
              onClick={() => {
                setSekme(id);
                setHata(null);
              }}
              className={
                "flex-1 rounded-lg px-2 py-2.5 " +
                (sekme === id ? "bg-kart text-metin-baslik" : "text-metin-soluk")
              }
            >
              {etiket}
            </button>
          ))}
        </div>

        {hata && (
          <p className="mt-4 rounded-xl bg-tehlike-zemin px-3.5 py-2.5 text-[13.5px] font-bold text-tehlike">
            {hata}
          </p>
        )}

        {/* ── Toplu şube kurulumu ── */}
        {sekme === "toplu" && (
          <>
            <div className="mt-5 rounded-2xl border border-cizgi bg-kart p-4">
              <h2 className="text-sm font-extrabold text-metin-baslik">Şube listesi</h2>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-metin-soluk">
                Her satıra bir şube: <strong>Ad; adres; il; ilçe; yönetici e-postası</strong>.
                Adresi boş bırakırsan addan üretilir. Şubeler self-servis olarak kurulur, zincirin
                ana şube menüsü otomatik uygulanır.
              </p>
              <div className="mt-3 grid gap-2">
                <select
                  value={topluZincir}
                  onChange={(e) => setTopluZincir(e.target.value)}
                  className={ALAN}
                >
                  <option value="">Zincir seç…</option>
                  {zincirler.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.ad}
                    </option>
                  ))}
                </select>
                <textarea
                  value={topluMetin}
                  onChange={(e) => setTopluMetin(e.target.value)}
                  rows={10}
                  placeholder={
                    "Arabica Kadıköy; arabica-kadikoy; İstanbul; Kadıköy; kadikoy@arabica.com\n" +
                    "Arabica Beşiktaş; arabica-besiktas; İstanbul; Beşiktaş; besiktas@arabica.com"
                  }
                  className={ALAN + " font-mono text-[12.5px] leading-relaxed"}
                />
                <input
                  value={ortakSifre}
                  onChange={(e) => setOrtakSifre(e.target.value)}
                  placeholder="Tüm şubeler için ortak yönetici şifresi (en az 8 karakter)"
                  className={ALAN}
                />
                <p className="text-[11.5px] text-metin-soluk">
                  Şube yöneticileri ilk girişten sonra şifrelerini kendi panellerinden
                  değiştirebilir.
                </p>
              </div>
              <button
                onClick={topluKur}
                disabled={gonderiliyor}
                className="marka-gradyan mt-3 w-full rounded-xl px-5 py-3 text-sm font-extrabold text-white disabled:opacity-60"
              >
                {gonderiliyor
                  ? "Kuruluyor…"
                  : `${satirlariAyristir().length || ""} Şubeyi Kur`.trim()}
              </button>
            </div>

            {sonuc && (
              <div className="mt-4 rounded-2xl border border-cizgi bg-kart p-4">
                <p className="text-sm font-extrabold text-basari">
                  {sonuc.kurulan.length} şube kuruldu
                  {sonuc.hatalar.length > 0 && `, ${sonuc.hatalar.length} satır atlandı`}
                </p>
                {sonuc.menuNotu && (
                  <p className="mt-1 text-[12.5px] text-metin-soluk">{sonuc.menuNotu}</p>
                )}
                {sonuc.hatalar.length > 0 && (
                  <div className="mt-3 flex flex-col gap-1">
                    {sonuc.hatalar.map((h) => (
                      <p key={h.satir} className="text-[12.5px] text-tehlike">
                        Satır {h.satir} ({h.ad}): {h.hata}
                      </p>
                    ))}
                  </div>
                )}
                <Link
                  href="/panel"
                  className="mt-3 inline-block text-[13px] font-bold text-marka-koyu"
                >
                  Panele dön ve şubeleri gör →
                </Link>
              </div>
            )}
          </>
        )}

        {sekme === "tek" && (
          <>
        <div className="mt-5 rounded-2xl border border-cizgi bg-kart p-4">
          <h2 className="text-sm font-extrabold text-metin-baslik">Kafe bilgileri</h2>
          <div className="mt-3 grid gap-2">
            <input
              value={ad}
              onChange={(e) => {
                setAd(e.target.value);
                if (!slugElle) setSlug(slugYap(e.target.value));
              }}
              placeholder="Kafe adı (örn. BUTİKEK Kadıköy)"
              className={ALAN}
            />
            <div>
              <input
                value={slug}
                onChange={(e) => {
                  setSlugElle(true);
                  setSlug(slugYap(e.target.value));
                }}
                placeholder="adres (örn. butikek-kadikoy)"
                autoCapitalize="none"
                className={ALAN + " w-full"}
              />
              <p className="mt-1 text-[11.5px] text-metin-soluk">
                QR menü adresi: sofrakur.com/qr altında bu ad kullanılır — sonradan değişmez.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={il}
                onChange={(e) => setIl(e.target.value)}
                placeholder="İl (örn. İstanbul)"
                className={ALAN}
              />
              <input
                value={ilce}
                onChange={(e) => setIlce(e.target.value)}
                placeholder="İlçe (örn. Kadıköy)"
                className={ALAN}
              />
            </div>
            <select value={zincirId} onChange={(e) => setZincirId(e.target.value)} className={ALAN}>
              <option value="">Bağımsız kafe (zincirsiz)</option>
              {zincirler.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.ad} zinciri
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-cizgi bg-kart p-4">
          <h2 className="text-sm font-extrabold text-metin-baslik">Kafe yöneticisi</h2>
          <p className="mt-0.5 text-[12px] text-metin-soluk">
            Bu hesapla kafe sahibi menüsünü, personelini ve raporlarını kendisi yönetir.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input value={adminAd} onChange={(e) => setAdminAd(e.target.value)} placeholder="Ad Soyad" className={ALAN} />
            <input
              value={adminEposta}
              onChange={(e) => setAdminEposta(e.target.value)}
              placeholder="E-posta (girişte kullanılır)"
              inputMode="email"
              autoCapitalize="none"
              className={ALAN}
            />
            <input
              value={adminSifre}
              onChange={(e) => setAdminSifre(e.target.value)}
              placeholder="Şifre (en az 8 karakter)"
              className={ALAN + " sm:col-span-2"}
            />
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-cizgi bg-kart p-4">
          <h2 className="text-sm font-extrabold text-metin-baslik">Bölümler ve masalar</h2>
          <p className="mt-0.5 text-[12px] text-metin-soluk">
            Masalar &quot;Bölüm 1, Bölüm 2…&quot; diye adlandırılır; QR kodları otomatik üretilir.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {bolumler.map((b, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={b.ad}
                  onChange={(e) => bolumGuncelle(i, { ad: e.target.value })}
                  placeholder="Bölüm adı (örn. Salon)"
                  className={ALAN + " flex-1"}
                />
                <input
                  value={b.masaSayisi || ""}
                  onChange={(e) => bolumGuncelle(i, { masaSayisi: parseInt(e.target.value) || 0 })}
                  placeholder="Masa"
                  inputMode="numeric"
                  className={ALAN + " w-24 text-center"}
                />
                {bolumler.length > 1 && (
                  <button
                    onClick={() => setBolumler((eski) => eski.filter((_, n) => n !== i))}
                    className="rounded-[10px] border border-cizgi-koyu px-3 text-sm font-bold text-tehlike"
                  >
                    Sil
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={() => setBolumler((eski) => [...eski, { ad: "", masaSayisi: 4 }])}
            className="mt-2 rounded-[10px] border border-dashed border-cizgi-koyu px-3 py-2 text-[13px] font-bold text-metin-orta"
          >
            + Bölüm ekle
          </button>
        </div>

        <button
          onClick={olustur}
          disabled={gonderiliyor}
          className="marka-gradyan mt-5 w-full rounded-xl px-5 py-3 text-sm font-extrabold text-white disabled:opacity-60"
        >
          {gonderiliyor ? "Kuruluyor…" : "Kafeyi Kur"}
        </button>
          </>
        )}
      </div>
    </main>
  );
}
