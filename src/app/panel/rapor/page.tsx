"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useKullanici } from "@/lib/useKullanici";
import { tl } from "@/lib/types";
import { BarGrafik, type Cubuk } from "@/components/BarGrafik";
import {
  aralikTarihleri,
  gunBasi,
  tarihStr,
  GUN_ADI,
  ARALIK_ETIKET,
  type Aralik,
} from "@/lib/tarihAraligi";

type Sekme = "ozet" | "subeler" | "trend" | "urunler" | "sadakat";

const SEKMELER: [Sekme, string][] = [
  ["ozet", "Özet"],
  ["subeler", "Şubeler"],
  ["trend", "Trend"],
  ["urunler", "Ürünler"],
  ["sadakat", "Sadakat"],
];

interface Ozet {
  ciro: number; nakit_ciro: number; kart_ciro: number;
  adisyon_sayisi: number; siparis_sayisi: number; ortalama_adisyon: number;
  aktif_kafe_sayisi: number; kafe_sayisi: number; onceki_ciro: number;
}
interface SubeSatir {
  cafe_id: string; cafe_ad: string; zincir_ad: string | null; cafe_aktif: boolean;
  ciro: number; adisyon_sayisi: number; ortalama_adisyon: number;
  siparis_sayisi: number; onceki_ciro: number;
}
interface UrunSatir { urun_ad: string; adet: number; ciro: number; maliyet: number | null }
interface SadakatOzet {
  kazanilan_puan: number; harcanan_puan: number;
  kazanim_sayisi: number; harcama_sayisi: number; aktif_uye: number;
}
interface SadakatSube {
  cafe_id: string; cafe_ad: string;
  kazanilan_puan: number; harcanan_puan: number; aktif_uye: number;
}
interface Zincir { id: string; ad: string }

// Ciro değişim yüzdesi (önceki döneme göre). Önceki 0 ise gösterme.
function degisim(bu: number, onceki: number): { metin: string; artis: boolean } | null {
  const b = Number(bu), o = Number(onceki);
  if (!o) return null;
  const y = Math.round(((b - o) / o) * 100);
  return { metin: `${y > 0 ? "+" : ""}%${y}`, artis: y >= 0 };
}

export default function PlatformRaporSayfasi() {
  const { kullanici, yukleniyor } = useKullanici(["franchise", "super_admin"]);
  const superMi = kullanici?.rol === "super_admin";

  const [sekme, setSekme] = useState<Sekme>("ozet");
  const [aralik, setAralik] = useState<Aralik>("yedi");
  const [ozelBas, setOzelBas] = useState(tarihStr(gunBasi(-7)));
  const [ozelBit, setOzelBit] = useState(tarihStr(gunBasi()));
  const [zincirId, setZincirId] = useState<string | null>(null);
  const [zincirler, setZincirler] = useState<Zincir[]>([]);

  const [ozet, setOzet] = useState<Ozet | null>(null);
  const [subeler, setSubeler] = useState<SubeSatir[]>([]);
  const [gunluk, setGunluk] = useState<Cubuk[]>([]);
  const [saatlik, setSaatlik] = useState<Cubuk[]>([]);
  const [urunler, setUrunler] = useState<UrunSatir[]>([]);
  const [sadakat, setSadakat] = useState<SadakatOzet | null>(null);
  const [sadakatSube, setSadakatSube] = useState<SadakatSube[]>([]);

  const [yukleniyorVeri, setYukleniyorVeri] = useState(true);
  const [hata, setHata] = useState<string | null>(null);

  // Süper admin: zincir seçici için liste (franchise'ta kendi zinciri sabit)
  useEffect(() => {
    if (!kullanici || !superMi) return;
    const supabase = createClient();
    supabase.rpc("zincir_listesi").then(({ data }) => {
      setZincirler((data as Zincir[]) ?? []);
    });
  }, [kullanici, superMi]);

  const yukle = useCallback(async () => {
    if (!kullanici) return;
    setYukleniyorVeri(true);
    setHata(null);
    const supabase = createClient();
    const [bas, bit] = aralikTarihleri(aralik, ozelBas, ozelBit);
    const p = {
      p_baslangic: bas.toISOString(),
      p_bitis: bit.toISOString(),
      p_zincir_id: zincirId,
    };

    try {
      if (sekme === "ozet") {
        const { data, error } = await supabase.rpc("platform_ozet", p);
        if (error) throw error;
        setOzet((data as Ozet[])[0] ?? null);
      } else if (sekme === "subeler") {
        const { data, error } = await supabase.rpc("platform_sube_karsilastirma", p);
        if (error) throw error;
        setSubeler((data as SubeSatir[]) ?? []);
      } else if (sekme === "trend") {
        const [g, s] = await Promise.all([
          supabase.rpc("platform_gunluk", p),
          supabase.rpc("platform_saatlik", p),
        ]);
        if (g.error) throw g.error;
        if (s.error) throw s.error;
        // günlük seri: aralıktaki her günü doldur
        const gv = (g.data ?? []) as { gun: string; ciro: number }[];
        const gunSayisi = Math.min(Math.round((bit.getTime() - bas.getTime()) / 86400_000), 62);
        const gseri: Cubuk[] = [];
        for (let i = 0; i < gunSayisi; i++) {
          const d = new Date(bas.getTime() + i * 86400_000);
          const kayit = gv.find((x) => x.gun === tarihStr(d));
          gseri.push({
            etiket:
              gunSayisi <= 8 ? GUN_ADI[d.getDay()]
              : i % Math.ceil(gunSayisi / 10) === 0 ? `${d.getDate()}.${d.getMonth() + 1}` : "",
            deger: Number(kayit?.ciro ?? 0),
            ipucu: `${d.getDate()}.${d.getMonth() + 1} — ${tl(Number(kayit?.ciro ?? 0))}`,
          });
        }
        setGunluk(gseri);
        // saatlik seri 07–23
        const sv = (s.data ?? []) as { saat: number; siparis_sayisi: number }[];
        const sseri: Cubuk[] = [];
        for (let h = 7; h <= 23; h++) {
          const kayit = sv.find((x) => x.saat === h);
          sseri.push({
            etiket: h % 3 === 1 ? String(h) : "",
            deger: Number(kayit?.siparis_sayisi ?? 0),
            ipucu: `${String(h).padStart(2, "0")}:00 — ${kayit?.siparis_sayisi ?? 0} sipariş`,
          });
        }
        setSaatlik(sseri);
      } else if (sekme === "urunler") {
        const { data, error } = await supabase.rpc("platform_urun", p);
        if (error) throw error;
        setUrunler((data as UrunSatir[]) ?? []);
      } else if (sekme === "sadakat") {
        const [o, sb] = await Promise.all([
          supabase.rpc("platform_sadakat", p),
          supabase.rpc("platform_sadakat_sube", p),
        ]);
        if (o.error) throw o.error;
        if (sb.error) throw sb.error;
        setSadakat((o.data as SadakatOzet[])[0] ?? null);
        setSadakatSube((sb.data as SadakatSube[]) ?? []);
      }
    } catch (e) {
      setHata("Rapor yüklenemedi: " + (e as { message?: string }).message);
    } finally {
      setYukleniyorVeri(false);
    }
  }, [kullanici, sekme, aralik, ozelBas, ozelBit, zincirId]);

  useEffect(() => {
    yukle();
  }, [yukle]);

  if (yukleniyor || !kullanici) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-krem">
        <p className="animate-pulse text-metin-soluk">Yükleniyor…</p>
      </main>
    );
  }

  const cip = "rounded-full px-3.5 py-1.5 text-[12.5px] font-bold";

  return (
    <main className="min-h-dvh bg-krem px-5 pb-12 pt-6 text-metin">
      <div className="mx-auto max-w-[940px]">
        <Link href="/panel" className="text-[13px] font-bold text-metin-soluk">
          ← Panele dön
        </Link>
        <h1 className="mt-2 font-serif text-2xl font-semibold text-metin-baslik">
          {superMi ? "Platform Raporu" : "Zincir Raporu"}
        </h1>

        {/* Tarih aralığı + (süper adminde) zincir seçici */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {ARALIK_ETIKET.map(([deger, etiket]) => (
            <button
              key={deger}
              onClick={() => setAralik(deger)}
              className={
                cip +
                (aralik === deger
                  ? " marka-gradyan text-white"
                  : " border border-cizgi-koyu bg-kart text-metin-orta")
              }
            >
              {etiket}
            </button>
          ))}
          {aralik === "ozel" && (
            <span className="flex items-center gap-1.5 text-sm">
              <input type="date" value={ozelBas} onChange={(e) => setOzelBas(e.target.value)}
                className="rounded-[10px] border border-cizgi-koyu bg-kart px-2.5 py-1.5 text-sm outline-none" />
              —
              <input type="date" value={ozelBit} onChange={(e) => setOzelBit(e.target.value)}
                className="rounded-[10px] border border-cizgi-koyu bg-kart px-2.5 py-1.5 text-sm outline-none" />
            </span>
          )}
          {superMi && (
            <select
              value={zincirId ?? ""}
              onChange={(e) => setZincirId(e.target.value || null)}
              className="ml-auto rounded-[10px] border border-cizgi-koyu bg-kart px-2.5 py-1.5 text-sm font-semibold outline-none"
            >
              <option value="">Tüm kafeler</option>
              {zincirler.map((z) => (
                <option key={z.id} value={z.id}>{z.ad}</option>
              ))}
            </select>
          )}
        </div>

        {/* Sekmeler */}
        <div className="mt-4 flex overflow-x-auto rounded-xl bg-krem-koyu p-0.5 text-[13px] font-extrabold">
          {SEKMELER.map(([id, etiket]) => (
            <button
              key={id}
              onClick={() => setSekme(id)}
              className={
                "flex-1 whitespace-nowrap rounded-lg px-3 py-2 " +
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

        {yukleniyorVeri ? (
          <p className="animate-pulse py-10 text-center text-[13px] text-metin-soluk">
            Rapor hazırlanıyor…
          </p>
        ) : (
          <div className="mt-4">
            {sekme === "ozet" && ozet && <OzetGorunum ozet={ozet} />}
            {sekme === "subeler" && <SubelerGorunum satirlar={subeler} />}
            {sekme === "trend" && <TrendGorunum gunluk={gunluk} saatlik={saatlik} />}
            {sekme === "urunler" && <UrunlerGorunum satirlar={urunler} />}
            {sekme === "sadakat" && (
              <SadakatGorunum ozet={sadakat} subeler={sadakatSube} />
            )}
          </div>
        )}
      </div>
    </main>
  );
}

/* ── Sekme görünümleri ─────────────────────────────────────────────── */

function Kart({ etiket, deger, alt }: { etiket: string; deger: string; alt?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-cizgi bg-kart px-4 py-3.5">
      <div className="text-xs font-bold text-metin-soluk">{etiket}</div>
      <div className="mt-1 text-[20px] font-extrabold tabular-nums text-metin-baslik">{deger}</div>
      {alt && <div className="mt-0.5 text-[11.5px] font-bold">{alt}</div>}
    </div>
  );
}

function DegisimRozet({ bu, onceki }: { bu: number; onceki: number }) {
  const d = degisim(bu, onceki);
  if (!d) return null;
  return (
    <span className={d.artis ? "text-basari" : "text-tehlike"}>
      {d.metin} <span className="text-metin-silik">önceki döneme göre</span>
    </span>
  );
}

function OzetGorunum({ ozet }: { ozet: Ozet }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <Kart etiket="Toplam ciro" deger={tl(Number(ozet.ciro))}
        alt={<DegisimRozet bu={ozet.ciro} onceki={ozet.onceki_ciro} />} />
      <Kart etiket="💵 Nakit" deger={tl(Number(ozet.nakit_ciro))} />
      <Kart etiket="💳 Kart" deger={tl(Number(ozet.kart_ciro))} />
      <Kart etiket="Kapanan hesap" deger={String(ozet.adisyon_sayisi)} />
      <Kart etiket="Ortalama hesap" deger={tl(Number(ozet.ortalama_adisyon))} />
      <Kart etiket="Sipariş" deger={String(ozet.siparis_sayisi)} />
      <Kart etiket="Ciro yapan şube"
        deger={`${ozet.aktif_kafe_sayisi} / ${ozet.kafe_sayisi}`} />
    </div>
  );
}

function SubelerGorunum({ satirlar }: { satirlar: SubeSatir[] }) {
  if (satirlar.length === 0) {
    return <p className="py-4 text-center text-[13px] text-metin-soluk">Bu aralıkta kayıt yok.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-cizgi bg-kart">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-cizgi text-left text-xs font-extrabold text-metin-soluk">
            <th className="px-4 py-3">Şube</th>
            <th className="px-3 py-3 text-right">Ciro</th>
            <th className="px-3 py-3 text-right">Değişim</th>
            <th className="px-3 py-3 text-right">Hesap</th>
            <th className="px-4 py-3 text-right">Ort. sepet</th>
          </tr>
        </thead>
        <tbody>
          {satirlar.map((s) => (
            <tr key={s.cafe_id}
              className={"border-b border-[#f6ede1] last:border-0 " + (s.cafe_aktif ? "" : "opacity-55")}>
              <td className="px-4 py-2.5">
                <div className="font-bold text-metin-baslik">{s.cafe_ad}</div>
                <div className="text-[11.5px] text-metin-soluk">{s.zincir_ad ?? "Bağımsız"}</div>
              </td>
              <td className="px-3 py-2.5 text-right font-bold tabular-nums">{tl(Number(s.ciro))}</td>
              <td className="px-3 py-2.5 text-right text-[12px] tabular-nums">
                <DegisimSade bu={s.ciro} onceki={s.onceki_ciro} />
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-metin-soluk">{s.adisyon_sayisi}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-metin-soluk">
                {tl(Number(s.ortalama_adisyon))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DegisimSade({ bu, onceki }: { bu: number; onceki: number }) {
  const d = degisim(bu, onceki);
  if (!d) return <span className="text-metin-silik">—</span>;
  return <span className={d.artis ? "text-basari" : "text-tehlike"}>{d.metin}</span>;
}

function TrendGorunum({ gunluk, saatlik }: { gunluk: Cubuk[]; saatlik: Cubuk[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-cizgi bg-kart p-4">
        <h2 className="text-sm font-extrabold">Günlük ciro</h2>
        <div className="mt-6">{gunluk.length > 0 && <BarGrafik veriler={gunluk} formatla={(n) => tl(n)} />}</div>
      </section>
      <section className="rounded-2xl border border-cizgi bg-kart p-4">
        <h2 className="text-sm font-extrabold">Saatlik yoğunluk (sipariş)</h2>
        <div className="mt-6">{saatlik.length > 0 && <BarGrafik veriler={saatlik} formatla={(n) => `${n} sipariş`} />}</div>
      </section>
    </div>
  );
}

function UrunlerGorunum({ satirlar }: { satirlar: UrunSatir[] }) {
  if (satirlar.length === 0) {
    return <p className="py-4 text-center text-[13px] text-metin-soluk">Bu aralıkta satış yok.</p>;
  }
  return (
    <section className="rounded-2xl border border-cizgi bg-kart p-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-cizgi text-left text-xs font-extrabold text-metin-soluk">
              <th className="pb-2">Ürün</th>
              <th className="pb-2 text-right">Adet</th>
              <th className="pb-2 text-right">Ciro</th>
              <th className="pb-2 text-right">Maliyet*</th>
              <th className="pb-2 text-right">Kâr*</th>
              <th className="pb-2 text-right">Marj</th>
            </tr>
          </thead>
          <tbody>
            {satirlar.map((u) => {
              const maliyet = u.maliyet != null ? Number(u.maliyet) : null;
              const kar = maliyet != null ? Number(u.ciro) - maliyet : null;
              return (
                <tr key={u.urun_ad} className="border-b border-[#f6ede1] last:border-0">
                  <td className="py-2 font-semibold">{u.urun_ad}</td>
                  <td className="py-2 text-right tabular-nums">{u.adet}</td>
                  <td className="py-2 text-right font-bold tabular-nums">{tl(Number(u.ciro))}</td>
                  <td className="py-2 text-right tabular-nums text-metin-soluk">
                    {maliyet != null ? tl(maliyet) : "—"}
                  </td>
                  <td className="py-2 text-right font-bold tabular-nums text-basari">
                    {kar != null ? tl(kar) : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums text-metin-soluk">
                    {kar != null && Number(u.ciro) > 0 ? `%${Math.round((kar / Number(u.ciro)) * 100)}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11.5px] text-metin-silik">
        * Maliyet, ürün reçetesi ve hammaddelerin son alış fiyatlarından yaklaşık; reçetesi
        olmayan üründe gösterilmez. Aynı ürün zincir şubelerinde birleştirilir.
      </p>
    </section>
  );
}

function SadakatGorunum({ ozet, subeler }: { ozet: SadakatOzet | null; subeler: SadakatSube[] }) {
  return (
    <div>
      {ozet && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Kart etiket="Kazanılan puan" deger={String(ozet.kazanilan_puan)} />
          <Kart etiket="Harcanan puan" deger={String(ozet.harcanan_puan)} />
          <Kart etiket="Kazanım işlemi" deger={String(ozet.kazanim_sayisi)} />
          <Kart etiket="Harcama işlemi" deger={String(ozet.harcama_sayisi)} />
          <Kart etiket="Aktif üye" deger={String(ozet.aktif_uye)} />
        </div>
      )}
      {subeler.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-cizgi bg-kart">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-cizgi text-left text-xs font-extrabold text-metin-soluk">
                <th className="px-4 py-3">Şube</th>
                <th className="px-3 py-3 text-right">Kazanılan</th>
                <th className="px-3 py-3 text-right">Harcanan</th>
                <th className="px-4 py-3 text-right">Aktif üye</th>
              </tr>
            </thead>
            <tbody>
              {subeler.map((s) => (
                <tr key={s.cafe_id} className="border-b border-[#f6ede1] last:border-0">
                  <td className="px-4 py-2.5 font-bold text-metin-baslik">{s.cafe_ad}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-basari">{s.kazanilan_puan}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-metin-soluk">{s.harcanan_puan}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-metin-soluk">{s.aktif_uye}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!ozet && subeler.length === 0 && (
        <p className="py-4 text-center text-[13px] text-metin-soluk">Bu aralıkta sadakat hareketi yok.</p>
      )}
    </div>
  );
}
