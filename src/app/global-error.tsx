"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// Kök layout hatası sınırı: kendi <html>/<body>'sini render eder. Inline stil
// (kök layout devre dışı olabildiğinden global CSS'e güvenmez).
export default function GlobalError({
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
      void fetch("/api/hata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ortam: "web",
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
    <html lang="tr">
      <body
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          background: "#faf6f1",
          color: "#5b3a1d",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "32px",
          margin: 0,
        }}
      >
        <div style={{ fontSize: "48px" }}>☕️</div>
        <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Bir şeyler ters gitti</h1>
        <p style={{ fontSize: "14px", color: "#93806f", maxWidth: "360px" }}>
          Sorun otomatik kaydedildi. Sayfayı yenilemeyi dene.
        </p>
        <button
          onClick={reset}
          style={{
            background: "linear-gradient(135deg, #c86f2c, #8a4b1f)",
            color: "#fff",
            border: "none",
            borderRadius: "12px",
            padding: "10px 20px",
            fontWeight: 800,
            fontSize: "14px",
            cursor: "pointer",
          }}
        >
          Tekrar dene
        </button>
      </body>
    </html>
  );
}
