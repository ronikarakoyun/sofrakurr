import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServisClient } from "@supabase/supabase-js";

// Personel hesabı açma / şifre sıfırlama — yalnız admin çağırabilir.
// Hesap işlemleri Supabase auth admin API'si ister; servis anahtarı yalnız
// sunucuda durur (SUPABASE_SECRET), tarayıcıya asla inmez.

async function adminDogrula() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("kullanici")
    .select("cafe_id, rol, secili_cafe_id")
    .eq("id", user.id)
    .single();
  if (!data) return null;
  // franchise/super_admin, seçili kafenin admin'i sayılır
  const maskeli = data.rol === "franchise" || data.rol === "super_admin";
  const cafeId = maskeli ? data.secili_cafe_id : data.cafe_id;
  if ((data.rol !== "admin" && !maskeli) || !cafeId) return null;
  return { cafeId, kendiId: user.id };
}

function servisClient() {
  const anahtar = process.env.SUPABASE_SECRET;
  if (!anahtar) return null;
  return createServisClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, anahtar, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Kafedeki personelin giriş e-postalarını döner (yalnız admin görür).
// Şifreler geri çözülemez şekilde saklandığından hiçbir zaman listelenemez;
// admin ancak yeni şifre belirleyebilir.
export async function GET() {
  const yetki = await adminDogrula();
  if (!yetki) return NextResponse.json({ hata: "Bu işlem için admin girişi gerekli" }, { status: 403 });
  const servis = servisClient();
  if (!servis) return NextResponse.json({ hata: "Sunucuda SUPABASE_SECRET tanımlı değil" }, { status: 500 });

  const { data: kayitlar } = await servis
    .from("kullanici")
    .select("id")
    .eq("cafe_id", yetki.cafeId)
    .neq("rol", "musteri");

  const epostalar: Record<string, string> = {};
  await Promise.all(
    (kayitlar ?? []).map(async (k) => {
      const { data } = await servis.auth.admin.getUserById(k.id);
      if (data?.user?.email) epostalar[k.id] = data.user.email;
    })
  );
  return NextResponse.json({ epostalar });
}

export async function POST(req: Request) {
  const yetki = await adminDogrula();
  if (!yetki) return NextResponse.json({ hata: "Bu işlem için admin girişi gerekli" }, { status: 403 });
  const servis = servisClient();
  if (!servis) return NextResponse.json({ hata: "Sunucuda SUPABASE_SECRET tanımlı değil" }, { status: 500 });

  const { ad, eposta, sifre, rol } = await req.json();
  if (!ad?.trim()) return NextResponse.json({ hata: "İsim gerekli" }, { status: 400 });
  if (!eposta?.includes("@")) return NextResponse.json({ hata: "Geçerli bir e-posta gerekli" }, { status: 400 });
  if (!sifre || sifre.length < 8) return NextResponse.json({ hata: "Şifre en az 8 karakter olmalı" }, { status: 400 });
  if (!["kasa", "mutfak"].includes(rol)) {
    return NextResponse.json({ hata: "Rol kasa veya mutfak olmalı" }, { status: 400 });
  }

  const { data: yeni, error } = await servis.auth.admin.createUser({
    email: eposta.trim().toLowerCase(),
    password: sifre,
    email_confirm: true,
  });
  if (error || !yeni.user) {
    return NextResponse.json({ hata: error?.message ?? "Hesap açılamadı" }, { status: 400 });
  }

  const { error: kayitHatasi } = await servis.from("kullanici").insert({
    id: yeni.user.id,
    cafe_id: yetki.cafeId,
    rol,
    ad: ad.trim(),
  });
  if (kayitHatasi) {
    await servis.auth.admin.deleteUser(yeni.user.id);
    return NextResponse.json({ hata: kayitHatasi.message }, { status: 400 });
  }
  return NextResponse.json({ id: yeni.user.id });
}

export async function PATCH(req: Request) {
  const yetki = await adminDogrula();
  if (!yetki) return NextResponse.json({ hata: "Bu işlem için admin girişi gerekli" }, { status: 403 });
  const servis = servisClient();
  if (!servis) return NextResponse.json({ hata: "Sunucuda SUPABASE_SECRET tanımlı değil" }, { status: 500 });

  const { kullaniciId, sifre, eposta } = await req.json();
  if (!kullaniciId) return NextResponse.json({ hata: "Kullanıcı gerekli" }, { status: 400 });
  if (sifre && sifre.length < 8) {
    return NextResponse.json({ hata: "Yeni şifre en az 8 karakter olmalı" }, { status: 400 });
  }
  if (eposta !== undefined && !eposta?.includes("@")) {
    return NextResponse.json({ hata: "Geçerli bir e-posta gerekli" }, { status: 400 });
  }
  if (!sifre && eposta === undefined) {
    return NextResponse.json({ hata: "Değişecek bir alan yok" }, { status: 400 });
  }

  // Hedef hesap admin'in kendi kafesinde mi?
  const { data: hedef } = await servis
    .from("kullanici")
    .select("cafe_id")
    .eq("id", kullaniciId)
    .single();
  if (hedef?.cafe_id !== yetki.cafeId) {
    return NextResponse.json({ hata: "Bu personel senin kafende değil" }, { status: 403 });
  }

  const degisiklik: { password?: string; email?: string; email_confirm?: boolean } = {};
  if (sifre) degisiklik.password = sifre;
  if (eposta !== undefined) {
    degisiklik.email = String(eposta).trim().toLowerCase();
    degisiklik.email_confirm = true; // onay maili bekletme, direkt geçerli olsun
  }
  const { error } = await servis.auth.admin.updateUserById(kullaniciId, degisiklik);
  if (error) return NextResponse.json({ hata: error.message }, { status: 400 });
  if (sifre) {
    // Açık oturumları düşür: eski şifreyle açık sekmeler geçersiz olsun
    await servis.auth.admin.signOut(kullaniciId, "global").catch(() => {});
  }
  return NextResponse.json({ tamam: true });
}

// Personeli kalıcı siler (auth hesabı + personel kaydı; geçmiş sipariş ve
// belgeler durur, yalnız eski fişlerdeki "Yazan" adı boşalır).
export async function DELETE(req: Request) {
  const yetki = await adminDogrula();
  if (!yetki) return NextResponse.json({ hata: "Bu işlem için admin girişi gerekli" }, { status: 403 });
  const servis = servisClient();
  if (!servis) return NextResponse.json({ hata: "Sunucuda SUPABASE_SECRET tanımlı değil" }, { status: 500 });

  const { kullaniciId } = await req.json();
  if (!kullaniciId) return NextResponse.json({ hata: "Kullanıcı gerekli" }, { status: 400 });
  if (kullaniciId === yetki.kendiId) {
    return NextResponse.json({ hata: "Kendi hesabını silemezsin" }, { status: 400 });
  }

  const { data: hedef } = await servis
    .from("kullanici")
    .select("cafe_id, rol")
    .eq("id", kullaniciId)
    .single();
  if (!hedef || hedef.cafe_id !== yetki.cafeId) {
    return NextResponse.json({ hata: "Bu personel senin kafende değil" }, { status: 403 });
  }
  if (hedef.rol === "admin") {
    return NextResponse.json({ hata: "Yönetici hesabı silinemez (önce rolünü değiştirin)" }, { status: 400 });
  }

  // auth kullanıcısı silinince kullanici kaydı cascade ile birlikte silinir
  const { error } = await servis.auth.admin.deleteUser(kullaniciId);
  if (error) return NextResponse.json({ hata: error.message }, { status: 400 });
  return NextResponse.json({ tamam: true });
}
