import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hataKaydet } from "@/lib/hataKaydet";

// İstemci hatalarını (instrumentation-client + error boundary) hata_log'a yazar.
// Oturumdan kullanıcı + efektif kafe çözülür (varsa); giriş öncesi hatalarda
// cafe_id null. Her koşulda 200 döner — hata izleme akışı hiç patlamamalı.
export async function POST(req: Request) {
  let govde: Record<string, unknown> = {};
  try {
    govde = await req.json();
  } catch {
    /* gövde yok */
  }
  const mesaj = typeof govde.mesaj === "string" ? govde.mesaj : "";
  if (!mesaj) return NextResponse.json({ ok: true });

  let kullaniciId: string | null = null;
  let cafeId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      kullaniciId = user.id;
      const { data } = await supabase
        .from("kullanici")
        .select("cafe_id, secili_cafe_id, rol")
        .eq("id", user.id)
        .single();
      if (data) {
        const maskeli = data.rol === "franchise" || data.rol === "super_admin";
        cafeId = maskeli ? (data.secili_cafe_id ?? data.cafe_id) : data.cafe_id;
      }
    }
  } catch {
    /* oturum çözülemedi — cafe_id null kalır */
  }

  await hataKaydet({
    cafe_id: cafeId,
    kullanici_id: kullaniciId,
    ortam: govde.ortam,
    tur: govde.tur,
    mesaj,
    yig: govde.yig,
    url: govde.url,
    tarayici: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true });
}
