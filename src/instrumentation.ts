import type { Instrumentation } from "next";
import * as Sentry from "@sentry/nextjs";
import { hataKaydet } from "@/lib/hataKaydet";
import { SENTRY_DSN } from "@/lib/sentryDsn";

// Sunucu (nodejs + edge) başlangıcında Sentry'yi başlat.
export function register() {
  Sentry.init({
    dsn: SENTRY_DSN,
    enabled: process.env.NODE_ENV === "production",
    tracesSampleRate: 0,
  });
}

// Sunucu hataları (Server Component / Route Handler / RSC render): hem Sentry'ye
// (uyarı) hem kendi hata_log'umuza. Next 16: Next sunucusu hata yakalayınca tetiklenir.
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context
) => {
  try {
    Sentry.captureRequestError(err, request, context);
  } catch {
    /* Sentry başarısızsa kendi log'umuz yine yazar */
  }
  const mesaj = err instanceof Error ? err.message : String(err);
  const yig = err instanceof Error ? err.stack : undefined;
  await hataKaydet({
    ortam: "sunucu",
    tur: "server",
    mesaj,
    yig,
    url: request?.path,
  });
};
