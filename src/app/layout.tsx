import type { Metadata, Viewport } from "next";
import { Lora, Figtree } from "next/font/google";
import "./globals.css";

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600", "700"],
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
});

// Telefonlarda yazı alanına dokununca oluşan istemsiz zoom'u engeller
// (parmakla yakınlaştırma iOS'ta çalışmaya devam eder)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: "SofraKur",
  description: "Çok-kiracılı kafe sipariş ve takip sistemi",
  // Not: dosya adı bilerek farklı — eski /manifest.webmanifest telefonlarda
  // önbelleğe takılıp "SofraKur Garson" olarak kuruluyordu.
  manifest: "/uygulama.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`${lora.variable} ${figtree.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
