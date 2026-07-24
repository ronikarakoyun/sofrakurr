import { Expo } from "expo-server-sdk";
import { NextResponse } from "next/server";
import { createClient as createServisClient } from "@supabase/supabase-js";
import { webhookGecerli } from "@/lib/webhookGuard";

// Veritabanı tetikleyicisinden gelir (0042): sipariş 'hazir' olunca siparişi
// veren MÜŞTERİNİN telefonuna Expo push atar ("Siparişin hazır · #N").
// Kimlik: paylaşılan gizli başlık (WEBHOOK_SECRET) — tarayıcıdan çağrılamaz.
// Token'lar müşteriye özel olduğundan servis anahtarıyla okunur; ölü token
// (DeviceNotRegistered) silinir — api/push/kampanya'daki desen.

export async function POST(req: Request) {
  if (!webhookGecerli(req)) {
    return NextResponse.json({ hata: "yetkisiz" }, { status: 401 });
  }
  const anahtar = process.env.SUPABASE_SECRET;
  if (!anahtar) {
    return NextResponse.json({ hata: "SUPABASE_SECRET tanımlı değil" }, { status: 500 });
  }

  const { cafe_id, musteri_id, siparis_no } = await req.json();
  if (!cafe_id || !musteri_id) {
    return NextResponse.json({ hata: "cafe_id ve musteri_id gerekli" }, { status: 400 });
  }

  const servis = createServisClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, anahtar, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [{ data: cafe }, { data: tokenlar }] = await Promise.all([
    servis.from("cafe").select("ad").eq("id", cafe_id).single(),
    servis.from("expo_push_token").select("token").eq("kullanici_id", musteri_id),
  ]);

  const expo = new Expo();
  const gecerliler = (tokenlar ?? []).map((t) => t.token).filter((t) => Expo.isExpoPushToken(t));
  if (!gecerliler.length) return NextResponse.json({ gonderilen: 0 });

  const no = siparis_no != null ? ` · #${siparis_no}` : "";
  const mesajlar = gecerliler.map((token) => ({
    to: token,
    sound: "default" as const,
    title: `Siparişin hazır${no}`,
    body: `${cafe?.ad ?? "Kafe"} — tezgahtan alabilirsin.`,
  }));

  let gonderilen = 0;
  const olular: string[] = [];
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

  if (olular.length) {
    await servis.from("expo_push_token").delete().in("token", olular);
  }

  return NextResponse.json({ gonderilen });
}
