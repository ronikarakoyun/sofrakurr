"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function CikisButonu() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await createClient().auth.signOut();
        router.replace("/giris");
      }}
      className="text-sm opacity-50 hover:opacity-100"
      title="Oturumu kapat"
    >
      Çıkış
    </button>
  );
}
