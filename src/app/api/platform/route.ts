import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServisClient } from "@supabase/supabase-js";

// Platform işlemleri — yalnız süper admin (gerçek rol, maske değil):
//   POST { islem: "kafe", ... }      → yeni kafe + yönetici hesabı + bölüm/masalar
//   POST { islem: "franchise", ... } → zincire bağlı franchise hesabı
// Auth hesabı açma admin API'si gerektirdiğinden servis anahtarıyla çalışır;
// zincir CRUD ve raporlar ise SQL RPC'lerinde (0039).

async function superDogrula() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("kullanici")
    .select("rol, aktif")
    .eq("id", user.id)
    .single();
  if (!data?.aktif || data.rol !== "super_admin") return null;
  return { id: user.id };
}

function servisClient() {
  const anahtar = process.env.SUPABASE_SECRET;
  if (!anahtar) return null;
  return createServisClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, anahtar, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface BolumIstek {
  ad: string;
  masaSayisi: number;
}

// Toplu kurulumda bir şube satırı (panelde yapıştırılan listeden ayrıştırılır)
interface TopluSatir {
  ad?: string;
  slug?: string;
  il?: string;
  ilce?: string;
  adres?: string;
  adminAd?: string;
  adminEposta?: string;
  adminSifre?: string;
}

export async function POST(req: Request) {
  const yetki = await superDogrula();
  if (!yetki) {
    return NextResponse.json({ hata: "Bu işlem için platform yöneticisi girişi gerekli" }, { status: 403 });
  }
  const servis = servisClient();
  if (!servis) return NextResponse.json({ hata: "Sunucuda SUPABASE_SECRET tanımlı değil" }, { status: 500 });

  const govde = await req.json();

  // ------------------------------------------------------- toplu şube kurulumu
  // 100 şubeli zinciri tek seferde kurar: her satır bağımsız denenir, hatalı
  // satırlar raporlanır, başarılılar geri alınmaz. Şubeler self-servis
  // (masasız) doğar; sonda zincir menüsü tüm şubelere uygulanır.
  if (govde.islem === "toplu_kafe") {
    const { zincirId } = govde;
    const satirlar: TopluSatir[] = Array.isArray(govde.satirlar) ? govde.satirlar : [];
    if (!zincirId) return NextResponse.json({ hata: "Zincir seçimi gerekli" }, { status: 400 });
    if (!satirlar.length) return NextResponse.json({ hata: "En az bir şube satırı gerekli" }, { status: 400 });
    if (satirlar.length > 300) {
      return NextResponse.json({ hata: "Tek seferde en fazla 300 şube kurulabilir" }, { status: 400 });
    }
    const { data: zincir } = await servis.from("zincir").select("id").eq("id", zincirId).single();
    if (!zincir) return NextResponse.json({ hata: "Zincir bulunamadı" }, { status: 404 });

    const kurulan: { ad: string; slug: string }[] = [];
    const hatalar: { satir: number; ad: string; hata: string }[] = [];

    for (const [i, r] of satirlar.entries()) {
      const ad = (r.ad ?? "").trim();
      const slug = (r.slug ?? "").trim();
      const eposta = (r.adminEposta ?? "").trim().toLowerCase();
      const sifre = r.adminSifre || govde.ortakSifre;
      const sorun =
        !ad ? "Şube adı boş" :
        !/^[a-z0-9-]+$/.test(slug) ? "Adres yalnız küçük harf, rakam ve tire içerebilir" :
        !eposta.includes("@") ? "Geçerli bir yönetici e-postası gerekli" :
        !sifre || sifre.length < 8 ? "Şifre en az 8 karakter olmalı" : null;
      if (sorun) {
        hatalar.push({ satir: i + 1, ad: ad || slug || "(boş)", hata: sorun });
        continue;
      }

      const { data: kafe, error: kafeHata } = await servis
        .from("cafe")
        .insert({
          ad,
          slug,
          zincir_id: zincirId,
          masa_duzeni: false, // self-servis şube: masa yok, numara var
          il: (r.il ?? "").trim() || null,
          ilce: (r.ilce ?? "").trim() || null,
          adres: (r.adres ?? "").trim() || null,
        })
        .select("id")
        .single();
      if (kafeHata || !kafe) {
        hatalar.push({
          satir: i + 1,
          ad,
          hata: kafeHata?.code === "23505" ? "Bu adres (slug) zaten kullanılıyor" : kafeHata?.message ?? "Kafe açılamadı",
        });
        continue;
      }

      const { data: hesap, error: hesapHata } = await servis.auth.admin.createUser({
        email: eposta,
        password: sifre,
        email_confirm: true,
      });
      if (hesapHata || !hesap.user) {
        await servis.from("cafe").delete().eq("id", kafe.id);
        hatalar.push({ satir: i + 1, ad, hata: hesapHata?.message ?? "Yönetici hesabı açılamadı" });
        continue;
      }
      const { error: kayitHata } = await servis.from("kullanici").insert({
        id: hesap.user.id,
        cafe_id: kafe.id,
        rol: "admin",
        ad: (r.adminAd ?? "").trim() || ad + " Yöneticisi",
      });
      if (kayitHata) {
        await servis.auth.admin.deleteUser(hesap.user.id);
        await servis.from("cafe").delete().eq("id", kafe.id);
        hatalar.push({ satir: i + 1, ad, hata: kayitHata.message });
        continue;
      }
      kurulan.push({ ad, slug });
    }

    // Şubeler kurulduysa zincir menüsünü hepsine uygula (ana şube seçiliyse)
    let menuNotu: string | null = null;
    if (kurulan.length) {
      const { error: senkronHata } = await servis.rpc("zincir_menu_senkronla", {
        p_zincir_id: zincirId,
      });
      menuNotu = senkronHata
        ? "Şubeler kuruldu ama menü uygulanamadı: " + senkronHata.message
        : "Zincir menüsü yeni şubelere uygulandı";
    }

    return NextResponse.json({ kurulan, hatalar, menuNotu });
  }

  // ---------------------------------------------------------------- yeni kafe
  if (govde.islem === "kafe") {
    const { ad, slug, zincirId, adminAd, adminEposta, adminSifre, il, ilce, adres } = govde;
    const bolumler: BolumIstek[] = Array.isArray(govde.bolumler) ? govde.bolumler : [];
    if (!ad?.trim()) return NextResponse.json({ hata: "Kafe adı gerekli" }, { status: 400 });
    if (!/^[a-z0-9-]+$/.test(slug ?? "")) {
      return NextResponse.json({ hata: "Adres yalnız küçük harf, rakam ve tire içerebilir" }, { status: 400 });
    }
    if (!adminAd?.trim()) return NextResponse.json({ hata: "Yönetici adı gerekli" }, { status: 400 });
    if (!adminEposta?.includes("@")) return NextResponse.json({ hata: "Geçerli bir yönetici e-postası gerekli" }, { status: 400 });
    if (!adminSifre || adminSifre.length < 8) {
      return NextResponse.json({ hata: "Yönetici şifresi en az 8 karakter olmalı" }, { status: 400 });
    }
    for (const b of bolumler) {
      if (!b?.ad?.trim() || !Number.isInteger(b.masaSayisi) || b.masaSayisi < 1 || b.masaSayisi > 200) {
        return NextResponse.json({ hata: "Her bölümün adı ve 1-200 arası masa sayısı olmalı" }, { status: 400 });
      }
    }

    const { data: kafe, error: kafeHata } = await servis
      .from("cafe")
      .insert({
        ad: ad.trim(),
        slug,
        zincir_id: zincirId ?? null,
        il: (il ?? "").trim() || null,
        ilce: (ilce ?? "").trim() || null,
        adres: (adres ?? "").trim() || null,
      })
      .select("id")
      .single();
    if (kafeHata || !kafe) {
      const mesaj = kafeHata?.code === "23505"
        ? "Bu adres (slug) zaten kullanılıyor"
        : kafeHata?.message ?? "Kafe oluşturulamadı";
      return NextResponse.json({ hata: mesaj }, { status: 400 });
    }

    // Hata durumunda kafeyi geri al (cascade bölüm/masaları da siler)
    async function geriAl(mesaj: string, kod: number) {
      await servis!.from("cafe").delete().eq("id", kafe!.id);
      return NextResponse.json({ hata: mesaj }, { status: kod });
    }

    for (const [i, b] of bolumler.entries()) {
      const { data: bolum, error: bolumHata } = await servis
        .from("bolum")
        .insert({ cafe_id: kafe.id, ad: b.ad.trim(), sira: i })
        .select("id")
        .single();
      if (bolumHata || !bolum) return geriAl(bolumHata?.message ?? "Bölüm oluşturulamadı", 400);
      const masalar = Array.from({ length: b.masaSayisi }, (_, n) => ({
        cafe_id: kafe.id,
        bolum_id: bolum.id,
        ad: `${b.ad.trim()} ${n + 1}`,
      }));
      const { error: masaHata } = await servis.from("masa").insert(masalar);
      if (masaHata) return geriAl(masaHata.message, 400);
    }

    const { data: hesap, error: hesapHata } = await servis.auth.admin.createUser({
      email: adminEposta.trim().toLowerCase(),
      password: adminSifre,
      email_confirm: true,
    });
    if (hesapHata || !hesap.user) {
      return geriAl(hesapHata?.message ?? "Yönetici hesabı açılamadı", 400);
    }
    const { error: kayitHata } = await servis.from("kullanici").insert({
      id: hesap.user.id,
      cafe_id: kafe.id,
      rol: "admin",
      ad: adminAd.trim(),
    });
    if (kayitHata) {
      await servis.auth.admin.deleteUser(hesap.user.id);
      return geriAl(kayitHata.message, 400);
    }

    return NextResponse.json({ cafeId: kafe.id, slug });
  }

  // ----------------------------------------------------------- franchise hesabı
  if (govde.islem === "franchise") {
    const { ad, eposta, sifre, zincirId } = govde;
    if (!ad?.trim()) return NextResponse.json({ hata: "İsim gerekli" }, { status: 400 });
    if (!eposta?.includes("@")) return NextResponse.json({ hata: "Geçerli bir e-posta gerekli" }, { status: 400 });
    if (!sifre || sifre.length < 8) return NextResponse.json({ hata: "Şifre en az 8 karakter olmalı" }, { status: 400 });
    if (!zincirId) return NextResponse.json({ hata: "Zincir seçimi gerekli" }, { status: 400 });

    const { data: zincir } = await servis.from("zincir").select("id").eq("id", zincirId).single();
    if (!zincir) return NextResponse.json({ hata: "Zincir bulunamadı" }, { status: 404 });

    const { data: hesap, error: hesapHata } = await servis.auth.admin.createUser({
      email: eposta.trim().toLowerCase(),
      password: sifre,
      email_confirm: true,
    });
    if (hesapHata || !hesap.user) {
      return NextResponse.json({ hata: hesapHata?.message ?? "Hesap açılamadı" }, { status: 400 });
    }
    const { error: kayitHata } = await servis.from("kullanici").insert({
      id: hesap.user.id,
      rol: "franchise",
      zincir_id: zincirId,
      ad: ad.trim(),
    });
    if (kayitHata) {
      await servis.auth.admin.deleteUser(hesap.user.id);
      return NextResponse.json({ hata: kayitHata.message }, { status: 400 });
    }
    return NextResponse.json({ id: hesap.user.id });
  }

  return NextResponse.json({ hata: "Geçersiz işlem" }, { status: 400 });
}
