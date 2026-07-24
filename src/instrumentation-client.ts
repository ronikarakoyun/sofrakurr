// İstemci hata izleme (Next 16 instrumentation-client): yakalanmamış hataları
// ve promise reddetmelerini hem Sentry'ye (uyarı) hem /api/hata'ya (kendi log)
// gönderir. Her şey try/catch içinde — izleme kodu uygulamayı asla bozmaz.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_DSN } from "@/lib/sentryDsn";

Sentry.init({
  dsn: SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production", // dev'de Sentry'ye gönderme
  tracesSampleRate: 0, // yalnız hata izleme, performans/replay yok
});

function ortamBul(): string {
  const p = typeof location !== "undefined" ? location.pathname : "";
  if (p.startsWith("/kds")) return "kds";
  if (p.startsWith("/admin")) return "admin";
  if (p.startsWith("/panel")) return "panel";
  if (p.startsWith("/giris")) return "giris";
  return "web";
}

function bildir(tur: string, mesaj: string, yig?: string) {
  try {
    void fetch("/api/hata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ortam: ortamBul(),
        tur,
        mesaj: mesaj || "(mesaj yok)",
        yig,
        url: location.href,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* yut */
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => {
    bildir("client", e.message || "window.error", e.error?.stack);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as { message?: string; stack?: string } | undefined;
    bildir("unhandledrejection", r?.message || String(e.reason), r?.stack);
  });
}
