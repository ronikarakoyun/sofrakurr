import type { Metadata } from "next";

// KDS kendi PWA manifestini kullanır: "SofraKur Mutfak" adıyla ayrı bir
// uygulama olarak kurulur ve doğrudan sipariş ekranına açılır.
export const metadata: Metadata = {
  manifest: "/kds.webmanifest",
};

export default function KdsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
