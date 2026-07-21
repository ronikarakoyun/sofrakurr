// Rapor tarih aralığı yardımcıları — admin/raporlar ve panel/rapor paylaşır.
// Aralıklar YARI-AÇIK [bas, bit): "özel"de bitiş günü dahil edilmek için +1 gün.

export type Aralik = "bugun" | "dun" | "yedi" | "otuz" | "ozel";

export const GUN_ADI = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

export const ARALIK_ETIKET: [Aralik, string][] = [
  ["bugun", "Bugün"],
  ["dun", "Dün"],
  ["yedi", "Son 7 gün"],
  ["otuz", "Son 30 gün"],
  ["ozel", "Özel"],
];

export function gunBasi(kayma = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + kayma);
  return d;
}

export function tarihStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function aralikTarihleri(
  aralik: Aralik,
  ozelBas: string,
  ozelBit: string
): [Date, Date] {
  switch (aralik) {
    case "bugun":
      return [gunBasi(), gunBasi(1)];
    case "dun":
      return [gunBasi(-1), gunBasi()];
    case "yedi":
      return [gunBasi(-6), gunBasi(1)];
    case "otuz":
      return [gunBasi(-29), gunBasi(1)];
    case "ozel": {
      const bas = new Date(ozelBas + "T00:00:00");
      const bit = new Date(ozelBit + "T00:00:00");
      bit.setDate(bit.getDate() + 1); // bitiş günü dahil
      return [bas, bit];
    }
  }
}
