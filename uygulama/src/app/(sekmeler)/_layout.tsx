import { Redirect, Tabs } from "expo-router";
import { useEffect } from "react";
import { Ikon } from "@/components/Ikon";
import { pushKaydiYap } from "@/lib/bildirim";
import { useOturum } from "@/lib/oturum";
import { SepetSaglayici, useSepet } from "@/lib/sepet";
import { renk } from "@/lib/tema";

function Sekmeler() {
  const { sepet } = useSepet();
  const sepetAdet = sepet.reduce((t, k) => t + k.adet, 0);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: renk.marka,
        tabBarInactiveTintColor: renk.metinSoluk,
        tabBarStyle: { backgroundColor: renk.kart, borderTopColor: renk.cizgi },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Ana Sayfa",
          tabBarIcon: ({ color }) => <Ikon ad="ev" boyut={22} renk={color} />,
        }}
      />
      <Tabs.Screen
        name="kafeler"
        options={{
          title: "Kafeler",
          tabBarIcon: ({ color }) => <Ikon ad="kahve" boyut={22} renk={color} />,
        }}
      />
      <Tabs.Screen
        name="sepetim"
        options={{
          title: "Sepetim",
          tabBarIcon: ({ color }) => <Ikon ad="sepet" boyut={22} renk={color} />,
          tabBarBadge: sepetAdet > 0 ? sepetAdet : undefined,
          tabBarBadgeStyle: { backgroundColor: renk.marka, color: "#fff", fontSize: 11 },
        }}
      />
      <Tabs.Screen
        name="hesabim"
        options={{
          title: "Hesabım",
          tabBarIcon: ({ color }) => <Ikon ad="kisi" boyut={22} renk={color} />,
        }}
      />
    </Tabs>
  );
}

export default function SekmeYerlesim() {
  const { oturum, yukleniyor } = useOturum();

  // Giriş yapılmış her açılışta cihaz push token'ını tazele (kampanya bildirimleri)
  useEffect(() => {
    if (oturum) pushKaydiYap();
  }, [oturum]);

  if (yukleniyor) return null;
  if (!oturum) return <Redirect href="/giris" />;

  return (
    <SepetSaglayici>
      <Sekmeler />
    </SepetSaglayici>
  );
}
