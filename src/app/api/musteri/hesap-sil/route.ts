import { NextResponse } from "next/server";
import { createClient as createServisClient } from "@supabase/supabase-js";

// Müşteri hesabını KALICI siler (App Store 5.1.1 gereği uygulama içinden).
// Mobil uygulama çerez taşımaz; kimlik Authorization: Bearer <access_token>
// başlığıyla gelir, token Supabase'e doğrulatılır. Yalnız 'musteri' rolü
// silinebilir — personel hesapları bu uçtan SİLİNEMEZ.
// auth.users silinince kullanici + sadakat_hesabi + puan_hareketi +
// expo_push_token cascade ile gider; sipariş geçmişi kalır (musteri_id null).

function servis() {
  const anahtar = process.env.SUPABASE_SECRET;
  if (!anahtar) return null;
  return createServisClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, anahtar, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: Request) {
  const yetkiBasligi = req.headers.get("authorization") ?? "";
  const token = yetkiBasligi.startsWith("Bearer ") ? yetkiBasligi.slice(7) : null;
  if (!token) return NextResponse.json({ hata: "Giriş gerekli" }, { status: 401 });

  const s = servis();
  if (!s) return NextResponse.json({ hata: "Sunucu yapılandırması eksik" }, { status: 500 });

  const { data: dogrulama, error: tokenHata } = await s.auth.getUser(token);
  if (tokenHata || !dogrulama.user) {
    return NextResponse.json({ hata: "Oturum doğrulanamadı" }, { status: 401 });
  }
  const kullaniciId = dogrulama.user.id;

  const { data: kayit } = await s
    .from("kullanici")
    .select("rol")
    .eq("id", kullaniciId)
    .single();
  if (kayit && kayit.rol !== "musteri") {
    return NextResponse.json(
      { hata: "Personel hesapları buradan silinemez — yöneticinize başvurun" },
      { status: 403 }
    );
  }

  const { error } = await s.auth.admin.deleteUser(kullaniciId);
  if (error) return NextResponse.json({ hata: error.message }, { status: 500 });
  return NextResponse.json({ tamam: true });
}
