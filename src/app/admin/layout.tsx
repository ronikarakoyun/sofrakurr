import type { Metadata } from "next";
import { AdminKabuk } from "@/components/AdminKabuk";

// Yönetim kendi PWA manifestini kullanır: Windows'ta "SofraKur Yönetim"
// adıyla ayrı bir uygulama olarak kurulur ve doğrudan panele açılır.
export const metadata: Metadata = {
  manifest: "/admin.webmanifest",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminKabuk>{children}</AdminKabuk>;
}
