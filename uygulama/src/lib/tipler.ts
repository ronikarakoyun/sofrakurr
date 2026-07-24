// Sunucu RPC'lerinin döndürdüğü şekiller (0031/0032 migration'larıyla eş)

export interface MusteriKayit {
  ad: string;
  rol: string;
  musteri_kod: string;
}

export interface SadakatHesap {
  cafe_id: string;
  cafe_ad: string;
  puan_bakiye: number;
}

export interface PuanHareketi {
  cafe_ad: string;
  tur: "kazanim" | "harcama" | "duzeltme";
  puan: number;
  aciklama: string | null;
  tarih: string;
}

export interface MusteriOzet {
  ad: string;
  musteri_kod: string;
  // Tek cüzdan (0059): toplam bakiye + TL karşılığı. 'hesaplar' geçiş dönemi
  // uyumluluğu için sunucudan tek sentetik satırla gelmeye devam ediyor.
  puan_bakiye?: number;
  tl_karsiligi?: number;
  hesaplar: SadakatHesap[];
  hareketler: PuanHareketi[];
}

export interface SiparisKalemi {
  urun_id: string;
  urun_ad: string;
  adet: number;
  birim_fiyat: number;
  opsiyon_ek_fiyat: number;
  opsiyonlar: { grup: string; secim: string; ek_fiyat: number }[];
  kalem_notu: string | null;
  reddedildi: boolean;
}

export interface GecmisSiparis {
  siparis_id: string;
  siparis_no?: number | null; // 0040 öncesi kayıtlarda null
  cafe_ad: string;
  masa_ad: string;
  durum: string;
  tarih: string;
  kalemler: SiparisKalemi[];
}

// ── Menü ve sipariş (masadan sipariş akışı) ──
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
  kampanya: boolean;
  opsiyon_grubu: OpsiyonGrubu[];
}

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

export interface SepetKalemi {
  urun: Urun;
  adet: number;
  opsiyonlar: SecilenOpsiyon[];
  not?: string;
}

export function kalemBirimFiyat(k: SepetKalemi): number {
  return Number(k.urun.fiyat) + k.opsiyonlar.reduce((t, o) => t + Number(o.ek_fiyat), 0);
}

// Tasarım dili: "145,00 ₺" (kuruşlu, sonda simge)
export function tl(v: number): string {
  return v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
}
