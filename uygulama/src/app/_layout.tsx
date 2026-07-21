import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { OturumSaglayici } from "@/lib/oturum";
import { renk } from "@/lib/tema";

export default function KokYerlesim() {
  return (
    <OturumSaglayici>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: renk.krem },
        }}
      >
        <Stack.Screen name="(sekmeler)" />
        <Stack.Screen name="giris" />
      </Stack>
    </OturumSaglayici>
  );
}
