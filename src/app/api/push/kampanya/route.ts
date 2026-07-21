import { Expo } from "expo-server-sdk";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServisClient } from "@supabase/supabase-js";

// Kampanya push gönderimi: admin panelden tetiklenir, kafenin sadakat
// üyelerinin (uygulama yüklü müşteriler) telefonlarına bildirim düşer.
//
//   POST /api/push/kampanya   gövde: { kampanya_id }
//
// Kimlik: oturum çerezi + admin rolü. Token'lar müşteriye özel olduğu için
// RLS ile okunamaz — hedefleme servis anahtarıyla yapılır
// (api/push/siparis'teki desen). Ölü token'lar (DeviceNotRegistered) silinir.

async function adminDogrula() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("kullanici")
    .select("cafe_id, rol, secili_cafe_id, zincir_id")
    .eq("id", user.id)
    .single();
  if (!data) return null;
  // franchise/super_admin, seçili kafenin admin'i sayılır
  const maskeli = data.rol === "franchise" || data.rol === "super_admin";
  const cafeId = maskeli ? data.secili_cafe_id : data.cafe_id;
  if ((data.rol !== "admin" && !maskeli) || !cafeId) return null;
  return { cafeId, rol: data.rol, zincirId: data.zincir_id as string | null };
}

function servis() {
  const anahtar = process.env.SUPABASE_SECRET;
  if (!anahtar) return null;
  return createServisClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, anahtar, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: Request) {
  const yetki = await adminDogrula();
  if (!yetki) return NextResponse.json({ hata: "Bu işlem için admin girişi gerekli" }, { status: 403 });
  const s = servis();
  if (!s) return NextResponse.json({ hata: "Sunucuda SUPABASE_SECRET tanımlı değil" }, { status: 500 });

  const { kampanya_id } = await req.json();
  if (!kampanya_id) return NextResponse.json({ hata: "kampanya_id gerekli" }, { status: 400 });

  // Kampanya bu kafenin (ya da zincir kampanyasıysa bu zincirin) mi
  // ve hâlâ taslak mı? (çift gönderim engeli)
  const { data: kampanya } = await s
    .from("kampanya")
    .select("id, cafe_id, zincir_id, baslik, govde, durum")
    .eq("id", kampanya_id)
    .single();
  const zincirKampanyasi = !!kampanya?.zincir_id;
  const sahip = zincirKampanyasi
    ? yetki.rol === "super_admin" || kampanya!.zincir_id === yetki.zincirId
    : kampanya?.cafe_id === yetki.cafeId;
  if (!kampanya || !sahip) {
    return NextResponse.json({ hata: "Kampanya bulunamadı" }, { status: 404 });
  }
  if (kampanya.durum !== "taslak") {
    return NextResponse.json({ hata: "Bu kampanya zaten gönderilmiş" }, { status: 409 });
  }

  // Hedef kitle: zincir kampanyasında zincirin tüm sadakat üyeleri,
  // kafe kampanyasında yalnız o kafenin üyeleri
  const sorgu = s.from("sadakat_hesabi").select("kullanici_id");
  const { data: hesaplar } = zincirKampanyasi
    ? await sorgu.eq("zincir_id", kampanya.zincir_id)
    : await sorgu.eq("cafe_id", yetki.cafeId);
  const uyeIdleri = [...new Set((hesaplar ?? []).map((h) => h.kullanici_id))];

  let tokenlar: { token: string }[] = [];
  if (uyeIdleri.length) {
    const { data } = await s
      .from("expo_push_token")
      .select("token")
      .in("kullanici_id", uyeIdleri);
    tokenlar = data ?? [];
  }

  const expo = new Expo();
  const gecerliler = tokenlar.map((t) => t.token).filter((t) => Expo.isExpoPushToken(t));

  let gonderilen = 0;
  const olular: string[] = [];
  if (gecerliler.length) {
    const mesajlar = gecerliler.map((token) => ({
      to: token,
      sound: "default" as const,
      title: kampanya.baslik,
      body: kampanya.govde,
    }));
    for (const parca of expo.chunkPushNotifications(mesajlar)) {
      try {
        const biletler = await expo.sendPushNotificationsAsync(parca);
        biletler.forEach((bilet, i) => {
          if (bilet.status === "ok") {
            gonderilen++;
          } else if (bilet.details?.error === "DeviceNotRegistered") {
            olular.push(parca[i].to as string);
          }
        });
      } catch {
        // Expo servisine ulaşılamadı — kalan parçaları denemeye devam et
      }
    }
  }

  // Ölü token temizliği (uygulama silinmiş cihazlar)
  if (olular.length) {
    await s.from("expo_push_token").delete().in("token", olular);
  }

  await s
    .from("kampanya")
    .update({
      durum: "gonderildi",
      gonderim_zamani: new Date().toISOString(),
      gonderilen_adet: gonderilen,
    })
    .eq("id", kampanya.id);

  return NextResponse.json({ tamam: true, gonderilen, uye: uyeIdleri.length });
}
