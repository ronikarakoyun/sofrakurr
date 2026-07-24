"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useKullanici } from "@/lib/useKullanici";
import type { KullaniciRol } from "@/lib/types";

interface Personel {
  id: string;
  ad: string | null;
  rol: KullaniciRol;
  aktif: boolean;
}

// Kasa ekranı emekli edildi (app-only self-servis): tezgah/kasa rolündeki
// personel de mutfak gibi KDS'e girer. Eski yetki anahtarları anlamsızlaştı.
const ROL_ETIKET: Record<string, string> = {
  admin: "Yönetici",
  kasa: "Tezgah",
  garson: "Garson",
  mutfak: "Mutfak",
};

export default function PersonelSayfasi() {
  const { kullanici } = useKullanici(["admin"]);
  const supabase = createClient();

  const [personeller, setPersoneller] = useState<Personel[]>([]);
  const [ad, setAd] = useState("");
  const [eposta, setEposta] = useState("");
  const [sifre, setSifre] = useState("");
  const [rol, setRol] = useState<"kasa" | "mutfak">("kasa");
  const [mesaj, setMesaj] = useState<{ metin: string; hata: boolean } | null>(null);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [epostalar, setEpostalar] = useState<Record<string, string>>({});
  const [duzenleModal, setDuzenleModal] = useState<{
    id: string;
    ad: string;
    rol: KullaniciRol;
  } | null>(null);
  const [yeniEposta, setYeniEposta] = useState("");
  const [yeniSifre, setYeniSifre] = useState("");
  const [silSorulan, setSilSorulan] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    const { data } = await supabase
      .from("kullanici")
      .select("id, ad, rol, aktif")
      .neq("rol", "musteri")
      .order("aktif", { ascending: false })
      .order("ad");
    setPersoneller((data as Personel[]) ?? []);
    // giriş e-postaları auth tarafında durur, sunucudan (yalnız admin) çekilir
    const cevap = await fetch("/api/personel").catch(() => null);
    if (cevap?.ok) {
      const veri = await cevap.json();
      setEpostalar(veri.epostalar ?? {});
    }
  }, [supabase]);

  useEffect(() => {
    if (kullanici) yukle();
  }, [kullanici, yukle]);

  function bilgi(metin: string, hata = false) {
    setMesaj({ metin, hata });
    setTimeout(() => setMesaj(null), 5000);
  }

  async function ekle() {
    if (gonderiliyor) return;
    setGonderiliyor(true);
    const cevap = await fetch("/api/personel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ad, eposta, sifre, rol }),
    });
    const veri = await cevap.json();
    setGonderiliyor(false);
    if (!cevap.ok) return bilgi(veri.hata ?? "Hesap açılamadı", true);
    setAd("");
    setEposta("");
    setSifre("");
    bilgi(`${ad.trim()} için ${ROL_ETIKET[rol]} hesabı açıldı ✓`);
    yukle();
  }

  async function duzenleKaydet() {
    if (!duzenleModal || gonderiliyor) return;
    const epostaDegisti = yeniEposta.trim() !== (epostalar[duzenleModal.id] ?? "");
    setGonderiliyor(true);

    if (epostaDegisti || yeniSifre) {
      const cevap = await fetch("/api/personel", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kullaniciId: duzenleModal.id,
          ...(yeniSifre ? { sifre: yeniSifre } : {}),
          ...(epostaDegisti ? { eposta: yeniEposta.trim() } : {}),
        }),
      });
      const veri = await cevap.json();
      if (!cevap.ok) {
        setGonderiliyor(false);
        return bilgi(veri.hata ?? "Güncellenemedi", true);
      }
    }

    setGonderiliyor(false);
    bilgi(`${duzenleModal.ad} hesabı güncellendi ✓`);
    setDuzenleModal(null);
    setYeniSifre("");
    setYeniEposta("");
    yukle();
  }

  async function personelSil(p: Personel) {
    if (gonderiliyor) return;
    setGonderiliyor(true);
    const cevap = await fetch("/api/personel", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kullaniciId: p.id }),
    });
    const veri = await cevap.json();
    setGonderiliyor(false);
    setSilSorulan(null);
    if (!cevap.ok) return bilgi(veri.hata ?? "Silinemedi", true);
    bilgi(`${p.ad ?? "Personel"} kalıcı olarak silindi`);
    yukle();
  }

  async function aktifToggle(p: Personel) {
    if (p.id === kullanici?.id) return bilgi("Kendi hesabını pasife alamazsın", true);
    const { error } = await supabase
      .from("kullanici")
      .update({ aktif: !p.aktif })
      .eq("id", p.id);
    if (error) return bilgi(error.message, true);
    yukle();
  }

  if (!kullanici) return null;

  return (
    <div className="max-w-2xl">
      <h1 className="font-serif text-2xl font-semibold text-metin-baslik">Personel</h1>
      <p className="mt-1 text-sm text-metin-soluk">
        Her personelin kendi hesabı olsun — ayrılan personelin hesabı tek dokunuşla kapanır.
        Tezgah ve Mutfak rollerinin ikisi de <b>Mutfak Ekranı</b>na (KDS) girer; siparişleri
        oradan hazırlayıp teslim ederler.
      </p>

      {mesaj && (
        <p
          className={
            "mt-4 rounded-xl px-3 py-2 text-[13px] font-bold " +
            (mesaj.hata ? "bg-tehlike-zemin text-tehlike" : "bg-basari-zemin text-basari")
          }
        >
          {mesaj.metin}
        </p>
      )}

      {/* Yeni personel */}
      <div className="mt-5 rounded-2xl border border-cizgi bg-kart p-4">
        <h2 className="text-sm font-extrabold text-metin-baslik">Yeni personel ekle</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input
            value={ad}
            onChange={(e) => setAd(e.target.value)}
            placeholder="Ad (fişte görünür, örn. Ayşe)"
            className="rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2.5 text-sm outline-none"
          />
          <input
            value={eposta}
            onChange={(e) => setEposta(e.target.value)}
            placeholder="E-posta (girişte kullanılır)"
            inputMode="email"
            autoCapitalize="none"
            className="rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2.5 text-sm outline-none"
          />
          <input
            value={sifre}
            onChange={(e) => setSifre(e.target.value)}
            placeholder="Şifre (en az 8 karakter)"
            className="rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2.5 text-sm outline-none"
          />
          <div className="flex rounded-[10px] bg-krem-koyu p-0.5 text-[13px] font-extrabold">
            {(["kasa", "mutfak"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRol(r)}
                className={
                  "flex-1 rounded-lg px-2 py-2 " +
                  (rol === r ? "bg-kart text-metin-baslik" : "text-metin-soluk")
                }
              >
                {ROL_ETIKET[r]}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={ekle}
          disabled={gonderiliyor}
          className="marka-gradyan mt-3 rounded-xl px-5 py-2.5 text-sm font-extrabold text-white disabled:opacity-60"
        >
          {gonderiliyor ? "Açılıyor…" : "Hesap Aç"}
        </button>
      </div>

      {/* Liste */}
      <div className="mt-5 flex flex-col gap-1.5">
        {personeller.map((p) => (
          <div
            key={p.id}
            className={
              "flex items-center gap-3 rounded-xl border border-cizgi bg-kart px-4 py-3 " +
              (p.aktif ? "" : "opacity-55")
            }
          >
            <span className="min-w-0 flex-1 text-sm font-bold">
              {p.ad ?? "(isimsiz)"}
              {p.id === kullanici.id && (
                <span className="ml-1.5 text-xs font-semibold text-metin-soluk">(sen)</span>
              )}
              <span className="ml-2 rounded bg-krem-koyu px-1.5 py-0.5 text-[10.5px] font-extrabold text-metin-orta">
                {ROL_ETIKET[p.rol] ?? p.rol}
              </span>
              {!p.aktif && (
                <span className="ml-1.5 rounded bg-tehlike-zemin px-1.5 py-0.5 text-[10.5px] font-extrabold text-tehlike">
                  pasif
                </span>
              )}
              {epostalar[p.id] && (
                <span className="mt-0.5 block truncate text-[12px] font-semibold text-metin-soluk">
                  {epostalar[p.id]}
                </span>
              )}
            </span>
            <button
              onClick={() => {
                setYeniSifre("");
                setYeniEposta(epostalar[p.id] ?? "");
                setDuzenleModal({ id: p.id, ad: p.ad ?? "", rol: p.rol });
              }}
              className="rounded-lg bg-krem-koyu px-2.5 py-1.5 text-[11.5px] font-extrabold text-metin-orta"
            >
              Hesap
            </button>
            {p.id !== kullanici.id && (
              <button
                onClick={() => aktifToggle(p)}
                className={
                  "rounded-lg px-2.5 py-1.5 text-[11.5px] font-extrabold " +
                  (p.aktif
                    ? "text-tehlike-yumusak hover:bg-tehlike-zemin"
                    : "bg-basari-zemin text-basari")
                }
              >
                {p.aktif ? "Pasife Al" : "Aktif Et"}
              </button>
            )}
            {p.id !== kullanici.id && p.rol !== "admin" && (
              silSorulan === p.id ? (
                <span className="flex items-center gap-1.5">
                  <button
                    onClick={() => setSilSorulan(null)}
                    className="px-1 text-[11.5px] font-bold text-metin-soluk"
                  >
                    Vazgeç
                  </button>
                  <button
                    onClick={() => personelSil(p)}
                    disabled={gonderiliyor}
                    className="rounded-lg bg-tehlike px-2.5 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-60"
                  >
                    Kalıcı Sil ✓
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setSilSorulan(p.id)}
                  className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-extrabold text-tehlike hover:bg-tehlike-zemin"
                >
                  Sil
                </button>
              )
            )}
          </div>
        ))}
        {silSorulan && (
          <p className="rounded-xl bg-uyari-zemin px-3 py-2 text-[12.5px] font-bold text-uyari">
            ⚠ Silme kalıcıdır: hesap tamamen kapanır, eski fişlerde bu kişinin adı artık
            görünmez. Geçici ayrılıklar için &quot;Pasife Al&quot; yeterlidir.
          </p>
        )}
      </div>

      {/* Hesap düzenleme: e-posta + yeni şifre */}
      {duzenleModal && (
        <div
          className="anim-fade fixed inset-0 z-30 flex items-center justify-center bg-[rgba(43,28,16,0.45)] p-6"
          onClick={() => setDuzenleModal(null)}
        >
          <div
            className="anim-sheet w-full max-w-sm rounded-3xl bg-kart p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[15px] font-extrabold text-metin-baslik">
              {duzenleModal.ad} — hesap bilgileri
            </h3>
            <label className="mt-3 block text-xs font-extrabold text-metin-soluk">
              GİRİŞ E-POSTASI
            </label>
            <input
              value={yeniEposta}
              onChange={(e) => setYeniEposta(e.target.value)}
              inputMode="email"
              autoCapitalize="none"
              className="mt-1 w-full rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2.5 text-sm outline-none"
            />
            <label className="mt-3 block text-xs font-extrabold text-metin-soluk">
              YENİ ŞİFRE
            </label>
            <input
              value={yeniSifre}
              onChange={(e) => setYeniSifre(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && duzenleKaydet()}
              placeholder="Boş bırakılırsa değişmez"
              className="mt-1 w-full rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2.5 text-sm outline-none"
            />
            <p className="mt-2 text-[11.5px] text-metin-silik">
              Mevcut şifre güvenlik gereği görüntülenemez; buradan yenisini belirlersin.
              Şifre değişince personelin açık oturumları kapanır.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setDuzenleModal(null)}
                className="px-2.5 text-[13px] font-bold text-metin-soluk"
              >
                Vazgeç
              </button>
              <button
                onClick={duzenleKaydet}
                disabled={gonderiliyor}
                className="marka-gradyan rounded-xl px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-60"
              >
                {gonderiliyor ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
