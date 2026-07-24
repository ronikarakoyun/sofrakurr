"use client";

import { useKullanici } from "@/lib/useKullanici";
import { TedarikciBolumu } from "@/components/TedarikciBolumu";

// Tedarikçi belgeleri (fatura → stok girişi): kasa ekranı emekli edilince
// yönetim paneline taşındı. Bileşen olduğu gibi yeniden kullanılır.
export default function TedarikciSayfasi() {
  const { kullanici, yukleniyor } = useKullanici(["admin"]);

  if (yukleniyor || !kullanici) {
    return <p className="animate-pulse p-6 text-metin-soluk">Yükleniyor…</p>;
  }

  return <TedarikciBolumu kullanici={kullanici} />;
}
