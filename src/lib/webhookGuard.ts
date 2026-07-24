import { timingSafeEqual } from "crypto";

// Webhook gizli başlığını SABİT ZAMANLI karşılaştırır (timing attack'e karşı).
// DB tetikleyicilerinden gelen /api/push/* çağrıları bu paylaşılan sırla
// doğrulanır; düz `!==` karşılaştırması karakter karakter erken çıkabildiğinden
// teorik bir zamanlama sızıntısı taşırdı.
export function webhookGecerli(req: Request): boolean {
  const gizli = process.env.WEBHOOK_SECRET;
  if (!gizli) return false;
  const gelen = req.headers.get("x-webhook-secret") ?? "";
  const a = Buffer.from(gelen);
  const b = Buffer.from(gizli);
  // Uzunluk eşitliği timingSafeEqual'ın ön koşulu; farklıysa zaten yetkisiz.
  return a.length === b.length && timingSafeEqual(a, b);
}
