import type { Metadata } from "next";

// Kasa kendi PWA manifestini kullanır: Windows'ta "SofraKur Kasa" adıyla
// ayrı bir uygulama olarak kurulur ve doğrudan kasa ekranına açılır.
export const metadata: Metadata = {
  manifest: "/kasa.webmanifest",
};

export default function KasaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
