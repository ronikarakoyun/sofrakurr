export type SiparisDurum =
  | "odeme_bekliyor"
  | "bekliyor"
  | "hazirlaniyor"
  | "hazir"
  | "teslim"
  | "iptal"
  | "reddedildi";

export type KullaniciRol =
  | "admin"
  | "kasa"
  | "garson" // emekli rol: tarihsel kayıtlar için tipte durur, yeni hesap açılmaz
  | "mutfak"
  | "musteri"
  | "franchise"
  | "super_admin";

// Kasa hesabı yetki anahtarları (null/eksik = izinli — geriye uyumlu)
export type YetkiKodu =
  | "siparis"
  | "gunsonu"
  | "tedarikci"
  | "gecmis"
  | "odul";

export function yetkiVar(k: Kullanici | null, kod: YetkiKodu): boolean {
  if (!k) return false;
  if (k.rol !== "kasa") return true; // admin (ve maskeli admin) her zaman izinli
  return k.yetkiler?.[kod] !== false;
}

export interface Opsiyon {
  id: string;
  ad: string;
  ek_fiyat: number;
  aktif: boolean;
  sira: number;
}

export interface OpsiyonGrubu {
  id: string;
  ad: string;
  min_secim: number;
  max_secim: number;
  sira: number;
  opsiyon: Opsiyon[];
}

export interface Urun {
  id: string;
  ad: string;
  aciklama: string | null;
  fiyat: number;
  gorsel_url: string | null;
  aktif: boolean;
  sira: number;
  istasyon?: string;
  kampanya?: boolean;
  kaynak_id?: string | null; // dolu = zincir menüsünden senkronlanan şube kopyası
  fiyat_kilit?: boolean; // true = senkron bu şubenin fiyatını ezmez
  opsiyon_grubu: OpsiyonGrubu[];
}

export const ISTASYONLAR = ["mutfak", "bar", "tezgah"] as const;
export const ISTASYON_SIMGE: Record<string, string> = {
  mutfak: "🍳",
  bar: "🍹",
  tezgah: "🧁",
};

export interface Kategori {
  id: string;
  ad: string;
  sira: number;
  aktif: boolean;
  urun: Urun[];
}

export interface SecilenOpsiyon {
  grup: string;
  secim: string;
  ek_fiyat: number;
}

export interface SiparisKalemi {
  id: string;
  urun_id: string;
  urun_ad: string;
  birim_fiyat: number;
  adet: number;
  secilen_opsiyonlar: SecilenOpsiyon[];
  opsiyon_ek_fiyat: number;
  reddedildi: boolean;
  red_nedeni: string | null;
  ikram?: boolean;
  istasyon?: string;
  hazir?: boolean;
  kalem_notu?: string | null;
}

export interface Siparis {
  id: string;
  adisyon_id: string;
  durum: SiparisDurum;
  musteri_notu: string | null;
  created_at: string;
  siparis_no: number | null; // 0040 öncesi kayıtlarda null — gösterimde masa adına düşülür
  masa: { ad: string } | null; // self-servis (masasız) siparişte null
  siparis_kalemi: SiparisKalemi[];
}

// Sipariş kimliği: numara varsa "Masa · #N" (masasızda yalnız "#N"), yoksa masa adı
export function siparisKimlik(s: { siparis_no: number | null; masa: { ad: string } | null }): string {
  const no = s.siparis_no != null ? `#${s.siparis_no}` : "";
  const masa = s.masa?.ad ?? "";
  if (no && masa) return `${masa} · ${no}`;
  return no || masa || "Sipariş";
}

export interface Kullanici {
  id: string;
  cafe_id: string;
  rol: KullaniciRol;
  ad: string | null;
  aktif?: boolean;
  yetkiler?: Record<string, boolean> | null;
  secili_cafe_id?: string | null;
  // Efektif kafenin adı (franchise/super_admin'de seçili kafe). useKullanici
  // doldurur; ekran başlıklarında "BUTİKEK" gibi sabitler yerine kullanılır.
  cafe_ad?: string | null;
}

export const DURUM_ETIKET: Record<SiparisDurum, string> = {
  odeme_bekliyor: "Ödeme bekliyor",
  bekliyor: "Sırada",
  hazirlaniyor: "Hazırlanıyor",
  hazir: "Hazır",
  teslim: "Teslim edildi",
  iptal: "İptal",
  reddedildi: "Reddedildi",
};

export function kalemTutar(k: {
  birim_fiyat: number;
  opsiyon_ek_fiyat: number;
  adet: number;
}): number {
  return (Number(k.birim_fiyat) + Number(k.opsiyon_ek_fiyat)) * k.adet;
}

export function siparisTutar(kalemler: SiparisKalemi[]): number {
  return kalemler.filter((k) => !k.reddedildi).reduce((t, k) => t + kalemTutar(k), 0);
}

export function tl(n: number): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

export function dakikaOnce(iso: string): string {
  const dk = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (dk < 1) return "az önce";
  return `${dk} dk önce`;
}
