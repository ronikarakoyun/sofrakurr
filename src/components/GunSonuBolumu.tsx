"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { tl, type Kullanici } from "@/lib/types";

interface Ozet {
  ciro: number;
  nakit_ciro: number;
  kart_ciro: number;
  adisyon_sayisi: number;
  siparis_sayisi: number;
  iptal_sayisi: number;
  iptal_tutar: number;
  ikram_tutar: number;
  iskonto_tutar: number;
}

interface Gider {
  id: string;
  tutar: number;
  aciklama: string;
  odeme_turu: "nakit" | "kart" | "cari";
  created_at: string;
}

interface GunSonuKaydi {
  id: string;
  tarih: string;
  acilis_nakit: number;
  beklenen_nakit: number;
  beklenen_kart: number;
  sayilan_nakit: number;
  sayilan_kart: number;
  devir_nakit: number;
  notu: string | null;
}

function bugunStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sayi(v: string): number {
  const n = parseFloat(v.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

// Kasa ekranının "Gün Sonu" sekmesi: gün özeti, giderler ve kasa mutabakatı.
export function GunSonuBolumu({ kullanici }: { kullanici: Kullanici }) {
  const [ozet, setOzet] = useState<Ozet | null>(null);
  const [giderler, setGiderler] = useState<Gider[]>([]);
  const [acikMasaSayisi, setAcikMasaSayisi] = useState(0);
  const [gecmis, setGecmis] = useState<GunSonuKaydi[]>([]);

  // form durumları
  const [giderTutar, setGiderTutar] = useState("");
  const [giderAciklama, setGiderAciklama] = useState("");
  const [acilisNakit, setAcilisNakit] = useState("0");
  const [sayilanNakit, setSayilanNakit] = useState("");
  const [sayilanKart, setSayilanKart] = useState("");
  const [devirNakit, setDevirNakit] = useState("");
  const [kapanisNotu, setKapanisNotu] = useState("");
  const [kapatSoruluyor, setKapatSoruluyor] = useState(false);
  const [kaydedildi, setKaydedildi] = useState(false);
  const [meskul, setMeskul] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const yenile = useCallback(async () => {
    const supabase = createClient();
    const gunBasi = new Date();
    gunBasi.setHours(0, 0, 0, 0);
    const yarin = new Date(gunBasi.getTime() + 86400_000);

    const [oz, g, acik, gs, bugunKayit] = await Promise.all([
      supabase.rpc("rapor_ozet", { p_baslangic: gunBasi.toISOString(), p_bitis: yarin.toISOString() }),
      supabase.from("gider").select("id, tutar, aciklama, odeme_turu, created_at").gte("created_at", gunBasi.toISOString()).order("created_at", { ascending: false }),
      supabase.from("adisyon").select("id", { count: "exact", head: true }).eq("durum", "acik"),
      supabase.from("gun_sonu").select("*").order("tarih", { ascending: false }).limit(8),
      supabase.from("gun_sonu").select("*").eq("tarih", bugunStr()).maybeSingle(),
    ]);

    setOzet(((oz.data ?? []) as Ozet[])[0] ?? null);
    setGiderler((g.data ?? []) as Gider[]);
    setAcikMasaSayisi(acik.count ?? 0);

    const kayitlar = (gs.data ?? []) as GunSonuKaydi[];
    setGecmis(kayitlar.filter((k) => k.tarih !== bugunStr()));

    // bugünün kaydı varsa formu doldur; yoksa açılışı son devrilenden öner
    const bugunku = bugunKayit.data as GunSonuKaydi | null;
    if (bugunku) {
      setAcilisNakit(String(bugunku.acilis_nakit));
      setSayilanNakit(String(bugunku.sayilan_nakit));
      setSayilanKart(String(bugunku.sayilan_kart));
      setDevirNakit(String(bugunku.devir_nakit));
      setKapanisNotu(bugunku.notu ?? "");
      setKaydedildi(true);
    } else {
      const sonKapanis = kayitlar.find((k) => k.tarih !== bugunStr());
      if (sonKapanis) setAcilisNakit((a) => (a === "0" ? String(sonKapanis.devir_nakit) : a));
    }
  }, [kullanici]);

  useEffect(() => {
    yenile();
  }, [yenile]);

  async function giderEkle(odemeTuru: "nakit" | "kart") {
    const t = sayi(giderTutar);
    if (t <= 0 || !giderAciklama.trim() || meskul) return;
    setMeskul(true);
    const supabase = createClient();
    const { error } = await supabase.from("gider").insert({
      cafe_id: kullanici.cafe_id,
      tutar: t,
      aciklama: giderAciklama.trim(),
      odeme_turu: odemeTuru,
      kullanici_id: kullanici.id,
    });
    setMeskul(false);
    if (error) { setHata("Gider eklenemedi: " + error.message); return; }
    setGiderTutar("");
    setGiderAciklama("");
    yenile();
  }

  async function giderSil(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("gider").delete().eq("id", id);
    if (error) setHata("Gider silinemedi: " + error.message);
    yenile();
  }

  useEffect(() => {
    if (!hata) return;
    const z = setTimeout(() => setHata(null), 6000);
    return () => clearTimeout(z);
  }, [hata]);

  const giderNakit = giderler.filter((g) => g.odeme_turu === "nakit").reduce((t, g) => t + Number(g.tutar), 0);
  const giderKart = giderler.filter((g) => g.odeme_turu === "kart").reduce((t, g) => t + Number(g.tutar), 0);

  const beklenenNakit = ozet ? sayi(acilisNakit) + Number(ozet.nakit_ciro) - giderNakit : 0;
  const beklenenKart = ozet ? Number(ozet.kart_ciro) - giderKart : 0;
  const nakitFark = sayi(sayilanNakit) - beklenenNakit;
  const kartFark = sayi(sayilanKart) - beklenenKart;

  async function gunuKapat() {
    if (!ozet || meskul) return;
    setMeskul(true);
    const supabase = createClient();
    const { error } = await supabase.from("gun_sonu").upsert(
      {
        cafe_id: kullanici.cafe_id,
        tarih: bugunStr(),
        acilis_nakit: sayi(acilisNakit),
        beklenen_nakit: Math.round(beklenenNakit * 100) / 100,
        beklenen_kart: Math.round(beklenenKart * 100) / 100,
        sayilan_nakit: sayi(sayilanNakit),
        sayilan_kart: sayi(sayilanKart),
        devir_nakit: devirNakit === "" ? sayi(sayilanNakit) : sayi(devirNakit),
        notu: kapanisNotu.trim() || null,
      },
      { onConflict: "cafe_id,tarih" }
    );
    setMeskul(false);
    if (error) { setHata("Gün sonu kaydedilemedi: " + error.message); return; }
    setKapatSoruluyor(false);
    setKaydedildi(true);
    yenile();
  }

  const inputStil =
    "rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2 text-right text-sm font-bold outline-none focus:border-marka";

  function farkRozet(fark: number) {
    if (Math.abs(fark) < 0.01)
      return <span className="rounded-full bg-basari-zemin px-3 py-1 text-[13px] font-extrabold text-basari">Tutuyor ✓</span>;
    return (
      <span className={"rounded-full px-3 py-1 text-[13px] font-extrabold " + (fark < 0 ? "bg-tehlike-zemin text-tehlike" : "bg-uyari-zemin text-uyari")}>
        {fark < 0 ? `Açık: ${tl(-fark)}` : `Fazla: ${tl(fark)}`}
      </span>
    );
  }

  return (
    <div className="mx-auto max-w-[820px]">
      <div className="flex items-baseline gap-3">
        <h2 className="font-serif text-xl font-semibold text-metin-baslik">Gün Sonu</h2>
        <span className="text-[13px] text-metin-soluk">
          {new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" })}
        </span>
        {kaydedildi && (
          <span className="rounded-full bg-basari-zemin px-3 py-1 text-xs font-extrabold text-basari">bugün kapatıldı ✓</span>
        )}
      </div>

      {hata && (
        <p className="mt-3 rounded-xl bg-tehlike-zemin px-3.5 py-2.5 text-[13.5px] font-bold text-tehlike">
          {hata}
        </p>
      )}

      {acikMasaSayisi > 0 && (
        <p className="mt-3 rounded-xl bg-uyari-zemin px-3.5 py-2.5 text-[13.5px] font-bold text-uyari">
          ⚠ Hâlâ {acikMasaSayisi} açık masa var — kapatılmamış hesaplar ciroya girmez, sayım tutmaz.
        </p>
      )}

      {/* Gün özeti */}
      {ozet && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { etiket: "Ciro", deger: tl(Number(ozet.ciro)) },
            { etiket: "💵 Nakit ciro", deger: tl(Number(ozet.nakit_ciro)) },
            { etiket: "💳 Kart ciro", deger: tl(Number(ozet.kart_ciro)) },
            { etiket: "Kapanan hesap", deger: String(ozet.adisyon_sayisi) },
            { etiket: "İkram", deger: tl(Number(ozet.ikram_tutar)) },
            { etiket: "İskonto", deger: tl(Number(ozet.iskonto_tutar)) },
            { etiket: "İptal / red", deger: `${ozet.iptal_sayisi} · ${tl(Number(ozet.iptal_tutar))}`, kirmizi: ozet.iptal_sayisi > 0 },
          ].map((k) => (
            <div key={k.etiket} className="rounded-2xl border border-cizgi bg-kart px-4 py-3">
              <div className="text-xs font-bold text-metin-soluk">{k.etiket}</div>
              <div className={"mt-0.5 text-[18px] font-extrabold tabular-nums " + (k.kirmizi ? "text-tehlike" : "text-metin-baslik")}>
                {k.deger}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Giderler */}
        <section className="rounded-2xl border border-cizgi bg-kart p-4">
          <h2 className="text-sm font-extrabold">Gün içi harcamalar (kasadan çıkan)</h2>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <input
              value={giderAciklama}
              onChange={(e) => setGiderAciklama(e.target.value)}
              placeholder="Açıklama (örn. sütçüye ödeme)"
              className="min-w-[160px] flex-1 rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2 text-sm outline-none focus:border-marka"
            />
            <input
              value={giderTutar}
              onChange={(e) => setGiderTutar(e.target.value)}
              inputMode="decimal"
              placeholder="TL"
              className={inputStil + " w-20"}
            />
            <button onClick={() => giderEkle("nakit")} className="rounded-[10px] bg-basari px-3 py-2 text-[12.5px] font-extrabold text-white">
              💵 Nakit
            </button>
            <button onClick={() => giderEkle("kart")} className="rounded-[10px] bg-basari px-3 py-2 text-[12.5px] font-extrabold text-white">
              💳 Kart
            </button>
          </div>
          <div className="mt-3 flex flex-col gap-1.5">
            {giderler.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {g.odeme_turu === "nakit" ? "💵" : "💳"} {g.aciklama}
                  <span className="ml-1.5 text-[11px] text-metin-silik">
                    {new Date(g.created_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </span>
                <span className="font-bold tabular-nums">{tl(Number(g.tutar))}</span>
                <button onClick={() => giderSil(g.id)} className="text-xs font-bold text-tehlike-yumusak hover:underline">
                  sil
                </button>
              </div>
            ))}
            {giderler.length === 0 && <p className="text-[13px] text-metin-silik">Bugün harcama girilmedi.</p>}
          </div>
          {(giderNakit > 0 || giderKart > 0) && (
            <p className="mt-2.5 border-t border-dashed border-cizgi-koyu pt-2 text-[13px] font-bold text-metin-orta">
              Toplam: 💵 {tl(giderNakit)} · 💳 {tl(giderKart)}
            </p>
          )}
        </section>

      </div>

      {/* Mutabakat */}
      <section className="mt-4 rounded-2xl border-[1.5px] border-marka/40 bg-kart p-4">
        <h2 className="text-sm font-extrabold">Kasa mutabakatı</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {/* Nakit */}
          <div className="rounded-xl bg-krem p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[13.5px] font-extrabold">💵 Nakit</span>
              {farkRozet(nakitFark)}
            </div>
            <div className="mt-2.5 flex flex-col gap-1.5 text-[13px]">
              <label className="flex items-center justify-between gap-2">
                <span className="text-metin-orta">Açılış kasası (devir)</span>
                <input value={acilisNakit} onChange={(e) => setAcilisNakit(e.target.value)} inputMode="decimal" className={inputStil + " w-24"} />
              </label>
              <div className="flex justify-between text-metin-orta">
                <span>+ Nakit ciro</span>
                <span className="tabular-nums">{tl(Number(ozet?.nakit_ciro ?? 0))}</span>
              </div>
              <div className="flex justify-between text-metin-orta">
                <span>− Nakit harcama</span>
                <span className="tabular-nums">{tl(giderNakit)}</span>
              </div>
              <div className="flex justify-between border-t border-dashed border-cizgi-koyu pt-1.5 font-extrabold">
                <span>Beklenen nakit</span>
                <span className="tabular-nums">{tl(beklenenNakit)}</span>
              </div>
              <label className="mt-1 flex items-center justify-between gap-2">
                <span className="font-extrabold">Sayılan nakit</span>
                <input value={sayilanNakit} onChange={(e) => setSayilanNakit(e.target.value)} inputMode="decimal" placeholder="say ve yaz" className={inputStil + " w-28"} />
              </label>
            </div>
          </div>

          {/* Kart */}
          <div className="rounded-xl bg-krem p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[13.5px] font-extrabold">💳 Kart (POS)</span>
              {farkRozet(kartFark)}
            </div>
            <div className="mt-2.5 flex flex-col gap-1.5 text-[13px]">
              <div className="flex justify-between text-metin-orta">
                <span>+ Kart ciro</span>
                <span className="tabular-nums">{tl(Number(ozet?.kart_ciro ?? 0))}</span>
              </div>
              <div className="flex justify-between text-metin-orta">
                <span>− Kart harcama</span>
                <span className="tabular-nums">{tl(giderKart)}</span>
              </div>
              <div className="flex justify-between border-t border-dashed border-cizgi-koyu pt-1.5 font-extrabold">
                <span>Beklenen kart</span>
                <span className="tabular-nums">{tl(beklenenKart)}</span>
              </div>
              <label className="mt-1 flex items-center justify-between gap-2">
                <span className="font-extrabold">POS raporu (sayılan)</span>
                <input value={sayilanKart} onChange={(e) => setSayilanKart(e.target.value)} inputMode="decimal" placeholder="POS'tan yaz" className={inputStil + " w-28"} />
              </label>
            </div>
          </div>
        </div>

        {/* Kapanış */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[13px] font-bold text-metin-orta">
            Yarına devir (nakit)
            <input
              value={devirNakit}
              onChange={(e) => setDevirNakit(e.target.value)}
              inputMode="decimal"
              placeholder={sayilanNakit || "sayılan"}
              className={inputStil + " w-24"}
            />
          </label>
          <input
            value={kapanisNotu}
            onChange={(e) => setKapanisNotu(e.target.value)}
            placeholder="Kapanış notu (isteğe bağlı)"
            className="min-w-[180px] flex-1 rounded-[10px] border border-cizgi-koyu bg-krem px-3 py-2 text-sm outline-none focus:border-marka"
          />
          {kapatSoruluyor ? (
            <span className="flex items-center gap-2">
              <button onClick={() => setKapatSoruluyor(false)} className="px-2 text-[13px] font-bold text-metin-orta">
                Vazgeç
              </button>
              <button onClick={gunuKapat} className="rounded-xl bg-basari px-4 py-2.5 text-[13.5px] font-extrabold text-white">
                Evet, kaydet ✓
              </button>
            </span>
          ) : (
            <button
              onClick={() => setKapatSoruluyor(true)}
              className="marka-gradyan rounded-xl px-5 py-2.5 text-[14px] font-extrabold text-white shadow-[0_4px_12px_rgba(138,75,31,0.25)]"
            >
              {kaydedildi ? "Kapanışı Güncelle" : "Günü Kapat"}
            </button>
          )}
        </div>
      </section>

      {/* Geçmiş kapanışlar */}
      {gecmis.length > 0 && (
        <section className="mt-4 rounded-2xl border border-cizgi bg-kart p-4">
          <h2 className="text-sm font-extrabold">Son kapanışlar</h2>
          <div className="mt-2.5 overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="border-b border-cizgi text-left text-xs font-extrabold text-metin-soluk">
                  <th className="pb-1.5">Tarih</th>
                  <th className="pb-1.5 text-right">Beklenen 💵</th>
                  <th className="pb-1.5 text-right">Sayılan 💵</th>
                  <th className="pb-1.5 text-right">Fark 💵</th>
                  <th className="pb-1.5 text-right">Fark 💳</th>
                  <th className="pb-1.5 text-right">Devir</th>
                </tr>
              </thead>
              <tbody>
                {gecmis.map((g) => {
                  const nf = Number(g.sayilan_nakit) - Number(g.beklenen_nakit);
                  const kf = Number(g.sayilan_kart) - Number(g.beklenen_kart);
                  const f = (v: number) =>
                    Math.abs(v) < 0.01 ? (
                      <span className="text-basari">✓</span>
                    ) : (
                      <span className={v < 0 ? "text-tehlike" : "text-uyari"}>{tl(v)}</span>
                    );
                  return (
                    <tr key={g.id} className="border-b border-[#f6ede1] last:border-0">
                      <td className="py-1.5 font-semibold">
                        {new Date(g.tarih + "T00:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "short", weekday: "short" })}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{tl(Number(g.beklenen_nakit))}</td>
                      <td className="py-1.5 text-right tabular-nums">{tl(Number(g.sayilan_nakit))}</td>
                      <td className="py-1.5 text-right font-bold tabular-nums">{f(nf)}</td>
                      <td className="py-1.5 text-right font-bold tabular-nums">{f(kf)}</td>
                      <td className="py-1.5 text-right tabular-nums">{tl(Number(g.devir_nakit))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
