import { NextResponse } from "next/server";
import webpush from "web-push";
import { createClient as createServisClient } from "@supabase/supabase-js";
import { webhookGecerli } from "@/lib/webhookGuard";

// Veritabanı tetikleyicisinden gelir (0020): QR'dan yeni müşteri siparişi
// düştüğünde kafenin tüm push abonelerine "onay bekliyor" bildirimi basar.
// Kimlik: paylaşılan gizli başlık (WEBHOOK_SECRET) — tarayıcıdan çağrılamaz.

export async function POST(req: Request) {
  if (!webhookGecerli(req)) {
    return NextResponse.json({ hata: "yetkisiz" }, { status: 401 });
  }
  const anahtar = process.env.SUPABASE_SECRET;
  if (!anahtar) {
    return NextResponse.json({ hata: "SUPABASE_SECRET tanımlı değil" }, { status: 500 });
  }

  const { cafe_id, masa_id, siparis_id } = await req.json();
  if (!cafe_id || !masa_id) {
    return NextResponse.json({ hata: "cafe_id ve masa_id gerekli" }, { status: 400 });
  }

  const servis = createServisClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, anahtar, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [{ data: masa }, { data: abonelikler }, { data: siparis }] = await Promise.all([
    servis.from("masa").select("ad").eq("id", masa_id).single(),
    servis.from("push_abonelik").select("id, endpoint, p256dh, auth").eq("cafe_id", cafe_id),
    siparis_id
      ? servis.from("siparis").select("siparis_no").eq("id", siparis_id).single()
      : Promise.resolve({ data: null }),
  ]);
  if (!abonelikler?.length) return NextResponse.json({ gonderilen: 0 });

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:ornek@eposta.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );

  const no = siparis?.siparis_no != null ? ` #${siparis.siparis_no}` : "";
  const yuk = JSON.stringify({
    baslik: `${masa?.ad ?? "Masa"} · Yeni sipariş${no}`,
    govde: "Masa sipariş verdi — onay bekliyor. Onaylayın ya da reddedin.",
    tag: `onay-${masa_id}`,
  });

  let gonderilen = 0;
  await Promise.all(
    abonelikler.map(async (a) => {
      try {
        await webpush.sendNotification(
          { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
          yuk
        );
        gonderilen++;
      } catch (e: unknown) {
        const kod = (e as { statusCode?: number }).statusCode;
        if (kod === 404 || kod === 410) {
          await servis.from("push_abonelik").delete().eq("id", a.id);
        }
      }
    })
  );

  return NextResponse.json({ gonderilen });
}
