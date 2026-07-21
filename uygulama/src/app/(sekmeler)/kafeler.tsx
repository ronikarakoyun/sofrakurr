import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ikon } from "@/components/Ikon";
import { UrunDetay } from "@/components/UrunDetay";
import { useSepet } from "@/lib/sepet";
import { supabase } from "@/lib/supabase";
import { renk } from "@/lib/tema";
import { kalemBirimFiyat, tl, type Urun } from "@/lib/tipler";

interface MasaSatiri {
  bolum: string;
  masa_id: string;
  masa_ad: string;
  dolu: boolean;
}

// Kafeler: kafe listesi → masa seçimi (tasarımdaki bölümlü harita) → menü.
// Kamera/QR yok; masa manuel seçilir, "önce ödeme" akışı riski karşılar.
export default function KafelerEkrani() {
  const router = useRouter();
  const {
    kafeler,
    seciliKafe,
    oturum,
    menu,
    sepet,
    menuYukleniyor,
    kafeSec,
    masaSec,
    masaBirak,
    sepeteEkle,
  } = useSepet();

  const [aktifKat, setAktifKat] = useState("Tümü");
  const [seciliUrun, setSeciliUrun] = useState<Urun | null>(null);
  const [masalar, setMasalar] = useState<MasaSatiri[] | null>(null);
  const [secilen, setSecilen] = useState<string | null>(null); // masa_id (seçim animasyonu)
  const [kafeArama, setKafeArama] = useState("");

  const sepetAdet = sepet.reduce((t, k) => t + k.adet, 0);
  const sepetToplam = sepet.reduce((t, k) => t + kalemBirimFiyat(k) * k.adet, 0);
  const kampanyalar = useMemo(() => menu.flatMap((k) => k.urun).filter((u) => u.kampanya), [menu]);

  const masalariYukle = useCallback(async () => {
    if (!seciliKafe) return;
    const { data } = await supabase.rpc("masa_durumlari", { p_cafe_id: seciliKafe.id });
    setMasalar((data as MasaSatiri[]) ?? []);
  }, [seciliKafe]);

  useFocusEffect(
    useCallback(() => {
      if (seciliKafe && seciliKafe.masa_duzeni && !oturum) masalariYukle();
    }, [seciliKafe, oturum, masalariYukle])
  );

  async function masayaOtur(m: MasaSatiri) {
    const otur = async () => {
      setSecilen(m.masa_id);
      const hata = await masaSec(m.masa_id);
      setSecilen(null);
      if (hata) Alert.alert("Olmadı", hata);
      else setAktifKat("Tümü");
    };
    if (m.dolu) {
      // Dolu masada oturan müşteri ek sipariş verebilmeli; yanlış masa
      // seçimini onay sorusu engeller.
      Alert.alert(
        "Bu masada açık hesap var",
        `${m.masa_ad} şu an dolu görünüyor. Bu masada sen oturuyorsan devam et.`,
        [
          { text: "Vazgeç", style: "cancel" },
          { text: "Bu masadayım", onPress: otur },
        ]
      );
    } else {
      otur();
    }
  }

  // ── 1) Kafe listesi (arama + il grupları) ──
  if (!seciliKafe) {
    const q = kafeArama.trim().toLocaleLowerCase("tr");
    const suzulmus = q
      ? kafeler.filter((k) =>
          [k.ad, k.il, k.ilce].some((x) => (x ?? "").toLocaleLowerCase("tr").includes(q))
        )
      : kafeler;
    // İl bazlı gruplar; ili girilmemiş şubeler sonda "Diğer" altında
    const iller = [...new Set(suzulmus.map((k) => k.il?.trim() || ""))].sort((a, b) =>
      a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "tr")
    );

    return (
      <SafeAreaView style={s.guvenli} edges={["top"]}>
        <ScrollView contentContainerStyle={s.icerik} keyboardShouldPersistTaps="handled">
          <Text style={s.baslik}>Kafeler</Text>
          <Text style={s.altYazi}>SofraKur&apos;a bağlı kafeler — dokun, menüsüne bak.</Text>

          {kafeler.length > 5 && (
            <TextInput
              value={kafeArama}
              onChangeText={setKafeArama}
              placeholder="Şube veya semt ara…"
              placeholderTextColor={renk.metinSilik}
              style={s.arama}
            />
          )}

          {iller.map((il) => {
            const grup = suzulmus.filter((k) => (k.il?.trim() || "") === il);
            return (
              <View key={il || "diger"} style={{ marginTop: 14 }}>
                {iller.length > 1 && (
                  <Text style={s.ilBaslik}>{il || "Diğer"}</Text>
                )}
                <View style={{ gap: 12 }}>
                  {grup.map((k) => (
                    <Pressable
                      key={k.id}
                      onPress={() => {
                        setMasalar(null);
                        kafeSec(k);
                      }}
                      style={s.kafeKart}
                    >
                      <View style={s.kafeLogo}>
                        <Ikon ad="kahve" boyut={26} kalinlik={1.7} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.kafeAd}>{k.ad}</Text>
                        <Text style={s.kafeAlt}>
                          {k.ilce ? `${k.ilce} · ` : ""}
                          {k.masa_duzeni ? "Menüyü gör · Sipariş ver" : "Self-servis · Tezgahtan teslim"}
                        </Text>
                      </View>
                      <Text style={s.ok}>›</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })}

          {kafeler.length === 0 && <Text style={s.altYazi}>Kafeler yükleniyor…</Text>}
          {kafeler.length > 0 && suzulmus.length === 0 && (
            <Text style={s.altYazi}>&quot;{kafeArama}&quot; ile eşleşen şube yok.</Text>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── 2) Masa seçimi (yalnız masalı kafede; self-servis direkt menüye geçer) ──
  if (seciliKafe.masa_duzeni && !oturum) {
    const bolumler = [...new Set((masalar ?? []).map((m) => m.bolum))];
    return (
      <SafeAreaView style={s.guvenli} edges={["top"]}>
        <View style={s.ustBar}>
          <Pressable onPress={() => kafeSec(null)} style={s.geri}>
            <Text style={s.geriYazi}>←</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.kafeBaslik}>{seciliKafe.ad}</Text>
            <Text style={s.masaDurum}>Masanı seç — menü hemen açılır</Text>
          </View>
        </View>

        {/* Lejant */}
        <View style={s.lejant}>
          <View style={s.lejantOge}>
            <View style={[s.lejantKutu, { backgroundColor: "#fff", borderWidth: 1.5, borderColor: renk.cizgiKoyu }]} />
            <Text style={s.lejantYazi}>Boş</Text>
          </View>
          <View style={s.lejantOge}>
            <View style={[s.lejantKutu, { backgroundColor: renk.cizgiKoyu }]} />
            <Text style={s.lejantYazi}>Dolu</Text>
          </View>
          <View style={s.lejantOge}>
            <LinearGradient colors={["#c86f2c", "#8a4b1f"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.lejantKutu} />
            <Text style={s.lejantYazi}>Seçili</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 120 }}>
          {masalar === null && <Text style={s.altYazi}>Masalar yükleniyor…</Text>}
          {masalar !== null && masalar.length === 0 && (
            <Text style={s.altYazi}>
              Masalar şu an listelenemiyor — internetini kontrol edip aşağı çekerek yenile.
            </Text>
          )}
          {bolumler.map((b) => (
            <View key={b} style={{ marginTop: 14 }}>
              <Text style={s.bolumBaslik}>{b}</Text>
              <View style={s.masaIzgara}>
                {(masalar ?? [])
                  .filter((m) => m.bolum === b)
                  .map((m) =>
                    secilen === m.masa_id ? (
                      <LinearGradient
                        key={m.masa_id}
                        colors={["#c86f2c", "#8a4b1f"]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={[s.masaKutu, { borderWidth: 0 }]}
                      >
                        <Text style={[s.masaAd, { color: "#fff" }]}>{m.masa_ad}</Text>
                        <Text style={[s.masaAltYazi, { color: "rgba(255,255,255,0.85)" }]}>Seçiliyor…</Text>
                      </LinearGradient>
                    ) : (
                      <Pressable
                        key={m.masa_id}
                        onPress={() => masayaOtur(m)}
                        style={[s.masaKutu, m.dolu && s.masaDoluKutu]}
                      >
                        <Text style={[s.masaAd, m.dolu && { color: renk.metinSoluk }]}>{m.masa_ad}</Text>
                        <Text style={s.masaAltYazi}>{m.dolu ? "Dolu" : "Boş"}</Text>
                      </Pressable>
                    )
                  )}
              </View>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── 3) Kafe menüsü ──
  const kategoriAdlari = ["Tümü", ...menu.map((k) => k.ad)];
  const gosterilecek = menu.filter((k) => aktifKat === "Tümü" || k.ad === aktifKat);

  return (
    <SafeAreaView style={s.guvenli} edges={["top"]}>
      <View style={s.ustBar}>
        <Pressable onPress={() => { kafeSec(null); setAktifKat("Tümü"); }} style={s.geri}>
          <Text style={s.geriYazi}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.kafeBaslik}>{seciliKafe.ad}</Text>
          {oturum ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 1 }}>
              <Text style={s.masaEtiket}>Masa: {oturum.masa_ad}</Text>
              <Pressable onPress={masaBirak}>
                <Text style={s.masaDegistir}>Değiştir</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={s.masaEtiket}>Self-servis · Siparişini tezgahtan al</Text>
          )}
        </View>
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.katSerit}>
          {kategoriAdlari.map((ad) => (
            <Pressable
              key={ad}
              onPress={() => setAktifKat(ad)}
              style={[s.katCip, ad === aktifKat && s.katCipAktif]}
            >
              <Text style={[s.katYazi, ad === aktifKat && s.katYaziAktif]}>{ad}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={s.liste}>
        {menuYukleniyor && <Text style={s.altYazi}>Menü yükleniyor…</Text>}

        {aktifKat === "Tümü" && kampanyalar.length > 0 && (
          <>
            <View style={s.bolumSatir}>
              <Ikon ad="kampanya" boyut={17} />
              <Text style={s.katBaslik}>Kampanyalar</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
              {kampanyalar.map((u) => (
                <Pressable key={u.id} onPress={() => setSeciliUrun(u)} style={s.kampKart}>
                  {u.gorsel_url ? (
                    <Image source={{ uri: u.gorsel_url }} style={s.kampFoto} />
                  ) : (
                    <LinearGradient colors={["#c86f2c", "#8a4b1f"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.kampFoto, s.orta]}>
                      <Ikon ad="elmas" boyut={44} renk="rgba(255,255,255,0.92)" kalinlik={1.2} />
                    </LinearGradient>
                  )}
                  <View style={{ padding: 10 }}>
                    <Text style={s.kampAd} numberOfLines={1}>{u.ad}</Text>
                    <Text style={s.kampFiyat}>{tl(Number(u.fiyat))}</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {gosterilecek.map((kat) => (
          <View key={kat.id} style={{ marginTop: 12 }}>
            <Text style={s.katBaslik}>{kat.ad}</Text>
            <View style={{ gap: 8 }}>
              {kat.urun.map((u) => (
                <Pressable key={u.id} onPress={() => setSeciliUrun(u)} style={s.urun}>
                  {u.gorsel_url ? (
                    <Image source={{ uri: u.gorsel_url }} style={s.urunFoto} />
                  ) : (
                    <View style={[s.urunFoto, s.orta, { backgroundColor: renk.kremKoyu }]}>
                      <Ikon ad="kahve" boyut={24} kalinlik={1.7} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={s.urunAd}>{u.ad}</Text>
                    <Text style={s.urunFiyat}>{tl(Number(u.fiyat))}</Text>
                  </View>
                  <LinearGradient colors={["#c86f2c", "#8a4b1f"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.arti, s.orta]}>
                    <Text style={s.artiYazi}>+</Text>
                  </LinearGradient>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        <View style={{ height: 96 }} />
      </ScrollView>

      {sepetAdet > 0 && (
        <SafeAreaView edges={["bottom"]} style={s.sepetBarKap}>
          <Pressable onPress={() => router.push("/sepetim")}>
            <LinearGradient colors={["#c86f2c", "#8a4b1f"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.sepetBar}>
              <Text style={s.sepetBarYazi}>Sepetim · {sepetAdet} ürün</Text>
              <Text style={s.sepetBarTutar}>{tl(sepetToplam)}</Text>
            </LinearGradient>
          </Pressable>
        </SafeAreaView>
      )}

      <UrunDetay urun={seciliUrun} kapat={() => setSeciliUrun(null)} ekle={sepeteEkle} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  guvenli: { flex: 1, backgroundColor: renk.krem },
  icerik: { padding: 18, paddingBottom: 32 },
  orta: { alignItems: "center", justifyContent: "center" },
  baslik: { fontSize: 24, fontWeight: "800", color: renk.metinBaslik },
  altYazi: { marginTop: 6, fontSize: 13.5, color: renk.metinSoluk, lineHeight: 20 },
  kafeKart: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: renk.kart,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: renk.cizgi,
    padding: 16,
  },
  kafeLogo: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: renk.kremKoyu,
    alignItems: "center",
    justifyContent: "center",
  },
  kafeAd: { fontSize: 17, fontWeight: "800", color: renk.metinBaslik },
  kafeAlt: { marginTop: 2, fontSize: 12.5, color: renk.metinSoluk },
  arama: {
    marginTop: 12,
    backgroundColor: renk.kart,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: renk.cizgiKoyu,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14.5,
    color: renk.metin,
  },
  ilBaslik: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: renk.metinSoluk,
    marginBottom: 8,
  },
  ok: { fontSize: 26, color: renk.metinSilik, marginTop: -2 },
  ustBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 8,
  },
  geri: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: renk.kart,
    borderWidth: 1,
    borderColor: renk.cizgiKoyu,
    alignItems: "center",
    justifyContent: "center",
  },
  geriYazi: { fontSize: 19, color: renk.markaKoyu, marginTop: -2 },
  kafeBaslik: { fontSize: 19, fontWeight: "800", color: renk.metinBaslik },
  masaDurum: { marginTop: 1, fontSize: 12, fontWeight: "600", color: renk.metinSoluk },
  masaEtiket: { fontSize: 12, fontWeight: "700", color: renk.marka },
  masaDegistir: { fontSize: 12, fontWeight: "700", color: renk.metinSoluk, textDecorationLine: "underline" },
  lejant: { flexDirection: "row", gap: 14, paddingHorizontal: 18, paddingVertical: 6 },
  lejantOge: { flexDirection: "row", alignItems: "center", gap: 6 },
  lejantKutu: { width: 12, height: 12, borderRadius: 4 },
  lejantYazi: { fontSize: 11.5, fontWeight: "700", color: renk.metinOrta },
  bolumBaslik: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: renk.metinSoluk,
    marginBottom: 8,
  },
  masaIzgara: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  masaKutu: {
    width: "31%",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: renk.cizgiKoyu,
    backgroundColor: "#fff",
    paddingVertical: 13,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  masaDoluKutu: { backgroundColor: renk.cizgiKoyu },
  masaAd: { fontSize: 14, fontWeight: "800", color: renk.metin },
  masaAltYazi: { marginTop: 2, fontSize: 11, fontWeight: "600", color: renk.metinSoluk },
  katSerit: { gap: 8, paddingHorizontal: 14, paddingBottom: 8 },
  katCip: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: renk.cizgiKoyu,
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  katCipAktif: { backgroundColor: renk.marka, borderColor: renk.marka },
  katYazi: { fontSize: 12.5, fontWeight: "700", color: renk.metinOrta },
  katYaziAktif: { color: "#fff" },
  liste: { paddingHorizontal: 14, paddingTop: 2 },
  bolumSatir: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 4, marginBottom: 8 },
  katBaslik: { fontSize: 17, fontWeight: "700", color: renk.metinBaslik, marginBottom: 8, marginTop: 4 },
  urun: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: renk.kart,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: renk.cizgi,
    padding: 9,
  },
  urunFoto: { width: 50, height: 50, borderRadius: 11 },
  urunAd: { fontSize: 14.5, fontWeight: "700", color: renk.metinBaslik },
  urunFiyat: { marginTop: 3, fontSize: 13.5, fontWeight: "800", color: "#6f3a15" },
  arti: { width: 30, height: 30, borderRadius: 15 },
  artiYazi: { color: "#fff", fontSize: 18, fontWeight: "600", marginTop: -1 },
  kampKart: {
    width: 180,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e8b57f",
    backgroundColor: renk.kart,
    overflow: "hidden",
  },
  kampFoto: { width: "100%", height: 92 },
  kampAd: { fontSize: 13.5, fontWeight: "700", color: renk.metinBaslik },
  kampFiyat: { marginTop: 3, fontSize: 13.5, fontWeight: "800", color: "#6f3a15" },
  sepetBarKap: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 14 },
  sepetBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 15,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 6,
  },
  sepetBarYazi: { color: "#fff", fontSize: 14.5, fontWeight: "700" },
  sepetBarTutar: { color: "#fff", fontSize: 14.5, fontWeight: "800" },
});
