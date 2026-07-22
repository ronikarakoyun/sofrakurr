"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useKullanici } from "@/lib/useKullanici";
import { tl } from "@/lib/types";
import { BarGrafik, type Cubuk } from "@/components/BarGrafik";

interface Ozet {
  ciro: number;
  nakit_ciro: number;
  kart_ciro: number;
  adisyon_sayisi: number;
  siparis_sayisi: number;
  ortalama_adisyon: number;
  iptal_sayisi: number;
  iptal_tutar: number;
  ikram_tutar: number;
  iskonto_tutar: number;
}

interface Anlik {
  odemeBekleyen: number;
  mutfakta: number;
  doluMasa: number;
  toplamMasa: number;
  acikCagri: number;
}

const GUN_ADI = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

function bugunBasi(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function AdminGenelBakis() {
  const { kullanici, yukleniyor } = useKullanici(["admin"]);
  const [ozet, setOzet] = useState<Ozet | null>(null);
  const [anlik, setAnlik] = useState<Anlik | null>(null);
  const [cokSatanlar, setCokSatanlar] = useState<{ urun_ad: string; adet: number; ciro: number }[]>([]);
  const [haftalik, setHaftalik] = useState<Cubuk[]>([]);
  const [saatlik, setSaatlik] = useState<Cubuk[]>([]);
  const [rporHatasi, setRaporHatasi] = useState(false);

  const yenile = useCallback(async () => {
    if (!kullanici) return;
    const supabase = createClient();
    const simdi = new Date();
    const bugun = bugunBasi();
    const yediGunOnce = new Date(bugun.getTime() - 6 * 86400_000);
    const yarin = new Date(bugun.getTime() + 86400_000);

    const [oz, urun, gunluk, saat, odeme, mutfak, adisyon, masa, cagri] = await Promise.all([
      supabase.rpc("rapor_ozet", { p_baslangic: bugun.toISOString(), p_bitis: yarin.toISOString() }),
      supabase.rpc("rapor_urun", { p_baslangic: bugun.toISOString(), p_bitis: yarin.toISOString() }),
      supabase.rpc("rapor_gunluk", { p_baslangic: yediGunOnce.toISOString(), p_bitis: yarin.toISOString() }),
      supabase.rpc("rapor_saatlik", { p_baslangic: bugun.toISOString(), p_bitis: yarin.toISOString() }),
      supabase.from("siparis").select("id", { count: "exact", head: true }).eq("durum", "odeme_bekliyor"),
      supabase.from("siparis").select("id", { count: "exact", head: true }).in("durum", ["bekliyor", "hazirlaniyor", "hazir"]),
      supabase.from("adisyon").select("masa_id").eq("durum", "acik"),
      supabase.from("masa").select("id", { count: "exact", head: true }).eq("aktif", true),
      supabase.from("garson_cagri").select("id", { count: "exact", head: true }).eq("acik", true),
    ]);

    if (oz.error) {
      setRaporHatasi(true);
      return;
    }
    setRaporHatasi(false);
    setOzet((oz.data as Ozet[])[0] ?? null);
    setCokSatanlar(((urun.data ?? []) as { urun_ad: string; adet: number; ciro: number }[]).slice(0, 5));

    // Son 7 gün — eksik günleri 0 ile doldur
    const gunler: Cubuk[] = [];
    const gunlukVeri = (gunluk.data ?? []) as { gun: string; ciro: number }[];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(bugun.getTime() - i * 86400_000);
      const anahtar = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const kayit = gunlukVeri.find((g) => g.gun === anahtar);
      gunler.push({
        etiket: i === 0 ? "Bugün" : GUN_ADI[d.getDay()],
        deger: Number(kayit?.ciro ?? 0),
        vurgu: i === 0,
        ipucu: `${d.getDate()}.${d.getMonth() + 1} — ${tl(Number(kayit?.ciro ?? 0))}`,
      });
    }
    setHaftalik(gunler);

    // Bugün saatlik yoğunluk (07–23)
    const saatVeri = (saat.data ?? []) as { saat: number; siparis_sayisi: number }[];
    const suSaat = simdi.getHours();
    const saatler: Cubuk[] = [];
    for (let h = 7; h <= 23; h++) {
      const kayit = saatVeri.find((s) => s.saat === h);
      saatler.push({
        etiket: h % 3 === 1 ? String(h) : "",
        deger: Number(kayit?.siparis_sayisi ?? 0),
        vurgu: h === suSaat,
        ipucu: `${String(h).padStart(2, "0")}:00 — ${kayit?.siparis_sayisi ?? 0} sipariş`,
      });
    }
    setSaatlik(saatler);

    setAnlik({
      odemeBekleyen: odeme.count ?? 0,
      mutfakta: mutfak.count ?? 0,
      doluMasa: new Set((adisyon.data ?? []).map((a) => a.masa_id)).size,
      toplamMasa: masa.count ?? 0,
      acikCagri: cagri.count ?? 0,
    });
  }, [kullanici]);

  useEffect(() => {
    yenile();
    const z = setInterval(yenile, 30_000);
    return () => clearInterval(z);
  }, [yenile]);

  if (yukleniyor) {
    return <p className="animate-pulse text-metin-soluk">Yükleniyor…</p>;
  }

  if (rporHatasi) {
    return (
      <div className="max-w-[640px]">
        <h1 className="font-serif text-2xl font-semibold text-metin-baslik">Genel Bakış</h1>
        <p className="mt-4 rounded-2xl bg-uyari-zemin p-4 text-sm text-uyari">
          Rapor fonksiyonları veritabanında bulunamadı — son veritabanı güncellemesinin (0005)
          SQL Editor&apos;den uygulanması gerekiyor.
        </p>
      </div>
    );
  }

  const kartlar = ozet
    ? [
        { etiket: "Bugünkü ciro", deger: tl(Number(ozet.ciro)) },
        { etiket: "💵 Nakit", deger: tl(Number(ozet.nakit_ciro)) },
        { etiket: "💳 Kart", deger: tl(Number(ozet.kart_ciro)) },
        { etiket: "Kapanan hesap", deger: String(ozet.adisyon_sayisi) },
        { etiket: "Ortalama hesap", deger: tl(Number(ozet.ortalama_adisyon)) },
        { etiket: "Sipariş", deger: String(ozet.siparis_sayisi) },
        {
          etiket: "İptal / red",
          deger: `${ozet.iptal_sayisi}`,
          alt: Number(ozet.iptal_tutar) > 0 ? tl(Number(ozet.iptal_tutar)) : undefined,
          kirmizi: ozet.iptal_sayisi > 0,
        },
      ]
    : [];

  return (
    <div className="max-w-[900px]">
      <div className="flex items-baseline gap-3">
        <h1 className="font-serif text-2xl font-semibold text-metin-baslik">Genel Bakış</h1>
        <span className="text-[13px] text-metin-soluk">
          {new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" })}
        </span>
      </div>

      {/* Bugün kartları */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {kartlar.map((k) => (
          <div key={k.etiket} className="rounded-2xl border border-cizgi bg-kart px-4 py-3.5">
            <div className="text-xs font-bold text-metin-soluk">{k.etiket}</div>
            <div
              className={
                "mt-1 text-[22px] font-extrabold tabular-nums " +
                (k.kirmizi ? "text-tehlike" : "text-metin-baslik")
              }
            >
              {k.deger}
            </div>
            {k.alt && <div className="text-[11px] font-bold text-metin-silik">{k.alt}</div>}
          </div>
        ))}
      </div>

      {/* Anlık durum */}
      {anlik && (
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-uyari-zemin px-3.5 py-1.5 text-[13px] font-bold text-uyari">
            {anlik.odemeBekleyen} ödeme bekliyor
          </span>
          <span className="rounded-full bg-[#e9f0f9] px-3.5 py-1.5 text-[13px] font-bold text-[#31639c]">
            {anlik.mutfakta} sipariş mutfakta
          </span>
          <span className="rounded-full bg-krem-koyu px-3.5 py-1.5 text-[13px] font-bold text-metin-orta">
            {anlik.doluMasa}/{anlik.toplamMasa} masa dolu
          </span>
          {anlik.acikCagri > 0 && (
            <span className="rounded-full bg-tehlike-zemin px-3.5 py-1.5 text-[13px] font-bold text-tehlike">
              {anlik.acikCagri} açık çağrı
            </span>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Son 7 gün ciro */}
        <section className="rounded-2xl border border-cizgi bg-kart p-4">
          <h2 className="text-sm font-extrabold">Son 7 gün ciro</h2>
          <div className="mt-6">
            {haftalik.length > 0 && <BarGrafik veriler={haftalik} formatla={(n) => tl(n)} />}
          </div>
        </section>

        {/* Bugün saatlik yoğunluk */}
        <section className="rounded-2xl border border-cizgi bg-kart p-4">
          <h2 className="text-sm font-extrabold">Bugün saatlik yoğunluk (sipariş)</h2>
          <div className="mt-6">
            {saatlik.length > 0 && (
              <BarGrafik veriler={saatlik} formatla={(n) => `${n} sipariş`} />
            )}
          </div>
        </section>
      </div>

      {/* Bugün çok satanlar */}
      <section className="mt-4 rounded-2xl border border-cizgi bg-kart p-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-extrabold">Bugün en çok satanlar</h2>
          <span className="flex-1" />
          <Link href="/admin/raporlar" className="text-[13px] font-bold text-marka-koyu hover:underline">
            Tüm raporlar →
          </Link>
        </div>
        {cokSatanlar.length === 0 ? (
          <p className="mt-3 text-sm text-metin-soluk">Bugün henüz kapanan hesap yok.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {cokSatanlar.map((u, i) => {
              const enCok = Number(cokSatanlar[0].ciro) || 1;
              return (
                <div key={u.urun_ad} className="flex items-center gap-3 text-sm">
                  <span className="w-5 text-right font-extrabold text-metin-silik">{i + 1}</span>
                  <span className="w-40 truncate font-semibold sm:w-56">{u.urun_ad}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded-r">
                    <div
                      className="h-full rounded-r"
                      style={{ width: `${(Number(u.ciro) / enCok) * 100}%`, background: "#c86f2c" }}
                    />
                  </div>
                  <span className="w-14 text-right text-[13px] tabular-nums text-metin-soluk">
                    {u.adet} adet
                  </span>
                  <span className="w-20 text-right text-[13px] font-bold tabular-nums text-metin-baslik">
                    {tl(Number(u.ciro))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
