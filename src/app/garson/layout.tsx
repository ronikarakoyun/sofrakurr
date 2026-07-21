import type { Metadata } from "next";

// Garson sayfası kendi PWA manifestini kullanır: uygulama olarak yüklenince
// doğrudan masa haritasına açılır ve "SofraKur Garson" adıyla kurulur.
export const metadata: Metadata = {
  manifest: "/garson.webmanifest",
};

export default function GarsonLayout({ children }: { children: React.ReactNode }) {
  return children;
}
