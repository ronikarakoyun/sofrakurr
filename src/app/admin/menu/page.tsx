"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { OpsiyonYonetimi } from "@/components/OpsiyonYonetimi";
import { RecetePaneli } from "@/components/RecetePaneli";
import { useKullanici } from "@/lib/useKullanici";
import { ISTASYONLAR, ISTASYON_SIMGE, tl, type Kategori } from "@/lib/types";

interface YeniUrunForm {
  kategoriId: string;
  ad: string;
  fiyat: string;
  aciklama: string;
}

export default function AdminMenuPage() {
  const { kullanici, yukleniyor } = useKullanici(["admin"]);
  const [menu, setMenu] = useState<Kategori[]>([]);
  const [yeniKategori, setYeniKategori] = useState("");
  const [yeniUrun, setYeniUrun] = useState<YeniUrunForm | null>(null);
  const [fiyatDuzenlenen, setFiyatDuzenlenen] = useState<string | null>(null);
  const [fiyatDegeri, setFiyatDegeri] = useState("");
  const [opsiyonUrunId, setOpsiyonUrunId] = useState<string | null>(null);
  const [receteUrunId, setReceteUrunId] = useState<string | null>(null);
  const [duzenlenenId, setDuzenlenenId] = useState<string | null>(null);
  const [duzAciklama, setDuzAciklama] = useState("");
  const [fotoYukleniyor, setFotoYukleniyor] = useState(false);

  const yenile = useCallback(async () => {
    if (!kullanici) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("kategori")
      .select("id, ad, sira, aktif, urun(id, ad, aciklama, fiyat, gorsel_url, aktif, sira, istasyon, kampanya, kaynak_id, fiyat_kilit, opsiyon_grubu(id, ad, min_secim, max_secim, sira, opsiyon(id, ad, ek_fiyat, aktif, sira)))")
      .eq("cafe_id", kullanici.cafe_id)
      .order("sira");
    setMenu(
      ((data ?? []) as unknown as Kategori[]).map((k) => ({
        ...k,
        urun: [...k.urun].sort((a, b) => a.sira - b.sira),
      }))
    );
  }, [kullanici]);

  useEffect(() => {
    yenile();
  }, [yenile]);

  async function kategoriEkle() {
    if (!yeniKategori.trim() || !kullanici) return;
    const supabase = createClient();
    await supabase.from("kategori").insert({
      cafe_id: kullanici.cafe_id,
      ad: yeniKategori.trim(),
      sira: menu.length,
    });
    setYeniKategori("");
    yenile();
  }

  async function urunKaydet() {
    if (!yeniUrun || !yeniUrun.ad.trim() || !kullanici) return;
    const fiyat = parseFloat(yeniUrun.fiyat.replace(",", "."));
    if (isNaN(fiyat) || fiyat < 0) return;
    const supabase = createClient();
    const kat = menu.find((k) => k.id === yeniUrun.kategoriId);
    await supabase.from("urun").insert({
      cafe_id: kullanici.cafe_id,
      kategori_id: yeniUrun.kategoriId,
      ad: yeniUrun.ad.trim(),
      aciklama: yeniUrun.aciklama.trim() || null,
      fiyat,
      sira: kat?.urun.length ?? 0,
    });
    setYeniUrun(null);
    yenile();
  }

  async function urunGuncelle(id: string, alanlar: Record<string, unknown>) {
    const supabase = createClient();
    await supabase.from("urun").update(alanlar).eq("id", id);
    yenile();
  }

  function fiyatKaydet() {
    if (!fiyatDuzenlenen) return;
    const f = parseFloat(fiyatDegeri.replace(",", "."));
    if (!isNaN(f) && f >= 0) urunGuncelle(fiyatDuzenlenen, { fiyat: f });
    setFiyatDuzenlenen(null);
    setFiyatDegeri("");
  }

  // Telefon fotoğrafları 3-5 MB olur; menü hızlı açılsın diye 1200px'e küçültüp yüklüyoruz
  async function fotoYukle(urunId: string, dosya: File) {
    if (!kullanici) return;
    setFotoYukleniyor(true);
    try {
      const bitmap = await createImageBitmap(dosya);
      const oran = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      const tuval = document.createElement("canvas");
      tuval.width = Math.round(bitmap.width * oran);
      tuval.height = Math.round(bitmap.height * oran);
      tuval.getContext("2d")!.drawImage(bitmap, 0, 0, tuval.width, tuval.height);
      const blob = await new Promise<Blob>((coz, hata) =>
        tuval.toBlob((b) => (b ? coz(b) : hata(new Error("Görsel işlenemedi"))), "image/jpeg", 0.82)
      );

      const supabase = createClient();
      const yol = `${kullanici.cafe_id}/${urunId}-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("urun-foto").upload(yol, blob, {
        contentType: "image/jpeg",
        upsert: true,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("urun-foto").getPublicUrl(yol);
      await urunGuncelle(urunId, { gorsel_url: data.publicUrl });
    } catch (e) {
      alert("Fotoğraf yüklenemedi: " + (e as Error).message);
    } finally {
      setFotoYukleniyor(false);
    }
  }

  if (yukleniyor) {
    return <p className="animate-pulse text-metin-soluk">Yükleniyor…</p>;
  }

  const inputStil =
    "rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2.5 text-sm outline-none focus:border-marka";

  return (
    <div className="max-w-[760px]">
      <h1 className="font-serif text-2xl font-semibold text-metin-baslik">Menü</h1>
      <p className="mt-1 text-[13.5px] text-metin-soluk">
        Fiyata tıklayarak düzenleyin; pasife alınan ürün menüden anında düşer.
      </p>

      <div className="mt-5 flex flex-col gap-6">
        {menu.map((kat) => (
          <section key={kat.id}>
            <div className="flex items-center gap-3">
              <h2 className="text-base font-extrabold">{kat.ad}</h2>
              <span className="text-[12.5px] text-metin-silik">{kat.urun.length} ürün</span>
              <span className="flex-1" />
              <button
                onClick={() =>
                  setYeniUrun({ kategoriId: kat.id, ad: "", fiyat: "", aciklama: "" })
                }
                className="rounded-lg px-2 py-1.5 text-[13.5px] font-bold text-basari hover:bg-basari-zemin"
              >
                + Ürün ekle
              </button>
            </div>

            {yeniUrun?.kategoriId === kat.id && (
              <div className="mt-2.5 flex flex-col gap-2.5 rounded-[14px] border-[1.5px] border-[#9bc4a8] bg-kart p-3.5">
                <input
                  autoFocus
                  value={yeniUrun.ad}
                  onChange={(e) => setYeniUrun({ ...yeniUrun, ad: e.target.value })}
                  placeholder="Ürün adı"
                  className={inputStil}
                />
                <div className="flex flex-wrap gap-2.5">
                  <input
                    value={yeniUrun.fiyat}
                    onChange={(e) => setYeniUrun({ ...yeniUrun, fiyat: e.target.value })}
                    placeholder="Fiyat (TL)"
                    inputMode="decimal"
                    className={inputStil + " w-[110px]"}
                  />
                  <input
                    value={yeniUrun.aciklama}
                    onChange={(e) => setYeniUrun({ ...yeniUrun, aciklama: e.target.value })}
                    placeholder="Açıklama (isteğe bağlı)"
                    className={inputStil + " min-w-[180px] flex-1"}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setYeniUrun(null)}
                    className="px-2.5 py-2 text-[13.5px] font-bold text-metin-soluk"
                  >
                    Vazgeç
                  </button>
                  <button
                    onClick={urunKaydet}
                    className="rounded-[10px] bg-basari px-4.5 py-2.5 text-[13.5px] font-extrabold text-white"
                  >
                    Kaydet
                  </button>
                </div>
              </div>
            )}

            <div className="mt-2.5 overflow-hidden rounded-2xl border border-cizgi bg-kart">
              {kat.urun.map((u, ui) => (
                <div
                  key={u.id}
                  className={
                    (ui < kat.urun.length - 1 ? "border-b border-[#f6ede1] " : "") +
                    (u.aktif ? "" : "opacity-55")
                  }
                >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
                  {u.gorsel_url && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={u.gorsel_url}
                      alt={u.ad}
                      className="h-11 w-11 flex-shrink-0 rounded-lg object-cover"
                    />
                  )}
                  <div className="min-w-[150px] flex-1">
                    <span className="text-[14.5px] font-bold">{u.ad}</span>
                    {u.kampanya && (
                      <span className="ml-2 rounded-md bg-uyari-zemin px-2 py-0.5 text-[11px] font-extrabold text-uyari">
                        🎉 kampanya
                      </span>
                    )}
                    {!u.aktif && (
                      <span className="ml-2 rounded-md bg-tehlike-zemin px-2 py-0.5 text-[11px] font-extrabold text-tehlike">
                        pasif
                      </span>
                    )}
                    {u.aciklama && (
                      <span className="mt-0.5 block text-[12.5px] text-metin-soluk">
                        {u.aciklama}
                      </span>
                    )}
                  </div>

                  <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                  {fiyatDuzenlenen === u.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={fiyatDegeri}
                        onChange={(e) => setFiyatDegeri(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && fiyatKaydet()}
                        inputMode="decimal"
                        className="w-[76px] rounded-[9px] border-[1.5px] border-marka px-2.5 py-1.5 text-right text-sm font-bold outline-none"
                      />
                      <button
                        onClick={fiyatKaydet}
                        className="rounded-[9px] bg-basari px-3 py-2 text-[12.5px] font-extrabold text-white"
                      >
                        ✓
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setFiyatDuzenlenen(u.id);
                        setFiyatDegeri(String(u.fiyat));
                      }}
                      title="Fiyatı düzenle"
                      className="rounded-lg px-2 py-1.5 text-[14.5px] font-extrabold tabular-nums text-marka-koyu hover:bg-krem-koyu"
                    >
                      {tl(Number(u.fiyat))}
                    </button>
                  )}

                  {/* Zincir kopyası: kilit açıkken senkron bu şubenin fiyatını ezmez */}
                  {u.kaynak_id && (
                    <button
                      onClick={() => urunGuncelle(u.id, { fiyat_kilit: !u.fiyat_kilit })}
                      title={
                        u.fiyat_kilit
                          ? "Fiyat kilitli: zincir menü senkronu bu fiyatı değiştirmez"
                          : "Fiyat zincire bağlı: senkronda ana şube fiyatı gelir"
                      }
                      className={
                        "rounded-[9px] px-2.5 py-2 text-xs font-extrabold " +
                        (u.fiyat_kilit
                          ? "bg-uyari-zemin text-uyari"
                          : "bg-krem-koyu text-metin-soluk")
                      }
                    >
                      {u.fiyat_kilit ? "🔒 şube fiyatı" : "🔗 zincir fiyatı"}
                    </button>
                  )}

                  <button
                    onClick={() => {
                      const mevcut = ISTASYONLAR.indexOf((u.istasyon ?? "mutfak") as (typeof ISTASYONLAR)[number]);
                      const sonraki = ISTASYONLAR[(mevcut + 1) % ISTASYONLAR.length];
                      urunGuncelle(u.id, { istasyon: sonraki });
                    }}
                    title={`İstasyon: ${u.istasyon ?? "mutfak"} — değiştirmek için tıkla`}
                    className="whitespace-nowrap rounded-[9px] bg-krem-koyu px-2.5 py-2 text-xs font-extrabold text-metin-orta"
                  >
                    {ISTASYON_SIMGE[u.istasyon ?? "mutfak"]} {u.istasyon ?? "mutfak"}
                  </button>
                  <button
                    onClick={() => {
                      setDuzenlenenId(duzenlenenId === u.id ? null : u.id);
                      setDuzAciklama(u.aciklama ?? "");
                    }}
                    title="Fotoğraf, açıklama ve kampanya ayarları"
                    className={
                      "whitespace-nowrap rounded-[9px] px-2.5 py-2 text-xs font-extrabold " +
                      (duzenlenenId === u.id
                        ? "bg-[#fdf5ec] text-marka-koyu"
                        : "bg-krem-koyu text-metin-soluk")
                    }
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => setReceteUrunId(u.id)}
                    title="Reçeteyi yönet (hammadde miktarları)"
                    className="whitespace-nowrap rounded-[9px] bg-krem-koyu px-2.5 py-2 text-xs font-extrabold text-metin-soluk"
                  >
                    📋
                  </button>
                  <button
                    onClick={() => setOpsiyonUrunId(u.id)}
                    title="Opsiyonları yönet (süt, shot, şeker vb.)"
                    className={
                      "whitespace-nowrap rounded-[9px] px-2.5 py-2 text-xs font-extrabold " +
                      (u.opsiyon_grubu.length
                        ? "bg-[#e9f0f9] text-[#31639c]"
                        : "bg-krem-koyu text-metin-soluk")
                    }
                  >
                    ⚙ {u.opsiyon_grubu.length || ""}
                  </button>
                  <button
                    onClick={() => urunGuncelle(u.id, { aktif: !u.aktif })}
                    className={
                      "whitespace-nowrap rounded-[9px] px-3 py-2 text-xs font-extrabold " +
                      (u.aktif
                        ? "bg-krem-koyu text-metin-orta"
                        : "bg-basari-zemin text-basari")
                    }
                  >
                    {u.aktif ? "Pasife al" : "Aktif et"}
                  </button>
                  </div>
                </div>

                {/* ✎ paneli: fotoğraf + açıklama + kampanya */}
                {duzenlenenId === u.id && (
                  <div className="flex flex-col gap-2.5 border-t border-dashed border-[#e8dcc8] bg-krem/60 px-4 py-3.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      {u.gorsel_url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={u.gorsel_url}
                          alt={u.ad}
                          className="h-16 w-16 rounded-xl object-cover"
                        />
                      ) : (
                        <span className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-cizgi-koyu text-2xl">
                          📷
                        </span>
                      )}
                      <label className="cursor-pointer rounded-[10px] bg-krem-koyu px-3 py-2.5 text-[12.5px] font-extrabold text-metin-orta">
                        {fotoYukleniyor
                          ? "Yükleniyor…"
                          : u.gorsel_url
                            ? "Fotoğrafı değiştir"
                            : "Fotoğraf yükle"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={fotoYukleniyor}
                          onChange={(e) => {
                            const d = e.target.files?.[0];
                            if (d) fotoYukle(u.id, d);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {u.gorsel_url && (
                        <button
                          onClick={() => urunGuncelle(u.id, { gorsel_url: null })}
                          className="px-2 py-2 text-[12.5px] font-bold text-tehlike-yumusak"
                        >
                          Kaldır
                        </button>
                      )}
                      <span className="flex-1" />
                      <button
                        onClick={() => urunGuncelle(u.id, { kampanya: !u.kampanya })}
                        className={
                          "rounded-[10px] px-3 py-2.5 text-[12.5px] font-extrabold " +
                          (u.kampanya
                            ? "bg-uyari-zemin text-uyari"
                            : "bg-krem-koyu text-metin-soluk")
                        }
                      >
                        🎉 {u.kampanya ? "Kampanyadan çıkar" : "Kampanya yap"}
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={duzAciklama}
                        onChange={(e) => setDuzAciklama(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" &&
                          urunGuncelle(u.id, { aciklama: duzAciklama.trim() || null })
                        }
                        placeholder="Açıklama / içerik (müşteri menüde görür)"
                        className={inputStil + " flex-1"}
                      />
                      <button
                        onClick={() =>
                          urunGuncelle(u.id, { aciklama: duzAciklama.trim() || null })
                        }
                        className="rounded-[10px] bg-basari px-3.5 py-2 text-[12.5px] font-extrabold text-white"
                      >
                        Kaydet
                      </button>
                    </div>
                  </div>
                )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-6 flex gap-2.5">
        <input
          value={yeniKategori}
          onChange={(e) => setYeniKategori(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && kategoriEkle()}
          placeholder="Yeni kategori adı"
          className="flex-1 rounded-xl border border-cizgi-koyu bg-kart px-3.5 py-3 text-sm outline-none focus:border-marka"
        />
        <button
          onClick={kategoriEkle}
          className="marka-gradyan rounded-xl px-5 py-3 text-sm font-extrabold text-white"
        >
          Kategori Ekle
        </button>
      </div>
      <p className="mt-4 text-[12.5px] text-metin-silik">
        Ürün satırında: 🍳/🍹/🧁 istasyon (tıklayınca değişir — sipariş o istasyonun ekranına ve
        yazıcısına düşer), 📋 reçete, ⚙ opsiyonlar.
      </p>

      {receteUrunId &&
        kullanici &&
        (() => {
          const urun = menu.flatMap((k) => k.urun).find((u) => u.id === receteUrunId);
          return urun ? (
            <RecetePaneli
              urunId={urun.id}
              urunAd={urun.ad}
              cafeId={kullanici.cafe_id}
              kapat={() => setReceteUrunId(null)}
            />
          ) : null;
        })()}

      {opsiyonUrunId &&
        kullanici &&
        (() => {
          const urun = menu.flatMap((k) => k.urun).find((u) => u.id === opsiyonUrunId);
          return urun ? (
            <OpsiyonYonetimi
              urun={urun}
              cafeId={kullanici.cafe_id}
              kapat={() => setOpsiyonUrunId(null)}
              degisti={yenile}
            />
          ) : null;
        })()}
    </div>
  );
}
