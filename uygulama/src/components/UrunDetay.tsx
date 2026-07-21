import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ikon } from "@/components/Ikon";
import { renk } from "@/lib/tema";
import { tl, type Opsiyon, type OpsiyonGrubu, type SecilenOpsiyon, type Urun } from "@/lib/tipler";

// Alttan kayan ürün detayı (tasarım: görsel + ad/fiyat + açıklama + adet + ekle;
// üründe opsiyon varsa aynı dilde opsiyon seçimi araya girer)
export function UrunDetay({
  urun,
  kapat,
  ekle,
}: {
  urun: Urun | null;
  kapat: () => void;
  ekle: (u: Urun, adet: number, o: SecilenOpsiyon[], not?: string) => void;
}) {
  return (
    <Modal visible={!!urun} transparent animationType="slide" onRequestClose={kapat}>
      {urun && <Icerik urun={urun} kapat={kapat} ekle={ekle} />}
    </Modal>
  );
}

function Icerik({
  urun,
  kapat,
  ekle,
}: {
  urun: Urun;
  kapat: () => void;
  ekle: (u: Urun, adet: number, o: SecilenOpsiyon[], not?: string) => void;
}) {
  const [secimler, setSecimler] = useState<Record<string, Opsiyon[]>>(() =>
    Object.fromEntries(
      urun.opsiyon_grubu.map((g) => [g.id, g.min_secim >= 1 && g.opsiyon[0] ? [g.opsiyon[0]] : []])
    )
  );
  const [adet, setAdet] = useState(1);
  const [not, setNot] = useState("");

  function sec(grup: OpsiyonGrubu, o: Opsiyon) {
    setSecimler((s) => {
      const mevcut = s[grup.id] ?? [];
      if (grup.max_secim === 1) return { ...s, [grup.id]: [o] };
      const varMi = mevcut.some((x) => x.id === o.id);
      if (varMi) return { ...s, [grup.id]: mevcut.filter((x) => x.id !== o.id) };
      if (mevcut.length >= grup.max_secim) return s;
      return { ...s, [grup.id]: [...mevcut, o] };
    });
  }

  const eksikGrup = urun.opsiyon_grubu.find((g) => (secimler[g.id]?.length ?? 0) < g.min_secim);
  const ekToplam = Object.values(secimler)
    .flat()
    .reduce((t, o) => t + Number(o.ek_fiyat), 0);
  const tutar = (Number(urun.fiyat) + ekToplam) * adet;

  function sepeteEkle() {
    if (eksikGrup) return;
    ekle(
      urun,
      adet,
      urun.opsiyon_grubu.flatMap((g) =>
        (secimler[g.id] ?? []).map((o) => ({
          grup: g.ad,
          secim: o.ad,
          ek_fiyat: Number(o.ek_fiyat),
        }))
      ),
      not
    );
    kapat();
  }

  return (
    <Pressable style={s.perde} onPress={kapat}>
      <Pressable style={s.sayfa} onPress={() => {}}>
        {/* Üst görsel */}
        <View style={s.gorselKap}>
          {urun.gorsel_url ? (
            <Image source={{ uri: urun.gorsel_url }} style={s.gorsel} />
          ) : (
            <LinearGradient
              colors={["#c86f2c", "#8a4b1f"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[s.gorsel, s.orta]}
            >
              <Ikon ad="kahve" boyut={54} renk="rgba(255,255,255,0.9)" kalinlik={1.4} />
            </LinearGradient>
          )}
          <Pressable onPress={kapat} style={s.kapatBtn}>
            <Text style={s.kapatYazi}>✕</Text>
          </Pressable>
        </View>

        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={s.govde}>
          <View style={s.adSatir}>
            <Text style={s.ad}>{urun.ad}</Text>
            <Text style={s.fiyat}>{tl(Number(urun.fiyat))}</Text>
          </View>
          {urun.aciklama ? <Text style={s.aciklama}>{urun.aciklama}</Text> : null}

          {urun.opsiyon_grubu.map((g) => (
            <View key={g.id} style={{ marginTop: 14 }}>
              <Text style={s.grupBaslik}>
                {g.min_secim >= 1 ? `${g.ad} (zorunlu)` : g.ad}
              </Text>
              {g.opsiyon.map((o) => {
                const secili = (secimler[g.id] ?? []).some((x) => x.id === o.id);
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => sec(g, o)}
                    style={[s.opsiyon, secili && s.opsiyonSecili]}
                  >
                    <View style={s.opsiyonSol}>
                      <View style={[s.radyo, secili && s.radyoSecili]} />
                      <Text style={s.opsiyonAd}>{o.ad}</Text>
                    </View>
                    {Number(o.ek_fiyat) > 0 && (
                      <Text style={s.opsiyonFiyat}>+{tl(Number(o.ek_fiyat))}</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}

          <TextInput
            value={not}
            onChangeText={setNot}
            placeholder="Ürün notu (isteğe bağlı)"
            placeholderTextColor={renk.metinSilik}
            style={s.not}
          />

          {eksikGrup && (
            <Text style={s.uyari}>&quot;{eksikGrup.ad}&quot; seçimi zorunlu.</Text>
          )}
          <View style={s.altSatir}>
            <View style={s.adetKutu}>
              <Pressable onPress={() => setAdet((a) => Math.max(1, a - 1))} style={s.adetBtn}>
                <Text style={s.adetBtnYazi}>−</Text>
              </Pressable>
              <Text style={s.adet}>{adet}</Text>
              <Pressable onPress={() => setAdet((a) => a + 1)} style={s.adetBtn}>
                <Text style={s.adetBtnYazi}>+</Text>
              </Pressable>
            </View>
            <Pressable onPress={sepeteEkle} disabled={!!eksikGrup} style={{ flex: 1 }}>
              <LinearGradient
                colors={["#c86f2c", "#8a4b1f"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[s.ekleBtn, eksikGrup ? { opacity: 0.45 } : null]}
              >
                <Text style={s.ekleYazi}>Sepete Ekle · {tl(tutar)}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </ScrollView>
      </Pressable>
    </Pressable>
  );
}

const s = StyleSheet.create({
  perde: {
    flex: 1,
    backgroundColor: "rgba(43,28,16,0.45)",
    justifyContent: "flex-end",
  },
  sayfa: {
    backgroundColor: renk.krem,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
    maxHeight: "88%",
  },
  orta: { alignItems: "center", justifyContent: "center" },
  gorselKap: { height: 200 },
  gorsel: { width: "100%", height: 200 },
  kapatBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(43,28,16,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  kapatYazi: { color: "#fff", fontSize: 15 },
  govde: { padding: 18, paddingBottom: 34 },
  adSatir: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  ad: { flex: 1, fontSize: 20, fontWeight: "800", color: renk.metinBaslik },
  fiyat: { fontSize: 18, fontWeight: "800", color: renk.marka },
  aciklama: { marginTop: 6, fontSize: 13.5, lineHeight: 20, color: renk.metinOrta },
  grupBaslik: { fontSize: 13.5, fontWeight: "800", color: renk.metinBaslik, marginBottom: 6 },
  opsiyon: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#ece1d1",
    backgroundColor: "#fff",
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  opsiyonSecili: { borderWidth: 1.5, borderColor: renk.marka, backgroundColor: "#fdf5ec" },
  opsiyonSol: { flexDirection: "row", alignItems: "center", gap: 10 },
  radyo: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#d8c9b4",
  },
  radyoSecili: { borderWidth: 6, borderColor: "#c86f2c" },
  opsiyonAd: { fontSize: 14, fontWeight: "600", color: renk.metin },
  opsiyonFiyat: { fontSize: 13, fontWeight: "600", color: renk.metinSoluk },
  not: {
    marginTop: 14,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: renk.cizgiKoyu,
    backgroundColor: "#fff",
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 14.5,
    color: renk.metin,
  },
  uyari: { marginTop: 10, textAlign: "center", fontSize: 12, fontWeight: "600", color: renk.tehlike },
  altSatir: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16 },
  adetKutu: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: renk.cizgiKoyu,
    backgroundColor: "#fff",
  },
  adetBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  adetBtnYazi: { fontSize: 19, color: renk.markaKoyu },
  adet: { minWidth: 20, textAlign: "center", fontSize: 15, fontWeight: "800", color: renk.metin },
  ekleBtn: { borderRadius: 16, paddingVertical: 14, alignItems: "center" },
  ekleYazi: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
