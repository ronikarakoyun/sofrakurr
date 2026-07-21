import { NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@/lib/supabase/server";

// Personel tetikler (KDS "Hazır ✓" gibi): istekteki oturumun RLS yetkisiyle
// kafenin push aboneliklerini okur ve hepsine bildirim gönderir.
export async function POST(req: Request) {
  const { baslik, govde, tag } = await req.json();
  if (!baslik) {
    return NextResponse.json({ hata: "baslik gerekli" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ hata: "giriş gerekli" }, { status: 401 });
  }

  // RLS: personel yalnız kendi kafesinin aboneliklerini görür
  const { data: abonelikler } = await supabase
    .from("push_abonelik")
    .select("id, endpoint, p256dh, auth");
  if (!abonelikler?.length) {
    return NextResponse.json({ gonderilen: 0 });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:ornek@eposta.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );

  const yuk = JSON.stringify({ baslik, govde: govde ?? "", tag });
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
          // abonelik ölmüş; temizle
          await supabase.from("push_abonelik").delete().eq("id", a.id);
        }
      }
    })
  );

  return NextResponse.json({ gonderilen });
}
