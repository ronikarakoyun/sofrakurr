import { NextResponse } from "next/server";
import { createClient as createServisClient } from "@supabase/supabase-js";

// Yazarkasa (ÖKC) ödeme bildirimi: cihaz seçilen hesabın tahsilatını (mali fiş +
// kart/nakit) yaptıktan sonra bunu çağırır; SofraKur adisyonu kapatır.
//
//   POST /api/okc/ode   (başlık: x-okc-anahtar)
//   gövde: { adisyon_id, odeme_turu: "nakit" | "kart" }

function servis() {
  const anahtar = process.env.SUPABASE_SECRET;
  if (!anahtar) return null;
  return createServisClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, anahtar, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: Request) {
  const anahtar = req.headers.get("x-okc-anahtar");
  if (!anahtar) return NextResponse.json({ hata: "ÖKC anahtarı gerekli" }, { status: 401 });
  const s = servis();
  if (!s) return NextResponse.json({ hata: "Sunucu yapılandırması eksik" }, { status: 500 });

  // Anahtar policy'siz cafe_gizli tablosunda (0035) — yalnız servis anahtarı okur
  const { data: kafe } = await s
    .from("cafe_gizli")
    .select("cafe_id")
    .eq("okc_anahtar", anahtar)
    .single();
  if (!kafe) return NextResponse.json({ hata: "Geçersiz ÖKC anahtarı" }, { status: 403 });

  const { adisyon_id, odeme_turu } = await req.json();
  if (!adisyon_id || !["nakit", "kart"].includes(odeme_turu)) {
    return NextResponse.json({ hata: "adisyon_id ve geçerli odeme_turu gerekli" }, { status: 400 });
  }

  // Adisyon gerçekten bu kafeye ait ve hâlâ açık mı? (başka kafenin hesabı kapatılamaz)
  const { data: adisyon } = await s
    .from("adisyon")
    .select("id, cafe_id, durum")
    .eq("id", adisyon_id)
    .single();
  if (!adisyon || adisyon.cafe_id !== kafe.cafe_id) {
    return NextResponse.json({ hata: "Hesap bulunamadı" }, { status: 404 });
  }
  if (adisyon.durum !== "acik") {
    return NextResponse.json({ hata: "Hesap zaten kapatılmış", durum: adisyon.durum }, { status: 409 });
  }

  // Guard'lı kapatma (yalnız 'acik' kapatır; bekleyen siparişler mutfağa geçer)
  const { data: kapandi, error } = await s.rpc("adisyon_kapat", {
    p_adisyon_id: adisyon_id,
    p_odeme_turu: odeme_turu,
  });
  if (error) return NextResponse.json({ hata: error.message }, { status: 500 });
  if (kapandi === false) {
    return NextResponse.json({ hata: "Hesap zaten kapatılmış olabilir" }, { status: 409 });
  }
  return NextResponse.json({ tamam: true });
}
