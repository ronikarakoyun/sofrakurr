"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useKullanici } from "@/lib/useKullanici";
import { tl, DURUM_ETIKET, type SiparisDurum } from "@/lib/types";
import { BarGrafik, type Cubuk } from "@/components/BarGrafik";
import {
  aralikTarihleri,
  gunBasi,
  tarihStr,
  GUN_ADI,
  ARALIK_ETIKET,
  type Aralik,
} from "@/lib/tarihAraligi";

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
  cariye_yazilan: number;
  cari_tahsilat: number;
}

interface UrunSatir {
  urun_ad: string;
  adet: number;
  ciro: number;
  maliyet: number | null;
}

interface IptalSatir {
  zaman: string;
  masa_ad: string;
  durum: SiparisDurum;
  tutar: number;
  kalemler: string | null;
}

export default function RaporlarPage() {
  const { kullanici, yukleniyor } = useKullanici(["admin"]);
  const [aralik, setAralik] = useState<Aralik>("yedi");
  const [ozelBas, setOzelBas] = useState(tarihStr(gunBasi(-7)));
  const [ozelBit, setOzelBit] = useState(tarihStr(gunBasi()));
  const [ozet, setOzet] = useState<Ozet | null>(null);
  const [gunluk, setGunluk] = useState<Cubuk[]>([]);
  const [saatlik, setSaatlik] = useState<Cubuk[]>([]);
  const [urunler, setUrunler] = useState<UrunSatir[]>([]);
  const [iptaller, setIptaller] = useState<IptalSatir[]>([]);
  const [kanallar, setKanallar] = useState<{ kanal: string; siparis_sayisi: number }[]>([]);
  const [hata, setHata] = useState(false);
  // Özet dışındaki raporlardan biri hata verirse: sayfa yine gösterilir ama
  // o bölüm sessizce boş kalmasın diye üstte uyarı çıkar.
  const [kismiHata, setKismiHata] = useState<string | null>(null);

  const yenile = useCallback(async () => {
    if (!kullanici) return;
    const supabase = createClient();
    const [bas, bit] = aralikTarihleri(aralik, ozelBas, ozelBit);
    const p = { p_baslangic: bas.toISOString(), p_bitis: bit.toISOString() };

    const [oz, g, s, u, ip, k] = await Promise.all([
      supabase.rpc("rapor_ozet", p),
      supabase.rpc("rapor_gunluk", p),
      supabase.rpc("rapor_saatlik", p),
      supabase.rpc("rapor_urun", p),
      supabase.rpc("rapor_iptaller", p),
      supabase.rpc("rapor_personel", p),
    ]);
    if (oz.error) {
      setHata(true);
      return;
    }
    setHata(false);
    // Özet dışındaki her RPC'nin hatasını topla — biri patlarsa (ör. imza
    // uyuşmazlığı) o tablo sessizce boş gelmesin, gerçek mesaj görünsün.
    const digerHatalar = [
      ["Günlük ciro", g.error],
      ["Saatlik yoğunluk", s.error],
      ["Ürün satışları", u.error],
      ["İptal/red", ip.error],
      ["Kanal", k.error],
    ].filter(([, e]) => e) as [string, { message: string }][];
    setKismiHata(
      digerHatalar.length
        ? digerHatalar.map(([ad, e]) => `${ad}: ${e.message}`).join(" · ")
        : null
    );
    setOzet((oz.data as Ozet[])[0] ?? null);

    // günlük seri — aralıktaki her günü doldur
    const gunlukVeri = (g.data ?? []) as { gun: string; ciro: number }[];
    const gunSayisi = Math.min(Math.round((bit.getTime() - bas.getTime()) / 86400_000), 62);
    const seri: Cubuk[] = [];
    for (let i = 0; i < gunSayisi; i++) {
      const d = new Date(bas.getTime() + i * 86400_000);
      const kayit = gunlukVeri.find((x) => x.gun === tarihStr(d));
      seri.push({
        etiket:
          gunSayisi <= 8
            ? GUN_ADI[d.getDay()]
            : i % Math.ceil(gunSayisi / 10) === 0
              ? `${d.getDate()}.${d.getMonth() + 1}`
              : "",
        deger: Number(kayit?.ciro ?? 0),
        ipucu: `${d.getDate()}.${d.getMonth() + 1} — ${tl(Number(kayit?.ciro ?? 0))}`,
      });
    }
    setGunluk(seri);

    const saatVeri = (s.data ?? []) as { saat: number; siparis_sayisi: number }[];
    const saatSeri: Cubuk[] = [];
    for (let h = 7; h <= 23; h++) {
      const kayit = saatVeri.find((x) => x.saat === h);
      saatSeri.push({
        etiket: h % 3 === 1 ? String(h) : "",
        deger: Number(kayit?.siparis_sayisi ?? 0),
        ipucu: `${String(h).padStart(2, "0")}:00 — ${kayit?.siparis_sayisi ?? 0} sipariş`,
      });
    }
    setSaatlik(saatSeri);

    setUrunler((u.data ?? []) as UrunSatir[]);
    setIptaller((ip.data ?? []) as IptalSatir[]);
    setKanallar((k.data ?? []) as { kanal: string; siparis_sayisi: number }[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kullanici, aralik, ozelBas, ozelBit]);

  useEffect(() => {
    yenile();
  }, [yenile]);

  if (yukleniyor) {
    return <p className="animate-pulse text-metin-soluk">Yükleniyor…</p>;
  }
  if (hata) {
    return (
      <p className="max-w-[560px] rounded-2xl bg-uyari-zemin p-4 text-sm text-uyari">
        Rapor fonksiyonları bulunamadı — son veritabanı güncellemesinin (0005) uygulanması
        gerekiyor.
      </p>
    );
  }

  const toplamMaliyet = urunler.reduce((t, u) => t + (u.maliyet != null ? Number(u.maliyet) : 0), 0);
  const maliyetliCiro = urunler
    .filter((u) => u.maliyet != null)
    .reduce((t, u) => t + Number(u.ciro), 0);

  const cipTemel = "rounded-full px-4 py-2 text-[13px] font-bold";

  return (
    <div className="max-w-[900px]">
      <h1 className="font-serif text-2xl font-semibold text-metin-baslik">Raporlar</h1>

      {kismiHata && (
        <p className="mt-3 rounded-xl bg-uyari-zemin px-3 py-2 text-[12.5px] font-semibold text-uyari">
          Bazı raporlar yüklenemedi — {kismiHata}
        </p>
      )}

      {/* Aralık seçici */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {ARALIK_ETIKET.map(([deger, etiket]) => (
          <button
            key={deger}
            onClick={() => setAralik(deger)}
            className={
              cipTemel +
              (aralik === deger
                ? " marka-gradyan text-white"
                : " border border-cizgi-koyu bg-kart text-metin-orta")
            }
          >
            {etiket}
          </button>
        ))}
        {aralik === "ozel" && (
          <span className="flex items-center gap-2 text-sm">
            <input
              type="date"
              value={ozelBas}
              onChange={(e) => setOzelBas(e.target.value)}
              className="rounded-[10px] border border-cizgi-koyu bg-kart px-2.5 py-1.5 text-sm outline-none"
            />
            —
            <input
              type="date"
              value={ozelBit}
              onChange={(e) => setOzelBit(e.target.value)}
              className="rounded-[10px] border border-cizgi-koyu bg-kart px-2.5 py-1.5 text-sm outline-none"
            />
          </span>
        )}
      </div>

      {/* Özet kartları */}
      {ozet && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[
            { etiket: "Ciro", deger: tl(Number(ozet.ciro)) },
            { etiket: "💵 Nakit", deger: tl(Number(ozet.nakit_ciro)) },
            { etiket: "💳 Kart", deger: tl(Number(ozet.kart_ciro)) },
            { etiket: "Kapanan hesap", deger: String(ozet.adisyon_sayisi) },
            { etiket: "Ortalama hesap", deger: tl(Number(ozet.ortalama_adisyon)) },
            { etiket: "Sipariş", deger: String(ozet.siparis_sayisi) },
            {
              etiket: "Yaklaşık kâr*",
              deger: maliyetliCiro > 0 ? tl(maliyetliCiro - toplamMaliyet) : "—",
            },
            {
              etiket: "İptal / red",
              deger: String(ozet.iptal_sayisi),
              alt: Number(ozet.iptal_tutar) > 0 ? tl(Number(ozet.iptal_tutar)) : undefined,
              kirmizi: ozet.iptal_sayisi > 0,
            },
            ...(Number(ozet.ikram_tutar) > 0
              ? [{ etiket: "İkram", deger: tl(Number(ozet.ikram_tutar)) }]
              : []),
            ...(Number(ozet.iskonto_tutar) > 0
              ? [{ etiket: "İskonto", deger: tl(Number(ozet.iskonto_tutar)) }]
              : []),
            ...(Number(ozet.cariye_yazilan) > 0
              ? [{ etiket: "Cariye yazılan", deger: tl(Number(ozet.cariye_yazilan)) }]
              : []),
            ...(Number(ozet.cari_tahsilat) > 0
              ? [{ etiket: "Cari tahsilat", deger: tl(Number(ozet.cari_tahsilat)) }]
              : []),
          ].map((k) => (
            <div key={k.etiket} className="rounded-2xl border border-cizgi bg-kart px-4 py-3.5">
              <div className="text-xs font-bold text-metin-soluk">{k.etiket}</div>
              <div
                className={
                  "mt-1 text-[20px] font-extrabold tabular-nums " +
                  (k.kirmizi ? "text-tehlike" : "text-metin-baslik")
                }
              >
                {k.deger}
              </div>
              {k.alt && <div className="text-[11px] font-bold text-metin-silik">{k.alt}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-cizgi bg-kart p-4">
          <h2 className="text-sm font-extrabold">Günlük ciro</h2>
          <div className="mt-6">{gunluk.length > 0 && <BarGrafik veriler={gunluk} formatla={(n) => tl(n)} />}</div>
        </section>
        <section className="rounded-2xl border border-cizgi bg-kart p-4">
          <h2 className="text-sm font-extrabold">Saatlik yoğunluk (sipariş)</h2>
          <div className="mt-6">
            {saatlik.length > 0 && <BarGrafik veriler={saatlik} formatla={(n) => `${n} sipariş`} />}
          </div>
        </section>
      </div>

      {/* Ürün satışları */}
      <section className="mt-4 rounded-2xl border border-cizgi bg-kart p-4">
        <h2 className="text-sm font-extrabold">Ürün satışları</h2>
        {urunler.length === 0 ? (
          <p className="mt-3 text-sm text-metin-soluk">Bu aralıkta kapanan hesap yok.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
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
                {urunler.map((u) => {
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
                        {kar != null && Number(u.ciro) > 0
                          ? `%${Math.round((kar / Number(u.ciro)) * 100)}`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11.5px] text-metin-silik">
          * Maliyet, ürün reçetesi ve hammaddelerin son alış fiyatlarından yaklaşık hesaplanır;
          reçetesi olmayan ürünlerde gösterilmez.
        </p>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* İptal / kayıp */}
        <section className="rounded-2xl border border-cizgi bg-kart p-4">
          <h2 className="text-sm font-extrabold">İptal &amp; red kayıtları</h2>
          {iptaller.length === 0 ? (
            <p className="mt-3 text-sm text-metin-soluk">Bu aralıkta iptal/red yok. 👍</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {iptaller.slice(0, 20).map((s, i) => (
                <div key={i} className="flex items-start justify-between gap-2 text-[13px]">
                  <span className="min-w-0">
                    <span className="font-bold">{s.masa_ad}</span>
                    <span className="ml-1.5 rounded bg-tehlike-zemin px-1.5 py-0.5 text-[10.5px] font-extrabold text-tehlike">
                      {DURUM_ETIKET[s.durum]}
                    </span>
                    <span className="block truncate text-metin-soluk">{s.kalemler}</span>
                  </span>
                  <span className="whitespace-nowrap text-right">
                    <span className="block font-bold tabular-nums">{tl(Number(s.tutar))}</span>
                    <span className="text-[11px] text-metin-silik">
                      {new Date(s.zaman).toLocaleString("tr-TR", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Kanal kırılımı */}
        <section className="rounded-2xl border border-cizgi bg-kart p-4">
          <h2 className="text-sm font-extrabold">Siparişi kim aldı</h2>
          {kanallar.length === 0 ? (
            <p className="mt-3 text-sm text-metin-soluk">Bu aralıkta sipariş yok.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {kanallar.map((k) => {
                const enCok = Number(kanallar[0].siparis_sayisi) || 1;
                return (
                  <div key={k.kanal} className="flex items-center gap-3 text-sm">
                    <span className="w-32 truncate font-semibold">{k.kanal}</span>
                    <div className="h-4 flex-1 overflow-hidden rounded-r">
                      <div
                        className="h-full rounded-r"
                        style={{
                          width: `${(Number(k.siparis_sayisi) / enCok) * 100}%`,
                          background: "#c86f2c",
                        }}
                      />
                    </div>
                    <span className="w-16 text-right text-[13px] font-bold tabular-nums">
                      {k.siparis_sayisi}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
