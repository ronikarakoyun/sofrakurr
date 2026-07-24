"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// Rota seviyesi hata sınırı: hatayı Sentry'ye + /api/hata'ya bildirir + dostça ekran.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      Sentry.captureException(error);
    } catch {
      /* yut */
    }
    try {
      const p = location.pathname;
      const ortam = p.startsWith("/kds")
        ? "kds"
        : p.startsWith("/admin")
          ? "admin"
          : p.startsWith("/panel")
            ? "panel"
            : "web";
      void fetch("/api/hata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ortam,
          tur: "boundary",
          mesaj: error.message,
          yig: error.stack,
          url: location.href,
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* yut */
    }
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-krem p-8 text-center text-metin">
      <div className="text-5xl">☕️</div>
      <h1 className="font-serif text-xl font-semibold text-metin-baslik">Bir şeyler ters gitti</h1>
      <p className="max-w-sm text-sm text-metin-soluk">
        Sorun otomatik kaydedildi. Tekrar deneyebilir ya da sayfayı yenileyebilirsin.
      </p>
      <button
        onClick={reset}
        className="marka-gradyan rounded-xl px-5 py-2.5 text-sm font-extrabold text-white"
      >
        Tekrar dene
      </button>
    </main>
  );
}
