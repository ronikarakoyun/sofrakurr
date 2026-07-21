import { NextResponse } from "next/server";
import { createClient as createServisClient } from "@supabase/supabase-js";

// Yazarkasa (ÖKC) cihazının çağıracağı uç: kafenin ödemesi alınmamış açık
// hesaplarını + tutarlarını döner. Kimlik: kafeye özel ÖKC anahtarı
// (x-okc-anahtar başlığı). Cihaz masayı seçer, tutarı bu listeden alır.
//
//   GET /api/okc/hesaplar        (başlık: x-okc-anahtar: okc_...)
//   → [{ adisyon_id, masa_ad, tutar }]

function servis() {
  const anahtar = process.env.SUPABASE_SECRET;
  if (!anahtar) return null;
  return createServisClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, anahtar, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function kafeBul(req: Request) {
  const anahtar = req.headers.get("x-okc-anahtar");
  if (!anahtar) return { hata: "ÖKC anahtarı gerekli", kod: 401 as const };
  const s = servis();
  if (!s) return { hata: "Sunucu yapılandırması eksik", kod: 500 as const };
  // Anahtar policy'siz cafe_gizli tablosunda (0035) — yalnız servis anahtarı okur
  const { data } = await s.from("cafe_gizli").select("cafe_id").eq("okc_anahtar", anahtar).single();
  if (!data) return { hata: "Geçersiz ÖKC anahtarı", kod: 403 as const };
  return { cafeId: data.cafe_id, s };
}

export async function GET(req: Request) {
  const r = await kafeBul(req);
  if ("hata" in r) return NextResponse.json({ hata: r.hata }, { status: r.kod });

  // adisyon_tutarlari view: ikram/iskonto düşülmüş güncel tutar
  const { data } = await r.s
    .from("adisyon_tutarlari")
    .select("adisyon_id, masa_id, tutar, durum, cafe_id")
    .eq("cafe_id", r.cafeId)
    .eq("durum", "acik")
    .gt("tutar", 0);

  const masaIdleri = [...new Set((data ?? []).map((a) => a.masa_id))];
  const { data: masalar } = await r.s.from("masa").select("id, ad").in("id", masaIdleri.length ? masaIdleri : ["00000000-0000-0000-0000-000000000000"]);
  const masaAd = new Map((masalar ?? []).map((m) => [m.id, m.ad]));

  const hesaplar = (data ?? []).map((a) => ({
    adisyon_id: a.adisyon_id,
    masa_ad: masaAd.get(a.masa_id) ?? "Masa",
    tutar: Number(a.tutar),
  }));
  return NextResponse.json(hesaplar);
}
