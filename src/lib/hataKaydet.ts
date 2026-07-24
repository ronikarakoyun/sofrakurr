import { createClient } from "@supabase/supabase-js";

// Sunucu tarafı hata kaydı (service_role) — /api/hata ve instrumentation.ts
// paylaşır. hata_log'a istemci DOĞRUDAN yazamaz; yalnız bu yol yazar.
// Hata logunun kendisi asla hata fırlatmaz (yut).

const kis = (s: unknown, n: number): string | null =>
  typeof s === "string" && s.length > 0 ? s.slice(0, n) : null;

export async function hataKaydet(k: {
  cafe_id?: string | null;
  kullanici_id?: string | null;
  ortam?: unknown;
  tur?: unknown;
  mesaj: string;
  yig?: unknown;
  url?: unknown;
  tarayici?: unknown;
}): Promise<void> {
  const anahtar = process.env.SUPABASE_SECRET;
  if (!anahtar || !k.mesaj) return;
  try {
    const servis = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      anahtar,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    await servis.from("hata_log").insert({
      cafe_id: k.cafe_id ?? null,
      kullanici_id: k.kullanici_id ?? null,
      ortam: kis(k.ortam, 40),
      tur: kis(k.tur, 40),
      mesaj: k.mesaj.slice(0, 2000),
      yig: kis(k.yig, 8000),
      url: kis(k.url, 500),
      tarayici: kis(k.tarayici, 400),
    });
  } catch {
    /* hata izleme sistemi çökmesin */
  }
}
