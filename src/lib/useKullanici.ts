"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Kullanici, KullaniciRol } from "@/lib/types";

// Personel ekranları için oturum bekçisi: giriş yoksa /giris'e yollar,
// rol yetkisizse ana sayfaya döndürür. Ağ/sunucu hatasında login'e ATMAZ —
// "bağlantı kurulamadı" durumunda kalıp tekrar dener (Supabase kısa kesintisinde
// tüm personelin giriş ekranına düşmesini önler).
export function useKullanici(izinliRoller: KullaniciRol[]) {
  const router = useRouter();
  const [kullanici, setKullanici] = useState<Kullanici | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [baglantiHatasi, setBaglantiHatasi] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let iptal = false;

    async function kontrol() {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (iptal) return;
      if (authError) {
        // "Oturum yok" bir bağlantı hatası DEĞİLDİR — giriş ekranına gönder.
        // (Aksi halde çıkış yapmış kullanıcı sonsuz "Yükleniyor…"da kalır.)
        const oturumYok =
          authError.name === "AuthSessionMissingError" ||
          (authError.message ?? "").toLowerCase().includes("session");
        if (oturumYok) {
          router.replace("/giris");
          return;
        }
        // gerçek ağ/sunucu hatası — giriş ekranına atma, birkaç saniyede tekrar dene
        setBaglantiHatasi(true);
        setTimeout(() => { if (!iptal) kontrol(); }, 4000);
        return;
      }
      if (!user) {
        router.replace("/giris");
        return;
      }
      const { data, error } = await supabase
        .from("kullanici")
        .select("id, cafe_id, rol, ad, aktif, yetkiler, secili_cafe_id")
        .eq("id", user.id)
        .single();
      if (iptal) return;
      if (error) {
        setBaglantiHatasi(true);
        setTimeout(() => { if (!iptal) kontrol(); }, 4000);
        return;
      }
      if (!data || data.aktif === false) {
        // hesap pasife alınmış — çıkış yap ve bilgilendir
        await supabase.auth.signOut();
        router.replace("/giris?pasif=1");
        return;
      }
      // franchise/super_admin, seçili kafe bağlamında admin sayılır
      // (RLS tarafında aktif_cafe_id/aktif_rol aynı eşlemeyi yapar)
      const maskeliAdmin = data.rol === "franchise" || data.rol === "super_admin";
      if (maskeliAdmin && !data.secili_cafe_id && !izinliRoller.includes(data.rol)) {
        router.replace("/panel"); // kafe seçilmemiş — panele yönlendir
        return;
      }
      const izinli =
        izinliRoller.includes(data.rol) ||
        (maskeliAdmin && izinliRoller.includes("admin"));
      if (!izinli) {
        router.replace("/");
        return;
      }
      // ekranlar cafe_id ile sorgu atar; panel kullanıcılarında seçili kafe geçerlidir
      const efektifCafeId = maskeliAdmin ? (data.secili_cafe_id ?? data.cafe_id) : data.cafe_id;

      // Efektif kafenin adı — ekran başlıklarında sabit "BUTİKEK" yerine.
      // Join YANLIŞ olurdu: franchise/super_admin'de efektif kafe secili_cafe_id,
      // join ham cafe_id'yi çözerdi. Ayrı hafif sorgu (tek satır, PK).
      // Hata verirse cafe_ad null ile devam — bu ekranı GİRİŞE ATMAMALI.
      let cafeAd: string | null = null;
      if (efektifCafeId) {
        const { data: cafe } = await supabase
          .from("cafe")
          .select("ad")
          .eq("id", efektifCafeId)
          .single();
        if (iptal) return;
        cafeAd = cafe?.ad ?? null;
      }

      setBaglantiHatasi(false);
      setKullanici({
        ...data,
        cafe_id: efektifCafeId,
        cafe_ad: cafeAd,
      } as Kullanici);
      setYukleniyor(false);
    }

    kontrol();
    return () => { iptal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { kullanici, yukleniyor, baglantiHatasi };
}
