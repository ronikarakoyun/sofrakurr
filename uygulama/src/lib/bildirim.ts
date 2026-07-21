import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "./supabase";

// Kampanya push bildirimleri için cihaz token kaydı.
// Gerçek cihaz + EAS projectId gerektirir (dev build); web/simülatörde sessizce atlanır.

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function pushKaydiYap(): Promise<void> {
  try {
    if (Platform.OS === "web" || !Device.isDevice) return;

    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return; // EAS bağlanınca (M2 hesapları) aktifleşir

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("varsayilan", {
        name: "Kampanyalar",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const izin = await Notifications.getPermissionsAsync();
    let durum = izin.status;
    if (durum !== "granted") {
      const yeni = await Notifications.requestPermissionsAsync();
      durum = yeni.status;
    }
    if (durum !== "granted") return;

    const { data: tokenVeri } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { data: oturum } = await supabase.auth.getUser();
    if (!oturum.user) return;

    await supabase.from("expo_push_token").upsert(
      {
        kullanici_id: oturum.user.id,
        token: tokenVeri,
        platform: Platform.OS === "ios" ? "ios" : "android",
        son_gorulme: new Date().toISOString(),
      },
      { onConflict: "token" }
    );
  } catch {
    // bildirim kaydı hiçbir akışı bloklamaz
  }
}

// Çıkışta bu cihazın token'ını sil (başkasının hesabına bildirim gitmesin)
export async function pushKaydiSil(): Promise<void> {
  try {
    if (Platform.OS === "web" || !Device.isDevice) return;
    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return;
    const { data: tokenVeri } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from("expo_push_token").delete().eq("token", tokenVeri);
  } catch {
    /* sessiz */
  }
}
