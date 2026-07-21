"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useKullanici } from "@/lib/useKullanici";
import { tl } from "@/lib/types";

type Birim = "gr" | "ml" | "adet";

interface Hammadde {
  id: string;
  ad: string;
  birim: Birim;
  stok_miktar: number;
  kritik_seviye: number;
  son_birim_fiyat: number | null;
}

interface StokUrun {
  id: string;
  ad: string;
  aktif: boolean;
  stok_takip: boolean;
  stok_adet: number | null;
  kritik_seviye: number;
  kategori: { ad: string } | null;
}

const BUYUK_BIRIM: Record<Birim, { ad: string; carpan: number } | null> = {
  gr: { ad: "kg", carpan: 1000 },
  ml: { ad: "lt", carpan: 1000 },
  adet: null,
};

function miktarYaz(m: number, birim: Birim): string {
  const buyuk = BUYUK_BIRIM[birim];
  if (buyuk && Math.abs(m) >= buyuk.carpan) {
    return `${(m / buyuk.carpan).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} ${buyuk.ad}`;
  }
  return `${m.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} ${birim}`;
}

export default function AdminStokPage() {
  const { kullanici, yukleniyor } = useKullanici(["admin"]);
  const [hammaddeler, setHammaddeler] = useState<Hammadde[]>([]);
  const [urunler, setUrunler] = useState<StokUrun[]>([]);

  // hammadde formları
  const [yeniHammadde, setYeniHammadde] = useState<{ ad: string; birim: Birim; kritik: string } | null>(null);
  const [alisYapilan, setAlisYapilan] = useState<string | null>(null);
  const [alisMiktar, setAlisMiktar] = useState("");
  const [alisBuyukBirim, setAlisBuyukBirim] = useState(true);
  const [alisTutar, setAlisTutar] = useState("");
  const [hDuzenlenen, setHDuzenlenen] = useState<string | null>(null);
  const [hStok, setHStok] = useState("");
  const [hKritik, setHKritik] = useState("");
  const [hSilinecek, setHSilinecek] = useState<string | null>(null);

  // vitrin ürünü formları
  const [duzenlenen, setDuzenlenen] = useState<string | null>(null);
  const [stokDegeri, setStokDegeri] = useState("");
  const [kritikDegeri, setKritikDegeri] = useState("");
  const [girisYapilan, setGirisYapilan] = useState<string | null>(null);
  const [girisMiktari, setGirisMiktari] = useState("");

  const yenile = useCallback(async () => {
    if (!kullanici) return;
    const supabase = createClient();
    const [h, u] = await Promise.all([
      supabase
        .from("hammadde")
        .select("id, ad, birim, stok_miktar, kritik_seviye, son_birim_fiyat")
        .eq("cafe_id", kullanici.cafe_id)
        .order("ad"),
      supabase
        .from("urun")
        .select("id, ad, aktif, stok_takip, stok_adet, kritik_seviye, kategori(ad)")
        .eq("cafe_id", kullanici.cafe_id)
        .order("ad"),
    ]);
    setHammaddeler((h.data ?? []) as Hammadde[]);
    setUrunler((u.data ?? []) as unknown as StokUrun[]);
  }, [kullanici]);

  useEffect(() => {
    yenile();
  }, [yenile]);

  async function hammaddeEkle() {
    if (!yeniHammadde?.ad.trim() || !kullanici) return;
    const kritik = parseFloat((yeniHammadde.kritik || "0").replace(",", "."));
    const buyuk = BUYUK_BIRIM[yeniHammadde.birim];
    const supabase = createClient();
    await supabase.from("hammadde").insert({
      cafe_id: kullanici.cafe_id,
      ad: yeniHammadde.ad.trim(),
      birim: yeniHammadde.birim,
      kritik_seviye: isNaN(kritik) ? 0 : kritik * (buyuk ? buyuk.carpan : 1),
    });
    setYeniHammadde(null);
    yenile();
  }

  async function alisKaydet(h: Hammadde) {
    const miktar = parseFloat(alisMiktar.replace(",", "."));
    const tutar = parseFloat((alisTutar || "0").replace(",", "."));
    if (isNaN(miktar) || miktar <= 0 || isNaN(tutar) || tutar < 0 || !kullanici) return;
    const buyuk = BUYUK_BIRIM[h.birim];
    const bazMiktar = alisBuyukBirim && buyuk ? miktar * buyuk.carpan : miktar;
    const supabase = createClient();
    await supabase.from("hammadde_giris").insert({
      cafe_id: kullanici.cafe_id,
      hammadde_id: h.id,
      miktar: bazMiktar,
      toplam_tutar: tutar,
    });
    setAlisYapilan(null);
    setAlisMiktar("");
    setAlisTutar("");
    yenile();
  }

  async function hammaddeKaydet(h: Hammadde) {
    const stok = parseFloat(hStok.replace(",", "."));
    const kritik = parseFloat(hKritik.replace(",", "."));
    if (isNaN(stok) || isNaN(kritik)) return;
    const supabase = createClient();
    await supabase
      .from("hammadde")
      .update({ stok_miktar: stok, kritik_seviye: kritik })
      .eq("id", h.id);
    setHDuzenlenen(null);
    yenile();
  }

  async function hammaddeSil(id: string) {
    const supabase = createClient();
    await supabase.from("hammadde").delete().eq("id", id);
    setHSilinecek(null);
    yenile();
  }

  async function urunGuncelle(id: string, alanlar: Record<string, unknown>) {
    const supabase = createClient();
    await supabase.from("urun").update(alanlar).eq("id", id);
    yenile();
  }

  async function stokKaydet(u: StokUrun) {
    const stok = parseInt(stokDegeri, 10);
    const kritik = parseInt(kritikDegeri, 10);
    if (isNaN(stok) || stok < 0 || isNaN(kritik) || kritik < 0) return;
    await urunGuncelle(u.id, {
      stok_adet: stok,
      kritik_seviye: kritik,
      aktif: stok > 0 ? true : u.aktif,
    });
    setDuzenlenen(null);
  }

  async function malGirisi(u: StokUrun) {
    const n = parseInt(girisMiktari, 10);
    if (isNaN(n) || n <= 0) return;
    const yeni = (u.stok_adet ?? 0) + n;
    await urunGuncelle(u.id, { stok_adet: yeni, aktif: yeni > 0 ? true : u.aktif });
    setGirisYapilan(null);
    setGirisMiktari("");
  }

  if (yukleniyor) {
    return <p className="animate-pulse text-metin-soluk">Yükleniyor…</p>;
  }

  const inputStil =
    "rounded-[9px] border border-cizgi-koyu bg-krem px-2.5 py-1.5 text-sm font-bold outline-none focus:border-marka";
  const takipliler = urunler.filter((u) => u.stok_takip);
  const takipsizler = urunler.filter((u) => !u.stok_takip);

  return (
    <div className="max-w-[820px]">
      <h1 className="font-serif text-2xl font-semibold text-metin-baslik">Stok</h1>
      <p className="mt-1 text-[13.5px] text-metin-soluk">
        <strong>Hammaddeler</strong> reçetelerle otomatik düşer (reçeteleri Menü sayfasında ürünün
        📋 butonundan gir). <strong>Vitrin ürünleri</strong> adetle izlenir; stok bitince ürün
        menüden otomatik kalkar.
      </p>

      {/* ═══ HAMMADDELER ═══ */}
      <section className="mt-6">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-extrabold">Hammaddeler</h2>
          <span className="flex-1" />
          <button
            onClick={() => setYeniHammadde({ ad: "", birim: "gr", kritik: "" })}
            className="rounded-lg px-2 py-1.5 text-[13.5px] font-bold text-basari hover:bg-basari-zemin"
          >
            + Hammadde ekle
          </button>
        </div>

        {yeniHammadde && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5 rounded-[14px] border-[1.5px] border-[#9bc4a8] bg-kart p-3.5">
            <input
              autoFocus
              value={yeniHammadde.ad}
              onChange={(e) => setYeniHammadde({ ...yeniHammadde, ad: e.target.value })}
              placeholder="Ad (örn. Kahve Çekirdeği)"
              className={inputStil + " min-w-[180px] flex-1"}
            />
            <select
              value={yeniHammadde.birim}
              onChange={(e) => setYeniHammadde({ ...yeniHammadde, birim: e.target.value as Birim })}
              className={inputStil}
            >
              <option value="gr">gram</option>
              <option value="ml">ml</option>
              <option value="adet">adet</option>
            </select>
            <input
              value={yeniHammadde.kritik}
              onChange={(e) => setYeniHammadde({ ...yeniHammadde, kritik: e.target.value })}
              placeholder={
                BUYUK_BIRIM[yeniHammadde.birim]
                  ? `kritik (${BUYUK_BIRIM[yeniHammadde.birim]!.ad})`
                  : "kritik (adet)"
              }
              inputMode="decimal"
              className={inputStil + " w-28"}
            />
            <button onClick={() => setYeniHammadde(null)} className="px-2 text-[13px] font-bold text-metin-soluk">
              Vazgeç
            </button>
            <button
              onClick={hammaddeEkle}
              className="rounded-[10px] bg-basari px-4 py-2 text-[13.5px] font-extrabold text-white"
            >
              Ekle
            </button>
          </div>
        )}

        {hammaddeler.length === 0 && !yeniHammadde ? (
          <p className="mt-2.5 rounded-2xl border border-cizgi bg-kart p-4 text-sm text-metin-soluk">
            Henüz hammadde yok. Süt, kahve çekirdeği, un gibi bileşenleri ekle; alışları faturadan
            gir; reçeteleri Menü sayfasından tanımla.
          </p>
        ) : (
          <div className="mt-2.5 divide-y divide-[#f6ede1] overflow-hidden rounded-2xl border border-cizgi bg-kart">
            {[...hammaddeler]
              .sort((a, b) => Number(a.stok_miktar <= a.kritik_seviye ? 0 : 1) - Number(b.stok_miktar <= b.kritik_seviye ? 0 : 1))
              .map((h) => {
                const kritikMi = Number(h.stok_miktar) <= Number(h.kritik_seviye);
                const buyuk = BUYUK_BIRIM[h.birim];
                return (
                  <div
                    key={h.id}
                    className={"flex flex-wrap items-center gap-3 px-4 py-3 " + (kritikMi ? "bg-tehlike-zemin/40" : "")}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-[14.5px] font-bold">
                        {kritikMi && "⚠ "}
                        {h.ad}
                      </span>
                      <span className="block text-xs text-metin-soluk">
                        {h.son_birim_fiyat
                          ? `son alış: ${tl(Number(h.son_birim_fiyat) * (buyuk ? buyuk.carpan : 1))}/${buyuk ? buyuk.ad : h.birim}`
                          : "alış girilmedi"}
                      </span>
                    </div>

                    {alisYapilan === h.id ? (
                      <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-metin-soluk">
                        <input
                          autoFocus
                          value={alisMiktar}
                          onChange={(e) => setAlisMiktar(e.target.value)}
                          placeholder="miktar"
                          inputMode="decimal"
                          className={inputStil + " w-20 text-right"}
                        />
                        {buyuk ? (
                          <select
                            value={alisBuyukBirim ? "buyuk" : "baz"}
                            onChange={(e) => setAlisBuyukBirim(e.target.value === "buyuk")}
                            className={inputStil}
                          >
                            <option value="buyuk">{buyuk.ad}</option>
                            <option value="baz">{h.birim}</option>
                          </select>
                        ) : (
                          <span>adet</span>
                        )}
                        <input
                          value={alisTutar}
                          onChange={(e) => setAlisTutar(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && alisKaydet(h)}
                          placeholder="toplam ₺"
                          inputMode="decimal"
                          className={inputStil + " w-24 text-right"}
                        />
                        <button
                          onClick={() => alisKaydet(h)}
                          className="rounded-[9px] bg-basari px-3 py-2 text-xs font-extrabold text-white"
                        >
                          Kaydet ✓
                        </button>
                        <button onClick={() => setAlisYapilan(null)} className="px-1">
                          Vazgeç
                        </button>
                      </div>
                    ) : hDuzenlenen === h.id ? (
                      <div className="flex items-center gap-2 text-xs font-bold text-metin-soluk">
                        stok ({h.birim})
                        <input
                          autoFocus
                          value={hStok}
                          onChange={(e) => setHStok(e.target.value)}
                          inputMode="decimal"
                          className={inputStil + " w-24 text-right"}
                        />
                        kritik ({h.birim})
                        <input
                          value={hKritik}
                          onChange={(e) => setHKritik(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && hammaddeKaydet(h)}
                          inputMode="decimal"
                          className={inputStil + " w-24 text-right"}
                        />
                        <button
                          onClick={() => hammaddeKaydet(h)}
                          className="rounded-[9px] bg-basari px-3 py-2 text-xs font-extrabold text-white"
                        >
                          ✓
                        </button>
                      </div>
                    ) : hSilinecek === h.id ? (
                      <div className="flex items-center gap-2 text-xs font-bold">
                        <span className="text-tehlike">Silinsin mi? (reçetelerden de çıkar)</span>
                        <button onClick={() => setHSilinecek(null)} className="px-1.5 text-metin-orta">
                          Vazgeç
                        </button>
                        <button
                          onClick={() => hammaddeSil(h.id)}
                          className="rounded-lg bg-tehlike px-2.5 py-1.5 font-extrabold text-white"
                        >
                          Evet, sil
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setHDuzenlenen(h.id);
                            setAlisYapilan(null);
                            setHStok(String(h.stok_miktar));
                            setHKritik(String(h.kritik_seviye));
                          }}
                          title="Stok/kritik seviyeyi elle düzelt"
                          className={
                            "rounded-lg px-2.5 py-1.5 text-sm font-extrabold tabular-nums hover:bg-krem-koyu " +
                            (kritikMi ? "text-tehlike" : "text-metin-baslik")
                          }
                        >
                          {miktarYaz(Number(h.stok_miktar), h.birim)}
                          <span className="ml-1.5 text-[11px] font-bold text-metin-silik">
                            / kritik {miktarYaz(Number(h.kritik_seviye), h.birim)}
                          </span>
                        </button>
                        <button
                          onClick={() => {
                            setAlisYapilan(h.id);
                            setHDuzenlenen(null);
                            setAlisMiktar("");
                            setAlisTutar("");
                            setAlisBuyukBirim(true);
                          }}
                          className="rounded-[9px] bg-basari-zemin px-2.5 py-1.5 text-xs font-extrabold text-basari"
                        >
                          + Alış girişi
                        </button>
                        <button
                          onClick={() => setHSilinecek(h.id)}
                          className="rounded-[9px] px-2 py-1.5 text-xs font-bold text-metin-silik hover:bg-tehlike-zemin hover:text-tehlike"
                        >
                          sil
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </section>

      {/* ═══ VİTRİN ÜRÜNLERİ (adet takibi) ═══ */}
      <section className="mt-8">
        <h2 className="text-base font-extrabold">Vitrin ürünleri (adet takibi)</h2>
        <p className="mt-1 text-xs text-metin-soluk">
          Kek dilimi gibi hazır ürünler için. Stok bitince ürün menüden otomatik kalkar; hammadde
          bazlı ürünlerde (kahve vb.) bunu açma, reçete kullan.
        </p>

        {takipliler.length > 0 && (
          <div className="mt-2.5 divide-y divide-[#f6ede1] overflow-hidden rounded-2xl border border-cizgi bg-kart">
            {[...takipliler]
              .sort((a, b) => Number((a.stok_adet ?? 0) <= a.kritik_seviye ? 0 : 1) - Number((b.stok_adet ?? 0) <= b.kritik_seviye ? 0 : 1))
              .map((u) => {
                const stok = u.stok_adet ?? 0;
                const kritikMi = stok <= u.kritik_seviye;
                return (
                  <div
                    key={u.id}
                    className={"flex flex-wrap items-center gap-3 px-4 py-3 " + (kritikMi ? "bg-tehlike-zemin/40" : "")}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-[14.5px] font-bold">
                        {kritikMi && "⚠ "}
                        {u.ad}
                      </span>
                      {!u.aktif && (
                        <span className="ml-2 rounded-md bg-tehlike-zemin px-2 py-0.5 text-[11px] font-extrabold text-tehlike">
                          menüde pasif
                        </span>
                      )}
                      <span className="block text-xs text-metin-soluk">{u.kategori?.ad}</span>
                    </div>

                    {duzenlenen === u.id ? (
                      <div className="flex items-center gap-2 text-xs font-bold text-metin-soluk">
                        stok
                        <input
                          autoFocus
                          value={stokDegeri}
                          onChange={(e) => setStokDegeri(e.target.value)}
                          inputMode="numeric"
                          className={inputStil + " w-20 text-right"}
                        />
                        kritik
                        <input
                          value={kritikDegeri}
                          onChange={(e) => setKritikDegeri(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && stokKaydet(u)}
                          inputMode="numeric"
                          className={inputStil + " w-20 text-right"}
                        />
                        <button
                          onClick={() => stokKaydet(u)}
                          className="rounded-[9px] bg-basari px-3 py-2 text-xs font-extrabold text-white"
                        >
                          ✓
                        </button>
                      </div>
                    ) : girisYapilan === u.id ? (
                      <div className="flex items-center gap-2 text-xs font-bold text-metin-soluk">
                        gelen
                        <input
                          autoFocus
                          value={girisMiktari}
                          onChange={(e) => setGirisMiktari(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && malGirisi(u)}
                          inputMode="numeric"
                          placeholder="+adet"
                          className={inputStil + " w-20 text-right"}
                        />
                        <button
                          onClick={() => malGirisi(u)}
                          className="rounded-[9px] bg-basari px-3 py-2 text-xs font-extrabold text-white"
                        >
                          Ekle ✓
                        </button>
                        <button onClick={() => setGirisYapilan(null)} className="px-1">
                          Vazgeç
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setDuzenlenen(u.id);
                            setGirisYapilan(null);
                            setStokDegeri(String(stok));
                            setKritikDegeri(String(u.kritik_seviye));
                          }}
                          className={
                            "rounded-lg px-2.5 py-1.5 text-sm font-extrabold tabular-nums hover:bg-krem-koyu " +
                            (kritikMi ? "text-tehlike" : "text-metin-baslik")
                          }
                        >
                          {stok} adet
                          <span className="ml-1.5 text-[11px] font-bold text-metin-silik">
                            / kritik {u.kritik_seviye}
                          </span>
                        </button>
                        <button
                          onClick={() => {
                            setGirisYapilan(u.id);
                            setDuzenlenen(null);
                            setGirisMiktari("");
                          }}
                          className="rounded-[9px] bg-basari-zemin px-2.5 py-1.5 text-xs font-extrabold text-basari"
                        >
                          + Mal geldi
                        </button>
                        <button
                          onClick={() => urunGuncelle(u.id, { stok_takip: false })}
                          className="rounded-[9px] px-2 py-1.5 text-xs font-bold text-metin-silik hover:bg-krem-koyu"
                        >
                          kapat
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}

        <div className="mt-2.5 divide-y divide-[#f6ede1] overflow-hidden rounded-2xl border border-cizgi bg-kart">
          {takipsizler.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-2.5 opacity-80">
              <div className="min-w-0 flex-1">
                <span className="text-sm font-bold">{u.ad}</span>
                <span className="ml-2 text-xs text-metin-soluk">{u.kategori?.ad}</span>
              </div>
              <button
                onClick={() => urunGuncelle(u.id, { stok_takip: true, stok_adet: u.stok_adet ?? 0 })}
                className="rounded-[9px] bg-krem-koyu px-3 py-1.5 text-xs font-extrabold text-metin-orta hover:bg-basari-zemin hover:text-basari"
              >
                Adet takibi aç
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
