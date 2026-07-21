import { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ikon } from "@/components/Ikon";
import { pushKaydiSil } from "@/lib/bildirim";
import { useOturum } from "@/lib/oturum";
import { supabase } from "@/lib/supabase";
import { renk } from "@/lib/tema";
import type { MusteriKayit } from "@/lib/tipler";

export default function HesabimEkrani() {
  const { oturum } = useOturum();
  const [kayit, setKayit] = useState<MusteriKayit | null>(null);
  const [siliniyor, setSiliniyor] = useState(false);

  useEffect(() => {
    supabase.rpc("musteri_kayit").then(({ data }) => {
      if (data) setKayit(data as MusteriKayit);
    });
  }, []);

  function cikisSor() {
    Alert.alert("Çıkış", "Hesaptan çıkmak istediğine emin misin?", [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Çıkış Yap",
        style: "destructive",
        onPress: async () => {
          await pushKaydiSil(); // bu cihaza artık bildirim gitmesin
          supabase.auth.signOut();
        },
      },
    ]);
  }

  // App Store 5.1.1: hesap uygulama içinden kalıcı silinebilmeli.
  // Üyelik + puanlar + cihaz kaydı geri alınamaz şekilde silinir.
  function hesapSilSor() {
    Alert.alert(
      "Hesabı kalıcı sil",
      "Üyeliğin, puanların ve tüm verilerin geri alınamaz şekilde silinecek. Emin misin?",
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Evet, hesabımı sil",
          style: "destructive",
          onPress: hesapSil,
        },
      ]
    );
  }

  async function hesapSil() {
    if (siliniyor || !oturum) return;
    setSiliniyor(true);
    try {
      const cevap = await fetch("https://sofrakur.com/api/musteri/hesap-sil", {
        method: "POST",
        headers: { Authorization: `Bearer ${oturum.access_token}` },
      });
      const veri = await cevap.json();
      if (!cevap.ok) {
        Alert.alert("Silinemedi", veri.hata ?? "Bir sorun oluştu, tekrar dene.");
        return;
      }
      Alert.alert("Hesabın silindi", "Bizi tercih ettiğin için teşekkürler.");
      supabase.auth.signOut();
    } catch {
      Alert.alert("Silinemedi", "İnternet bağlantını kontrol edip tekrar dene.");
    } finally {
      setSiliniyor(false);
    }
  }

  return (
    <SafeAreaView style={s.guvenli} edges={["top"]}>
      <ScrollView contentContainerStyle={s.icerik}>
        <Text style={s.baslik}>Hesabım</Text>

        <View style={s.kart}>
          <Text style={s.etiket}>AD</Text>
          <Text style={s.deger}>{kayit?.ad ?? "—"}</Text>
          <Text style={[s.etiket, { marginTop: 14 }]}>E-POSTA</Text>
          <Text style={s.deger}>{oturum?.user.email ?? "—"}</Text>
          <Text style={[s.etiket, { marginTop: 14 }]}>MÜŞTERİ KODU</Text>
          <Text style={[s.deger, s.kod]}>{kayit?.musteri_kod ?? "—"}</Text>
        </View>

        {/* Kayıtlı kartlar: PSP anlaşması yapılınca aktifleşecek */}
        <View style={s.kartlar}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <Ikon ad="kart" boyut={16} />
            <Text style={s.kartlarBaslik}>Kayıtlı Kartlarım</Text>
          </View>
          <Text style={s.kartlarYazi}>
            Çok yakında: kartını güvenle kaydet, siparişini uygulamadan öde.
          </Text>
        </View>

        <Pressable onPress={cikisSor} style={s.cikis}>
          <Text style={s.cikisYazi}>Çıkış Yap</Text>
        </Pressable>

        <Pressable onPress={hesapSilSor} disabled={siliniyor} style={s.hesapSil}>
          <Text style={s.hesapSilYazi}>
            {siliniyor ? "Siliniyor…" : "Hesabı Kalıcı Sil"}
          </Text>
        </Pressable>

        <Text style={s.dipnot}>Gizlilik politikası: sofrakur.com/gizlilik</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  guvenli: { flex: 1, backgroundColor: renk.krem },
  icerik: { padding: 20, paddingBottom: 40 },
  baslik: { fontSize: 26, fontWeight: "800", color: renk.metinBaslik },
  kart: {
    marginTop: 16,
    backgroundColor: renk.kart,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: renk.cizgi,
    padding: 18,
  },
  etiket: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: renk.metinSoluk,
  },
  deger: { marginTop: 3, fontSize: 16, fontWeight: "700", color: renk.metinBaslik },
  kod: { color: renk.marka, letterSpacing: 3 },
  kartlar: {
    marginTop: 14,
    backgroundColor: renk.kart,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: renk.cizgi,
    padding: 18,
    opacity: 0.75,
  },
  kartlarBaslik: { fontSize: 15, fontWeight: "800", color: renk.metinBaslik },
  kartlarYazi: { marginTop: 5, fontSize: 13, lineHeight: 19, color: renk.metinSoluk },
  cikis: {
    marginTop: 20,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: renk.tehlike,
    paddingVertical: 14,
    alignItems: "center",
  },
  cikisYazi: { fontSize: 15, fontWeight: "800", color: renk.tehlike },
  hesapSil: { marginTop: 12, paddingVertical: 10, alignItems: "center" },
  hesapSilYazi: {
    fontSize: 13,
    fontWeight: "700",
    color: renk.metinSoluk,
    textDecorationLine: "underline",
  },
  dipnot: {
    marginTop: 24,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    color: renk.metinSoluk,
  },
});
