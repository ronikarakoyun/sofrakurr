import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Güvenlik başlıkları: kasa/yönetim panelleri clickjacking'e ve MIME
  // sniffing'e karşı korunur; HTTPS zorlanır. İçerik CSP'si (script-src)
  // Next'in inline script'leri için nonce gerektirdiğinden bilerek dışarıda —
  // ayrı, tam test edilmiş bir adımda eklenecek. Buradaki başlıklar sıfır
  // regresyon: uygulama hiçbir yere gömülmüyor, tüm trafik zaten HTTPS.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },

  // Tek görünen adres sofrakur.com olsun: vercel.app ve www adreslerine
  // gelenler kalıcı olarak ana alan adına taşınır (eski linkler kırılmaz).
  async redirects() {
    return [
      // Eski QR menü domaini (butikekmenü.com): masalardaki basılı QR'lar masa
      // bilgisi taşımadığı için müşteri masa seçim köprüsüne yönlendirilir.
      // permanent değil: ileride davranışı değiştirebilelim (tarayıcı ezberlemesin).
      {
        source: "/:path*",
        has: [{ type: "host", value: "xn--butikekmen-jeb.com" }],
        destination: "https://sofrakur.com/masa-sec?kafe=aa323c9b-732a-4766-bb68-6e6b2131d472",
        permanent: false,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.xn--butikekmen-jeb.com" }],
        destination: "https://sofrakur.com/masa-sec?kafe=aa323c9b-732a-4766-bb68-6e6b2131d472",
        permanent: false,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "sofrakur.vercel.app" }],
        destination: "https://sofrakur.com/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.sofrakur.com" }],
        destination: "https://sofrakur.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
