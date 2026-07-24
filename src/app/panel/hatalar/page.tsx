"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useKullanici } from "@/lib/useKullanici";

interface HataSatir {
  id: string;
  cafe_ad: string | null;
  kullanici_ad: string | null;
  ortam: string | null;
  tur: string | null;
  mesaj: string;
  yig: string | null;
  url: string | null;
  created_at: string;
}

const ORTAM_RENK: Record<string, string> = {
  kasa: "bg-uyari-zemin text-uyari",
  kds: "bg-basari-zemin text-basari",
  admin: "bg-krem-koyu text-metin-orta",
  panel: "bg-krem-koyu text-metin-orta",
  qr: "bg-[#e9f0f9] text-[#31639c]",
  sunucu: "bg-tehlike-zemin text-tehlike",
  giris: "bg-krem-koyu text-metin-orta",
};

export default function HatalarSayfasi() {
  const { kullanici, yukleniyor } = useKullanici(["franchise", "super_admin"]);
  const [hatalar, setHatalar] = useState<HataSatir[]>([]);
  const [yukleniyorVeri, setYukleniyorVeri] = useState(true);
  const [acik, setAcik] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    if (!kullanici) return;
    setYukleniyorVeri(true);
    const supabase = createClient();
    const { data } = await supabase.rpc("hata_listesi", { p_limit: 200 });
    setHatalar((data as HataSatir[]) ?? []);
    setYukleniyorVeri(false);
  }, [kullanici]);

  useEffect(() => {
    yukle();
  }, [yukle]);

  if (yukleniyor || !kullanici) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-krem">
        <p className="animate-pulse text-metin-soluk">Yükleniyor…</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-krem px-5 pb-12 pt-6 text-metin">
      <div className="mx-auto max-w-[840px]">
        <Link href="/panel" className="text-[13px] font-bold text-metin-soluk">
          ← Panele dön
        </Link>
        <div className="mt-2 flex items-center justify-between gap-3">
          <h1 className="font-serif text-2xl font-semibold text-metin-baslik">Hata Kayıtları</h1>
          <button
            onClick={yukle}
            className="rounded-[10px] border border-cizgi-koyu bg-kart px-3 py-1.5 text-[13px] font-bold text-metin-orta"
          >
            Yenile
          </button>
        </div>
        <p className="mt-1 text-[13px] text-metin-soluk">
          Canlıda oluşan istemci ve sunucu hataları (son 30 gün). En yeni üstte.
        </p>

        {yukleniyorVeri ? (
          <p className="animate-pulse py-10 text-center text-[13px] text-metin-soluk">Yükleniyor…</p>
        ) : hatalar.length === 0 ? (
          <p className="py-10 text-center text-[14px] text-basari">🎉 Kayıtlı hata yok.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-1.5">
            {hatalar.map((h) => (
              <div key={h.id} className="rounded-xl border border-cizgi bg-kart px-4 py-3">
                <button
                  onClick={() => setAcik(acik === h.id ? null : h.id)}
                  className="flex w-full items-start gap-2.5 text-left"
                >
                  <span
                    className={
                      "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-extrabold " +
                      (ORTAM_RENK[h.ortam ?? ""] ?? "bg-krem-koyu text-metin-orta")
                    }
                  >
                    {h.ortam ?? "?"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-[13.5px] font-semibold text-metin-baslik">
                      {h.mesaj}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-metin-soluk">
                      {new Date(h.created_at).toLocaleString("tr-TR", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {h.cafe_ad ? ` · ${h.cafe_ad}` : ""}
                      {h.kullanici_ad ? ` · ${h.kullanici_ad}` : ""}
                      {h.tur ? ` · ${h.tur}` : ""}
                    </span>
                  </span>
                </button>
                {acik === h.id && (
                  <div className="mt-2 border-t border-dashed border-cizgi-koyu pt-2">
                    {h.url && (
                      <p className="mb-1 break-all text-[11.5px] text-metin-soluk">
                        <b>URL:</b> {h.url}
                      </p>
                    )}
                    {h.yig && (
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-krem px-2.5 py-2 text-[11px] leading-relaxed text-metin-orta">
                        {h.yig}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
