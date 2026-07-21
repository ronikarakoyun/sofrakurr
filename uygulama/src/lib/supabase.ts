import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

// Web (Next.js) tarafıyla aynı Supabase projesi; anon anahtar herkese açık,
// yetkiler tamamen RLS + RPC guard'larında.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anonAnahtar = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anonAnahtar, {
  auth: {
    // Native'de AsyncStorage; web önizlemede supabase-js kendi varsayılanını
    // kullanır (statik export sırasında node'da AsyncStorage yoktur).
    ...(Platform.OS !== "web" ? { storage: AsyncStorage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Uygulama öne gelince token yenilemeyi başlat, arkadayken durdur
// (Supabase'in resmî React Native reçetesi).
AppState.addEventListener("change", (durum) => {
  if (durum === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
