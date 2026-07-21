import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Ikon } from "@/components/Ikon";
import {
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
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

interface Odul {
  id: string;
  ad: string;
  puan_bedeli: number;
}

// Ana Sayfa: selamlama + puan kartı (kasada gösterilecek QR) + kampanyalar + ödüller
export default function AnaSayfa() {
  const router = useRouter();
  const { kafeler, kafeSec } = useSepet();
  const [ozet, setOzet] = useState<MusteriOzet | null>(null);
  const [kampanyalar, setKampanyalar] = useState<KampanyaUrun[]>([]);
  const [oduller, setOduller] = useState<Odul[]>([]);
  const [qrAcik, setQrAcik] = useState(false);
  const [yenileniyor, setYenileniyor] = useState(false);

  const yukle = useCallback(async () => {
    const [ozetC, kampC, odulC] = await Promise.all([
      supabase.rpc("musteri_ozet"),
      supabase
        .from("urun")
        .select("id, ad, fiyat, gorsel_url, cafe_id")
        .eq("kampanya", true)
        .eq("aktif", true)
        .order("sira")
        .limit(20),
      supabase.from("odul").select("id, ad, puan_bedeli").eq("aktif", true).order("puan_bedeli"),
    ]);
    if (!ozetC.error) setOzet(ozetC.data as MusteriOzet);
    setKampanyalar((kampC.data as KampanyaUrun[]) ?? []);
    setOduller((odulC.data as Odul[]) ?? []);
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
  const toplamPuan = ozet?.hesaplar.reduce((t, h) => t + h.puan_bakiye, 0) ?? 0;

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

        {/* Puan kartı */}
        <Pressable onPress={() => setQrAcik(true)}>
          <LinearGradient
            colors={["#c86f2c", "#8a4b1f"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.puanKart}
          >
          <View style={{ flex: 1 }}>
            <Text style={s.puanEtiket}>PUANIN</Text>
            <Text style={s.puan}>{toplamPuan}</Text>
            <Text style={s.puanAlt}>Kasada göstermek için dokun</Text>
          </View>
          {ozet?.musteri_kod ? (
            <View style={s.miniQr}>
              <QRCode value={ozet.musteri_kod} size={64} />
            </View>
          ) : null}
          </LinearGradient>
        </Pressable>

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

        {/* Ödüller */}
        {oduller.length > 0 && (
          <>
            <View style={s.bolumSatir}>
              <Ikon ad="hediye" boyut={17} />
              <Text style={s.bolum}>Ödüller</Text>
            </View>
            {oduller.map((o) => (
              <View key={o.id} style={s.odul}>
                <Text style={s.odulAd}>{o.ad}</Text>
                <Text style={s.odulBedel}>{o.puan_bedeli} puan</Text>
              </View>
            ))}
            <Text style={s.bos}>Ödül almak için kasada QR&apos;ını göstermen yeterli.</Text>
          </>
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

      {/* Büyük QR modalı */}
      <Modal visible={qrAcik} transparent animationType="fade" onRequestClose={() => setQrAcik(false)}>
        <Pressable style={s.qrPerde} onPress={() => setQrAcik(false)}>
          <View style={s.qrKutu}>
            <Text style={s.qrBaslik}>Kasada bu kodu göster</Text>
            {ozet?.musteri_kod ? (
              <>
                <View style={s.qrCerceve}>
                  <QRCode value={ozet.musteri_kod} size={200} />
                </View>
                <Text style={s.qrKod}>{ozet.musteri_kod}</Text>
              </>
            ) : (
              <Text style={s.bos}>Yükleniyor…</Text>
            )}
            <Text style={s.qrAlt}>Ödeme sırasında okutulur, puanın otomatik işlenir.</Text>
          </View>
        </Pressable>
      </Modal>
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
  miniQr: { backgroundColor: "#fff", borderRadius: 12, padding: 8 },
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
  odul: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: renk.kart,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: renk.cizgi,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  odulAd: { fontSize: 14.5, fontWeight: "700", color: renk.metinBaslik },
  odulBedel: { fontSize: 14, fontWeight: "800", color: renk.marka },
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
  qrPerde: {
    flex: 1,
    backgroundColor: "rgba(43,28,16,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  qrKutu: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: renk.kart,
    borderRadius: 24,
    alignItems: "center",
    padding: 24,
  },
  qrBaslik: { fontSize: 15, fontWeight: "800", color: renk.metinBaslik },
  qrCerceve: { marginTop: 16, backgroundColor: "#fff", borderRadius: 14, padding: 12 },
  qrKod: {
    marginTop: 12,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 4,
    color: renk.marka,
  },
  qrAlt: { marginTop: 8, fontSize: 12.5, color: renk.metinSoluk, textAlign: "center" },
});
