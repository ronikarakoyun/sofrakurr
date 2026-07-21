import {
  GoogleSignin,
  isSuccessResponse,
} from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useOturum } from "@/lib/oturum";
import { supabase } from "@/lib/supabase";
import { renk } from "@/lib/tema";
import type { MusteriKayit } from "@/lib/tipler";

// Google web client ID — Supabase Auth'taki Google sağlayıcısıyla aynı olmalı.
// Kafe sahibi Google Cloud'da OAuth istemcilerini açınca .env'e eklenir.
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";

if (GOOGLE_WEB_CLIENT_ID) {
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
}

export default function GirisEkrani() {
  const router = useRouter();
  const { oturum, yukleniyor } = useOturum();
  const [bekliyor, setBekliyor] = useState(false);
  const [appleVar, setAppleVar] = useState(false);

  useEffect(() => {
    if (Platform.OS === "ios") {
      AppleAuthentication.isAvailableAsync().then(setAppleVar);
    }
  }, []);

  if (!yukleniyor && oturum) return <Redirect href="/" />;

  // Girişten sonra müşteri kaydını aç; personel hesabıysa uygulamaya alma
  async function kayitVeGec() {
    const { data, error } = await supabase.rpc("musteri_kayit");
    if (error) {
      Alert.alert("Hata", "Kayıt tamamlanamadı: " + error.message);
      await supabase.auth.signOut();
      return;
    }
    const kayit = data as MusteriKayit;
    if (kayit.rol !== "musteri") {
      Alert.alert(
        "Personel hesabı",
        "Bu uygulama müşteriler içindir. Personel ekranları için sofrakur.com'u kullanın."
      );
      await supabase.auth.signOut();
      return;
    }
    router.replace("/");
  }

  async function googleGiris() {
    if (!GOOGLE_WEB_CLIENT_ID) {
      Alert.alert("Hazır değil", "Google girişi henüz yapılandırılmadı.");
      return;
    }
    if (bekliyor) return;
    setBekliyor(true);
    try {
      await GoogleSignin.hasPlayServices();
      const cevap = await GoogleSignin.signIn();
      if (!isSuccessResponse(cevap) || !cevap.data.idToken) {
        setBekliyor(false);
        return; // kullanıcı vazgeçti
      }
      const { error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: cevap.data.idToken,
      });
      if (error) throw error;
      await kayitVeGec();
    } catch (h) {
      Alert.alert("Giriş başarısız", h instanceof Error ? h.message : "Bilinmeyen hata");
    } finally {
      setBekliyor(false);
    }
  }

  async function appleGiris() {
    if (bekliyor) return;
    setBekliyor(true);
    try {
      const kimlik = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!kimlik.identityToken) throw new Error("Apple kimliği alınamadı");
      const { error } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: kimlik.identityToken,
      });
      if (error) throw error;
      await kayitVeGec();
    } catch (h) {
      // kullanıcı vazgeçtiyse sessiz geç
      const kod = (h as { code?: string }).code;
      if (kod !== "ERR_REQUEST_CANCELED") {
        Alert.alert("Giriş başarısız", h instanceof Error ? h.message : "Bilinmeyen hata");
      }
    } finally {
      setBekliyor(false);
    }
  }

  return (
    <View style={s.kap}>
      <Image source={require("../../assets/images/icon.png")} style={s.logo} />
      <Text style={s.baslik}>SofraKur</Text>
      <Text style={s.alt}>Kafende sipariş ver, puan biriktir,{"\n"}ödüller kazan.</Text>

      <View style={s.butonlar}>
        {appleVar && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={16}
            style={s.appleButon}
            onPress={appleGiris}
          />
        )}
        <Pressable
          onPress={googleGiris}
          disabled={bekliyor}
          style={[s.buton, s.googleButon, bekliyor && s.soluk]}
        >
          <Text style={s.googleG}>G</Text>
          <Text style={s.googleYazi}>Google ile devam et</Text>
        </Pressable>
      </View>

      <Text style={s.kvkk}>
        Devam ederek Kullanım Koşulları&apos;nı ve{"\n"}
        <Text style={s.kvkkLink}>Gizlilik Politikası</Text>&apos;nı (sofrakur.com/gizlilik)
        kabul etmiş olursun.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  kap: {
    flex: 1,
    backgroundColor: renk.krem,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  logo: { width: 84, height: 84, borderRadius: 22 },
  baslik: {
    marginTop: 16,
    fontSize: 30,
    fontWeight: "800",
    color: renk.metinBaslik,
  },
  alt: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    color: renk.metinOrta,
  },
  butonlar: { marginTop: 36, width: "100%", maxWidth: 340, gap: 12 },
  buton: {
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 9,
  },
  googleButon: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: renk.cizgiKoyu,
  },
  googleG: { fontSize: 16, fontWeight: "800", color: "#4285F4" },
  googleYazi: { fontSize: 15, fontWeight: "700", color: renk.metin },
  appleButon: { width: "100%", height: 52 },
  soluk: { opacity: 0.5 },
  kvkk: {
    marginTop: 18,
    fontSize: 11.5,
    lineHeight: 18,
    textAlign: "center",
    color: renk.metinSoluk,
  },
  kvkkLink: { fontWeight: "700", color: renk.marka },
});
