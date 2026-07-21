// ============================================================================
// SofraKur Yazıcı Ajanı
// Kafedeki bir bilgisayarda sürekli çalışır; mutfağa düşen siparişleri canlı
// dinler ve her istasyonun kalemlerini o istasyonun AĞ (Ethernet) termal
// yazıcısına ESC/POS olarak basar. Ekran/tarayıcı açık olmasa da fiş çıkar.
//
// Kurulum kılavuzu: araclar/YAZICI-KURULUM.md
//
// Test (giriş gerekmez, her yazıcıya deneme fişi basar):
//   node araclar/yazici-ajani.mjs --test
// Çalıştırma:
//   YAZICI_SIFRE="personel-şifresi" node araclar/yazici-ajani.mjs
// ============================================================================

import net from "node:net";
import os from "node:os";
import path from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import { execFile } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import iconv from "iconv-lite";

// ── AYARLAR ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://drnuwlklixitttanlnxg.supabase.co";
const SUPABASE_ANON = process.env.SUPABASE_ANON ?? "sb_publishable_f77baPsXDyzB1tMEyQNvLg_8yPUY9mh";
const PERSONEL_EPOSTA = process.env.YAZICI_EPOSTA ?? "mutfak@butikek.com";
const PERSONEL_SIFRE = process.env.YAZICI_SIFRE ?? "";

// İstasyon -> yazıcı hedefi. Üç format desteklenir:
//   "192.168.1.21"  -> ağ yazıcısı (Ethernet, port 9100)
//   "usb:TEZGAH"    -> bu bilgisayara USB ile bağlı, Windows'ta "TEZGAH" adıyla
//                      paylaşıma açılmış yazıcı (kılavuza bak)
//   "lp:YaziciAdi"  -> Mac/Linux'ta sistemde tanımlı yazıcı adı
const YAZICILAR = {
  mutfak: "192.168.1.21", // Xprinter XP-Q805K (ağ)
  bar: "192.168.1.20",    // KODPOS Kps70 (ağ) — kurulumda self-test ile teyit et
  tezgah: "usb:TEZGAH",   // Xprinter XP-Q805K, ana bilgisayara USB bağlı (hesap+tezgah)
};
const YAZICI_PORT = 9100;

// Yanında "yazicilar.json" varsa oradaki değerler üsttekileri ezer —
// kafede IP değişirse Not Defteri'yle o dosyayı düzeltmek yeterli.
try {
  const { readFileSync } = await import("node:fs");
  const disAyar = JSON.parse(readFileSync(new URL("./yazicilar.json", import.meta.url), "utf8"));
  Object.assign(YAZICILAR, disAyar);
  console.log("yazicilar.json okundu");
} catch {}
// ────────────────────────────────────────────────────────────────────────────

// ── ESC/POS ─────────────────────────────────────────────────────────────────
const ESC = "\x1b", GS = "\x1d";

// Türkçe kod sayfası: [ESC t numarası, metin kodlaması]. Marka/firmware'e göre
// değişir — yazicilar.json'da yazıcı başına {"hedef": "...", "kod": [56,"cp857"]}
// yazılarak ezilebilir. Doğru numarayı bulmak için: node ... --kodtest
// kodlama "ascii" seçilirse Türkçe karakterler sadeleştirilir (ğ→g) — garantili yol.
const VARSAYILAN_KOD = [13, "cp857"];

function hedefBilgi(deger) {
  if (typeof deger === "string") return { hedef: deger, kod: VARSAYILAN_KOD };
  return { hedef: deger.hedef, kod: deger.kod ?? VARSAYILAN_KOD };
}

const TR_SADE = { "ğ":"g","Ğ":"G","ü":"u","Ü":"U","ş":"s","Ş":"S","ı":"i","İ":"I","ö":"o","Ö":"O","ç":"c","Ç":"C" };
const sadelestir = (metin) => metin.replace(/[ğĞüÜşŞıİöÖçÇ]/g, (c) => TR_SADE[c]);

function kodla(metin, kod) {
  if (kod[1] === "ascii") return Buffer.from(sadelestir(metin), "latin1");
  return iconv.encode(metin, kod[1]);
}

function fisUret(istasyon, masaAd, saat, kalemler, not, kod = VARSAYILAN_KOD, yazan = null) {
  let m = "";
  m += ESC + "@";                    // sıfırla
  m += ESC + "t" + String.fromCharCode(kod[0]); // Türkçe kod sayfası
  m += ESC + "a" + "\x01";           // ortala
  m += `--- ${istasyon.toLocaleUpperCase("tr")} ---\n`;
  m += GS + "!" + "\x11";            // çift boy
  m += masaAd + "\n";
  m += GS + "!" + "\x00";            // normal boy
  m += saat + "\n";
  if (yazan) m += `Yazan: ${yazan}\n`;
  m += ESC + "a" + "\x00";           // sola yasla
  m += "--------------------------------\n";
  m += ESC + "E" + "\x01";           // kalın
  for (const k of kalemler) {
    m += `${k.adet} x ${k.urun_ad}\n`;
    const ops = (k.secilen_opsiyonlar ?? []).map((o) => o.secim).join(", ");
    if (ops) {
      m += ESC + "E" + "\x00" + `   > ${ops}\n` + ESC + "E" + "\x01";
    }
    if (k.kalem_notu) {
      m += `   NOT: ${k.kalem_notu}\n`;
    }
  }
  m += ESC + "E" + "\x00";
  if (not) m += `\nNOT: ${not}\n`;
  m += "--------------------------------\n";
  m += ESC + "a" + "\x01" + "SofraKur\n\n\n";
  const govde = kodla(m, kod);
  const kes = Buffer.from(GS + "V" + "\x42" + "\x00", "binary"); // kağıdı kes
  return Buffer.concat([govde, kes]);
}

const para = (n) => Number(n).toFixed(2).replace(".", ",");

// 32 kolonluk satır: sol metin + sağa yaslı tutar
function satir(sol, sag) {
  const bosluk = 32 - sag.length;
  if (sol.length > bosluk - 1) sol = sol.slice(0, bosluk - 1);
  return sol.padEnd(bosluk) + sag + "\n";
}

// Adisyon (hesap) fişi — bilgi fişidir, mali değeri yoktur
function adisyonFisUret(kafeAd, masaAd, saat, kalemler, iskonto, toplam, kod = VARSAYILAN_KOD) {
  let m = "";
  m += ESC + "@";
  m += ESC + "t" + String.fromCharCode(kod[0]);
  m += ESC + "a" + "\x01";
  m += GS + "!" + "\x11" + kafeAd + "\n" + GS + "!" + "\x00";
  m += "ADİSYON\n";
  m += GS + "!" + "\x11" + masaAd + "\n" + GS + "!" + "\x00";
  m += saat + "\n";
  m += ESC + "a" + "\x00";
  m += "--------------------------------\n";
  let araToplam = 0;
  for (const k of kalemler) {
    const tutar = (Number(k.birim_fiyat) + Number(k.opsiyon_ek_fiyat)) * k.adet;
    if (k.ikram) {
      m += satir(`${k.adet} x ${k.urun_ad}`, "İKRAM");
    } else {
      araToplam += tutar;
      m += satir(`${k.adet} x ${k.urun_ad}`, para(tutar));
    }
    const ops = (k.secilen_opsiyonlar ?? []).map((o) => o.secim).join(", ");
    if (ops) m += `   > ${ops}\n`;
  }
  m += "--------------------------------\n";
  if (iskonto > 0) {
    m += satir("Ara Toplam", para(araToplam));
    m += satir("İskonto", "-" + para(iskonto));
  }
  m += ESC + "E" + "\x01" + GS + "!" + "\x01";
  m += satir("TOPLAM", para(toplam));
  m += GS + "!" + "\x00" + ESC + "E" + "\x00";
  m += "--------------------------------\n";
  m += ESC + "a" + "\x01";
  m += "MALİ DEĞERİ YOKTUR\nBİLGİ FİŞİDİR\nSofraKur\n\n\n";
  const govde = kodla(m, kod);
  const kes = Buffer.from(GS + "V" + "\x42" + "\x00", "binary");
  return Buffer.concat([govde, kes]);
}

function tcpYazdir(ip, veri) {
  return new Promise((coz, reddet) => {
    const soket = net.createConnection({ host: ip, port: YAZICI_PORT, timeout: 5000 });
    soket.on("connect", () => soket.end(veri));
    soket.on("close", coz);
    soket.on("timeout", () => { soket.destroy(); reddet(new Error("zaman aşımı")); });
    soket.on("error", reddet);
  });
}

// Ham ESC/POS'u geçici dosyaya yazıp işletim sistemi üzerinden yazıcıya kopyalar
function komutlaYazdir(komut, argumanlar, dosya) {
  return new Promise((coz, reddet) => {
    execFile(komut, argumanlar, { windowsHide: true }, (hata) => {
      try { unlinkSync(dosya); } catch {}
      hata ? reddet(hata) : coz();
    });
  });
}

async function yazdir(hedef, veri) {
  if (hedef.startsWith("usb:")) {
    // Windows: paylaşıma açılmış yazıcıya ham kopya
    const paylasim = hedef.slice(4);
    const dosya = path.join(os.tmpdir(), `sofrakur-fis-${Date.now()}.bin`);
    writeFileSync(dosya, veri);
    return komutlaYazdir("cmd", ["/c", "copy", "/b", dosya, `\\\\localhost\\${paylasim}`], dosya);
  }
  if (hedef.startsWith("lp:")) {
    // Mac/Linux: sistem yazıcısına ham gönderim
    const ad = hedef.slice(3);
    const dosya = path.join(os.tmpdir(), `sofrakur-fis-${Date.now()}.bin`);
    writeFileSync(dosya, veri);
    return komutlaYazdir("lp", ["-d", ad, "-o", "raw", dosya], dosya);
  }
  return tcpYazdir(hedef, veri);
}

// ── Test modu: her yazıcıya deneme fişi bas ve çık ──────────────────────────
if (process.argv.includes("--test")) {
  for (const [istasyon, deger] of Object.entries(YAZICILAR)) {
    const { hedef, kod } = hedefBilgi(deger);
    try {
      await yazdir(hedef, fisUret(istasyon, "TEST FİŞİ", new Date().toLocaleString("tr-TR"), [
        { urun_ad: "Bağlantı başarılı", adet: 1, secilen_opsiyonlar: [] },
        { urun_ad: "Türkçe deneme: ğüşıöç ĞÜŞİÖÇ", adet: 1, secilen_opsiyonlar: [] },
      ], `${istasyon} yazıcısı hazır`, kod));
      console.log(`✓ ${istasyon} (${hedef}) test fişi basıldı`);
    } catch (e) {
      console.error(`✗ ${istasyon} (${hedef}) ulaşılamadı: ${e.message}`);
    }
  }
  process.exit(0);
}

// ── Kod sayfası testi: hangi numara Türkçe basıyor, yazıcıdan okunur ─────────
if (process.argv.includes("--kodtest")) {
  const ADAYLAR = [
    [13, "cp857"], [56, "cp857"], [24, "cp857"], [12, "cp857"],
    [45, "windows-1254"], [17, "windows-1254"], [40, "iso-8859-9"],
  ];
  const ORNEK = "ğüşıöç ĞÜŞİÖÇ İçecek\n";
  for (const [istasyon, deger] of Object.entries(YAZICILAR)) {
    const { hedef } = hedefBilgi(deger);
    const parcalar = [Buffer.from(
      ESC + "@" + ESC + "a" + "\x00" +
      `*** ${istasyon.toUpperCase()} KOD TESTI ***\n` +
      "Turkce dogru gorunen SECENEK\nnumarasini Claude'a yaz:\n" +
      "--------------------------------\n", "latin1")];
    ADAYLAR.forEach(([n, enc], i) => {
      parcalar.push(Buffer.from(`SECENEK ${i + 1}: `, "latin1"));
      parcalar.push(Buffer.from(ESC + "t" + String.fromCharCode(n), "binary"));
      parcalar.push(iconv.encode(ORNEK, enc));
    });
    parcalar.push(Buffer.from(ESC + "t" + "\x00" + "\n\n\n" + GS + "V" + "\x42" + "\x00", "binary"));
    try {
      await yazdir(hedef, Buffer.concat(parcalar));
      console.log(`✓ ${istasyon} (${hedef}) kod testi basıldı`);
    } catch (e) {
      console.error(`✗ ${istasyon} (${hedef}) ulaşılamadı: ${e.message}`);
    }
  }
  process.exit(0);
}

// ── Giriş ───────────────────────────────────────────────────────────────────
if (!PERSONEL_SIFRE) {
  console.error("YAZICI_SIFRE ortam değişkeni gerekli. Örnek:");
  console.error('  YAZICI_SIFRE="..." node araclar/yazici-ajani.mjs');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
const { error: girisHatasi } = await supabase.auth.signInWithPassword({
  email: PERSONEL_EPOSTA,
  password: PERSONEL_SIFRE,
});
if (girisHatasi) {
  console.error("Giriş başarısız:", girisHatasi.message);
  process.exit(1);
}
console.log(`✓ ${PERSONEL_EPOSTA} olarak bağlanıldı`);
console.log(`✓ Yazıcılar: ${Object.entries(YAZICILAR).map(([i, d]) => `${i}→${hedefBilgi(d).hedef}`).join(", ")}`);

// Aynı siparişin realtime + polling ile aynı anda işlenmesini önleyen bellek kilidi.
// Kalıcı "basıldı mı?" bilgisi ise basilan_fis tablosunda (istasyon bazında) tutulur.
const isleniyor = new Set();

// ── Sipariş işleme ──────────────────────────────────────────────────────────
async function siparisiBas(siparisId) {
  if (isleniyor.has(siparisId)) return;
  isleniyor.add(siparisId);
  try {
    const { data: s, error } = await supabase
      .from("siparis")
      .select("id, cafe_id, created_at, musteri_notu, siparis_no, masa(ad), olusturan:kullanici(ad), siparis_kalemi(urun_ad, adet, secilen_opsiyonlar, istasyon, reddedildi, kalem_notu)")
      .eq("id", siparisId)
      .single();
    // Geçici sorgu/ağ hatası: fişi YUTMA — bir sonraki poll tekrar dener
    if (error || !s) return;

    // Bu sipariş için hangi istasyonlar zaten basılmış? (restart'a dayanıklı)
    const { data: basililar } = await supabase
      .from("basilan_fis")
      .select("istasyon")
      .eq("siparis_id", siparisId);
    const basiliSet = new Set((basililar ?? []).map((b) => b.istasyon));

    // Siparişi kim girdi? Personel girdiyse adı, müşteri QR'dan gönderdiyse "Müşteri"
    const yazan = s.olusturan?.ad ?? "Müşteri";
    const saat = new Date(s.created_at).toLocaleString("tr-TR", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });

    for (const [istasyon, deger] of Object.entries(YAZICILAR)) {
      if (basiliSet.has(istasyon)) continue; // bu istasyon zaten basılmış, atla
      const { hedef, kod } = hedefBilgi(deger);
      const kalemler = s.siparis_kalemi.filter(
        (k) => !k.reddedildi && (k.istasyon ?? "mutfak") === istasyon
      );
      if (!kalemler.length) continue;
      try {
        // Kimlik: numara varsa "Masa · #N" (masasız siparişte yalnız "#N"), eski kayıtta masa adı
        const kimlik = s.siparis_no != null
          ? (s.masa?.ad ? `${s.masa.ad} · #${s.siparis_no}` : `#${s.siparis_no}`)
          : (s.masa?.ad ?? "Sipariş");
        await yazdir(hedef, fisUret(istasyon, kimlik, saat, kalemler, s.musteri_notu, kod, yazan));
        // Yalnız BAŞARILI istasyonu kalıcı işaretle: arızalı yazıcı bir daha denenir,
        // çalışan yazıcıya duplikat çıkmaz.
        await supabase.from("basilan_fis").insert({
          siparis_id: siparisId, istasyon, cafe_id: s.cafe_id,
        });
        console.log(`🖨 ${s.masa.ad} → ${istasyon} (${kalemler.length} kalem)`);
      } catch (e) {
        console.error(`✗ ${istasyon} yazıcısına basılamadı (${hedef}): ${e.message}`);
        // basilan_fis'e yazılmadı → sonraki poll bu istasyonu tekrar dener
      }
    }
  } finally {
    isleniyor.delete(siparisId);
  }
}

// ── Adisyon (hesap) fişi: kasadan gelen yazdırma istekleri ──────────────────
const basilanAdisyonlar = new Set();
async function adisyonuBas(kayit) {
  if (basilanAdisyonlar.has(kayit.id)) return;
  basilanAdisyonlar.add(kayit.id);

  const { data: a } = await supabase
    .from("adisyon")
    .select("id, iskonto_tutar, masa(ad), cafe(ad), siparis(durum, siparis_kalemi(urun_ad, adet, birim_fiyat, opsiyon_ek_fiyat, ikram, reddedildi, secilen_opsiyonlar))")
    .eq("id", kayit.adisyon_id)
    .single();
  if (!a) { basilanAdisyonlar.delete(kayit.id); return; }

  const kalemler = (a.siparis ?? [])
    .filter((s) => !["iptal", "reddedildi"].includes(s.durum))
    .flatMap((s) => s.siparis_kalemi.filter((k) => !k.reddedildi));
  const araToplam = kalemler
    .filter((k) => !k.ikram)
    .reduce((t, k) => t + (Number(k.birim_fiyat) + Number(k.opsiyon_ek_fiyat)) * k.adet, 0);
  const iskonto = Number(a.iskonto_tutar ?? 0);
  const toplam = Math.max(0, araToplam - iskonto);
  const saat = new Date().toLocaleString("tr-TR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const { hedef, kod } = hedefBilgi(YAZICILAR.tezgah ?? Object.values(YAZICILAR)[0]);
  try {
    await yazdir(hedef, adisyonFisUret(a.cafe?.ad ?? "", a.masa.ad, saat, kalemler, iskonto, toplam, kod));
    // Basıldı olarak işaretle; güncelleme başarısızsa (nadir) kayıt 'bekliyor'
    // kalır ve tekrar denenir — burada Set'i temizleyerek buna izin ver.
    const { error: guncelHata } = await supabase
      .from("yazdirma_kuyrugu").update({ durum: "basildi" }).eq("id", kayit.id);
    if (guncelHata) basilanAdisyonlar.delete(kayit.id);
    console.log(`🧾 ${a.masa.ad} adisyonu basıldı (${para(toplam)} TL)`);
  } catch (e) {
    console.error(`✗ adisyon basılamadı (${hedef}): ${e.message}`);
    basilanAdisyonlar.delete(kayit.id); // tekrar denensin
  }
}

// Canlı dinleme: mutfağa düşen (bekliyor) siparişler + adisyon yazdırma istekleri
supabase
  .channel("yazici-ajani")
  .on("postgres_changes", { event: "*", schema: "public", table: "siparis" }, (olay) => {
    const yeni = olay.new;
    if (yeni?.durum === "bekliyor") siparisiBas(yeni.id);
  })
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "yazdirma_kuyrugu" }, (olay) => {
    if (olay.new?.durum === "bekliyor") adisyonuBas(olay.new);
  })
  .subscribe((durum) => console.log("canlı bağlantı:", durum));

// Yedek: 15 sn'de bir kaçırılan var mı diye bak (Wi-Fi kopmaları / ajan restart'ına
// karşı). Son 24 saatteki basılabilir siparişlere bakar; hangi istasyonun basıldığı
// basilan_fis'ten bilindiği için duplikat riski yok, kaçan fiş de yakalanır.
setInterval(async () => {
  const birGunOnce = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data } = await supabase
    .from("siparis")
    .select("id")
    .in("durum", ["bekliyor", "hazirlaniyor"])
    .gte("created_at", birGunOnce);
  for (const s of data ?? []) await siparisiBas(s.id);

  const { data: kuyruk } = await supabase
    .from("yazdirma_kuyrugu")
    .select("id, adisyon_id")
    .eq("durum", "bekliyor");
  for (const k of kuyruk ?? []) await adisyonuBas(k);
}, 15_000);

console.log("… siparişler dinleniyor (durdurmak için Ctrl+C)");
