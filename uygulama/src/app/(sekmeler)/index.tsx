import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Ikon } from "@/components/Ikon";
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSepet, type Kafe } from "@/lib/sepet";
import { supabase } from "@/lib/supabase";
import { renk } from "@/lib/tema";
import { tl, type MusteriOzet } from "@/lib/tipler";

interface KampanyaUrun {
  id: string;
  ad: string;
  fiyat: number;
  gorsel_url: string | null;
  cafe_id: string;
}

// Ana Sayfa: selamlama + tek cüzdan puan kartı + kampanyalar + son hareketler.
// Tek cüzdan (Faz 7): puan tüm SofraKur kafelerinde kazanılır ve harcanır;
// 1 TL = 1 puan, 10 puan = 1 TL. Harcama sepette otomatik — QR/kod göstermek yok.
export default function AnaSayfa() {
  const router = useRouter();
  const { kafeler, kafeSec } = useSepet();
  const [ozet, setOzet] = useState<MusteriOzet | null>(null);
  const [kampanyalar, setKampanyalar] = useState<KampanyaUrun[]>([]);
  const [yenileniyor, setYenileniyor] = useState(false);

  const yukle = useCallback(async () => {
    const [ozetC, kampC] = await Promise.all([
      supabase.rpc("musteri_ozet"),
      supabase
        .from("urun")
        .select("id, ad, fiyat, gorsel_url, cafe_id")
        .eq("kampanya", true)
        .eq("aktif", true)
        .order("sira")
        .limit(20),
    ]);
    if (!ozetC.error) setOzet(ozetC.data as MusteriOzet);
    setKampanyalar((kampC.data as KampanyaUrun[]) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      yukle();
    }, [yukle])
  );

  async function elleYenile() {
    setYenileniyor(true);
    await yukle();
    setYenileniyor(false);
  }

  const kafeAd = (id: string) => kafeler.find((k) => k.id === id)?.ad ?? "";
  const toplamPuan =
    ozet?.puan_bakiye ?? ozet?.hesaplar?.reduce((t, h) => t + h.puan_bakiye, 0) ?? 0;
  const tlKarsiligi = ozet?.tl_karsiligi ?? toplamPuan / 10;

  // Kampanyaya dokununca o kafenin menüsü açılır
  function kampanyaAc(k: KampanyaUrun) {
    const kafe: Kafe | undefined = kafeler.find((x) => x.id === k.cafe_id);
    if (kafe) {
      kafeSec(kafe);
      router.push("/kafeler");
    }
  }

  return (
    <SafeAreaView style={s.guvenli} edges={["top"]}>
      <ScrollView
        contentContainerStyle={s.icerik}
        refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={elleYenile} />}
      >
        <Text style={s.selam}>Merhaba{ozet?.ad ? `, ${ozet.ad.split(" ")[0]}` : ""}</Text>

        {/* Tek cüzdan puan kartı */}
        <LinearGradient
          colors={["#c86f2c", "#8a4b1f"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.puanKart}
        >
          <View style={{ flex: 1 }}>
            <Text style={s.puanEtiket}>PUANIN</Text>
            <Text style={s.puan}>{toplamPuan}</Text>
            <Text style={s.puanAlt}>= {tl(tlKarsiligi)} indirim değeri</Text>
          </View>
          <View style={s.kuralKutu}>
            <Text style={s.kuralYazi}>1 ₺ = 1 puan</Text>
            <Text style={s.kuralYazi}>10 puan = 1 ₺</Text>
            <Text style={s.kuralAlt}>tüm kafelerde geçer</Text>
          </View>
        </LinearGradient>
        <Text style={s.puanIpucu}>
          Puanlar siparişin teslim edilince kendiliğinden birikir; sepette
          &quot;Puan kullan&quot; ile indirime dönüşür.
        </Text>

        {/* Kampanyalar */}
        <View style={s.bolumSatir}>
          <Ikon ad="kampanya" boyut={17} />
          <Text style={s.bolum}>Kampanyalar</Text>
        </View>
        {kampanyalar.length === 0 ? (
          <Text style={s.bos}>Şu an aktif kampanya yok — yenileri burada görünecek.</Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingBottom: 4 }}
          >
            {kampanyalar.map((k) => (
              <Pressable key={k.id} onPress={() => kampanyaAc(k)} style={s.kampKart}>
                {k.gorsel_url ? (
                  <Image source={{ uri: k.gorsel_url }} style={s.kampFoto} />
                ) : (
                  <LinearGradient
                    colors={["#c86f2c", "#8a4b1f"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[s.kampFoto, s.kampFotoYok]}
                  >
                    <Ikon ad="elmas" boyut={44} renk="rgba(255,255,255,0.92)" kalinlik={1.2} />
                  </LinearGradient>
                )}
                <View style={{ padding: 10 }}>
                  <Text style={s.kampAd} numberOfLines={1}>
                    {k.ad}
                  </Text>
                  <Text style={s.kampKafe} numberOfLines={1}>
                    {kafeAd(k.cafe_id)}
                  </Text>
                  <Text style={s.kampFiyat}>{tl(Number(k.fiyat))}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* Son hareketler */}
        {ozet && ozet.hareketler.length > 0 && (
          <>
            <Text style={s.hareketBaslik}>SON HAREKETLER</Text>
            {ozet.hareketler.slice(0, 5).map((h, i) => (
              <View key={i} style={s.hareket}>
                <View style={{ flex: 1 }}>
                  <Text style={s.hareketAd}>{h.cafe_ad}</Text>
                  <Text style={s.hareketAciklama}>
                    {h.aciklama ?? h.tur} ·{" "}
                    {new Date(h.tarih).toLocaleDateString("tr-TR", {
                      day: "numeric",
                      month: "short",
                    })}
                  </Text>
                </View>
                <Text style={[s.hareketPuan, h.puan < 0 && s.eksiPuan]}>
                  {h.puan > 0 ? "+" : ""}
                  {h.puan}
                </Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  guvenli: { flex: 1, backgroundColor: renk.krem },
  icerik: { padding: 18, paddingBottom: 32 },
  selam: { fontSize: 24, fontWeight: "800", color: renk.metinBaslik },
  puanKart: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 20,
    padding: 18,
  },
  bolumSatir: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 22, marginBottom: 10 },
  puanEtiket: { color: "rgba(255,255,255,0.75)", fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  puan: { color: "#fff", fontSize: 34, fontWeight: "800", marginTop: 2 },
  puanAlt: { color: "rgba(255,255,255,0.85)", fontSize: 12.5, fontWeight: "600", marginTop: 4 },
  kuralKutu: {
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: "center",
    gap: 2,
  },
  kuralYazi: { color: "#fff", fontSize: 13, fontWeight: "800" },
  kuralAlt: { color: "rgba(255,255,255,0.75)", fontSize: 10.5, fontWeight: "600", marginTop: 2 },
  puanIpucu: { marginTop: 8, fontSize: 12, lineHeight: 17, color: renk.metinSoluk },
  bolum: { fontSize: 16, fontWeight: "800", color: renk.metinBaslik },
  hareketBaslik: {
    marginTop: 22,
    marginBottom: 6,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: renk.metinSoluk,
  },
  bos: { fontSize: 13, color: renk.metinSoluk, lineHeight: 19, marginBottom: 4 },
  kampKart: {
    width: 180,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e8b57f",
    backgroundColor: renk.kart,
    overflow: "hidden",
  },
  kampFoto: { width: "100%", height: 92 },
  kampFotoYok: { backgroundColor: renk.marka, alignItems: "center", justifyContent: "center" },
  kampAd: { fontSize: 13.5, fontWeight: "700", color: renk.metinBaslik },
  kampKafe: { marginTop: 1, fontSize: 11.5, color: renk.metinSoluk },
  kampFiyat: { marginTop: 3, fontSize: 13.5, fontWeight: "800", color: renk.markaKoyu },
  hareket: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: renk.cizgi,
  },
  hareketAd: { fontSize: 13.5, fontWeight: "700", color: renk.metin },
  hareketAciklama: { fontSize: 12, color: renk.metinSoluk, marginTop: 1 },
  hareketPuan: { fontSize: 15, fontWeight: "800", color: renk.basari },
  eksiPuan: { color: renk.tehlike },
});
