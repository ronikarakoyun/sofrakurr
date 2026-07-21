import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ikon } from "@/components/Ikon";
import { useSepet } from "@/lib/sepet";
import { supabase } from "@/lib/supabase";
import { renk } from "@/lib/tema";
import { kalemBirimFiyat, tl, type GecmisSiparis } from "@/lib/tipler";

const DURUM_ETIKET: Record<string, { etiket: string; renk: string; zemin: string }> = {
  odeme_bekliyor: { etiket: "Ödeme bekliyor", renk: "#9a5b13", zemin: "#fbeeda" },
  bekliyor: { etiket: "Mutfakta sırada", renk: "#6d5b49", zemin: "#f0ebe4" },
  hazirlaniyor: { etiket: "Hazırlanıyor", renk: "#31639c", zemin: "#e9f0f9" },
  hazir: { etiket: "Hazır ✓", renk: "#2f7a4c", zemin: "#e6f3ea" },
  teslim: { etiket: "Teslim edildi", renk: "#7a6a58", zemin: "#f0ebe4" },
  iptal: { etiket: "İptal", renk: "#a63b2a", zemin: "#fbe7e4" },
  reddedildi: { etiket: "Reddedildi", renk: "#a63b2a", zemin: "#fbe7e4" },
};

// Sepetim: sepet + masa okutma + siparişi gönder + ödeme adımı + sipariş takibi.
// Ödeme: kayıtlı kartla online ödeme PSP anlaşması yapılınca aktifleşecek;
// o zamana dek sipariş "önce ödeme" akışıyla kasada ödenir.
export default function SepetimEkrani() {
  const router = useRouter();
  const {
    oturum,
    seciliKafe,
    sepet,
    masaBirak,
    sepetGuncelle,
    sepetCikar,
    siparisVer,
    tekrarKuyrukla,
  } = useSepet();

  const [not, setNot] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [siparisler, setSiparisler] = useState<GecmisSiparis[]>([]);
  const [yenileniyor, setYenileniyor] = useState(false);

  const sepetToplam = sepet.reduce((t, k) => t + kalemBirimFiyat(k) * k.adet, 0);

  const yukle = useCallback(async () => {
    const { data, error } = await supabase.rpc("musteri_siparislerim");
    if (!error) setSiparisler((data as GecmisSiparis[]) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      yukle();
    }, [yukle])
  );

  // Canlı takip: kendi siparişimin durumu değişince (örn. barista "Hazır ✓"
  // deyince) rozet anında güncellenir — push gelmese de ekran günceldir.
  useEffect(() => {
    let kanal: ReturnType<typeof supabase.channel> | null = null;
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      kanal = supabase
        .channel("siparis-takip")
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "siparis", filter: `musteri_id=eq.${data.user.id}` },
          () => yukle()
        )
        .subscribe();
    });
    return () => {
      if (kanal) supabase.removeChannel(kanal);
    };
  }, [yukle]);

  async function elleYenile() {
    setYenileniyor(true);
    await yukle();
    setYenileniyor(false);
  }

  // Masa seçimi: Kafeler sekmesindeki bölümlü masa haritasına götürür
  function masaSecimeGit() {
    router.push("/kafeler");
  }

  // Self-servis kafede masa şartı yok; masalı kafede oturum gerekir
  const selfServis = !!seciliKafe && !seciliKafe.masa_duzeni;

  async function gonder() {
    if (gonderiliyor || !sepet.length) return;
    if (!selfServis && !oturum) {
      masaSecimeGit();
      return;
    }
    setGonderiliyor(true);
    const hata = await siparisVer(not);
    setGonderiliyor(false);
    if (hata) {
      Alert.alert("Sipariş gönderilemedi", hata);
      return;
    }
    setNot("");
    Alert.alert(
      "Sipariş alındı ✓",
      selfServis
        ? "Ödemeni kasada yaptığında hazırlanmaya başlar; hazır olunca numaranla tezgahtan alırsın."
        : "Ödemeni kasada yaptığında hazırlanmaya başlar. Aşağıdan takip edebilirsin."
    );
    yukle();
  }

  function aynisiniTekrar(sp: GecmisSiparis) {
    const gecerli = sp.kalemler.filter((k) => !k.reddedildi);
    tekrarKuyrukla(
      gecerli.map((k) => ({
        urun_id: k.urun_id,
        adet: k.adet,
        opsiyonlar: k.opsiyonlar ?? [],
        not: k.kalem_notu,
      }))
    );
    if (!seciliKafe) router.push("/kafeler");
  }

  function siparisToplam(sp: GecmisSiparis): number {
    return sp.kalemler
      .filter((k) => !k.reddedildi)
      .reduce((t, k) => t + (Number(k.birim_fiyat) + Number(k.opsiyon_ek_fiyat)) * k.adet, 0);
  }

  const aktifler = siparisler.filter((sp) =>
    ["odeme_bekliyor", "bekliyor", "hazirlaniyor", "hazir"].includes(sp.durum)
  );
  const gecmisler = siparisler.filter(
    (sp) => !["odeme_bekliyor", "bekliyor", "hazirlaniyor", "hazir"].includes(sp.durum)
  );

  return (
    <SafeAreaView style={s.guvenli} edges={["top"]}>
      <ScrollView
        contentContainerStyle={s.icerik}
        refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={elleYenile} />}
      >
        <Text style={s.baslik}>Sepetim</Text>

        {/* ── Sepet ── */}
        {sepet.length === 0 ? (
          <View style={s.bosKutu}>
            <Ikon ad="sepet" boyut={44} renk={renk.metinSoluk} kalinlik={1.5} />
            <Text style={s.bosYazi}>Sepetin boş</Text>
            <Pressable onPress={() => router.push("/kafeler")} style={s.bosBtn}>
              <Text style={s.bosBtnYazi}>Kafelere Göz At</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {seciliKafe && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, marginBottom: 4 }}>
                <Ikon ad="kahve" boyut={14} renk={renk.metinSoluk} />
                <Text style={s.kafeEtiket}>{seciliKafe.ad}</Text>
              </View>
            )}
            {sepet.map((k, i) => (
              <View key={i} style={s.kalem}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={s.kalemAd}>{k.urun.ad}</Text>
                  <Text style={s.kalemTutar}>{tl(kalemBirimFiyat(k) * k.adet)}</Text>
                </View>
                {k.opsiyonlar.length > 0 && (
                  <Text style={s.kalemOps}>{k.opsiyonlar.map((o) => o.secim).join(", ")}</Text>
                )}
                {k.not ? <Text style={s.kalemNot}>Not: {k.not}</Text> : null}
                <View style={s.kalemSatir}>
                  <View style={s.adetKutu}>
                    <Pressable onPress={() => sepetGuncelle(i, k.adet - 1)} style={s.adetBtn}>
                      <Text style={s.adetBtnYazi}>−</Text>
                    </Pressable>
                    <Text style={s.adet}>{k.adet}</Text>
                    <Pressable onPress={() => sepetGuncelle(i, k.adet + 1)} style={s.adetBtn}>
                      <Text style={s.adetBtnYazi}>+</Text>
                    </Pressable>
                  </View>
                  <View style={{ flex: 1 }} />
                  <Pressable onPress={() => sepetCikar(i)}>
                    <Text style={s.kaldir}>Kaldır</Text>
                  </Pressable>
                </View>
              </View>
            ))}

            <TextInput
              value={not}
              onChangeText={setNot}
              placeholder="Sipariş notu (isteğe bağlı)"
              placeholderTextColor={renk.metinSilik}
              multiline
              style={s.notAlan}
            />

            {/* Masa durumu — yalnız masalı kafede (self-serviste tezgah teslimi) */}
            <View style={s.masaKutu}>
              {selfServis ? (
                <Text style={s.masaYazi}>
                  Self-servis — siparişin hazır olunca{" "}
                  <Text style={{ color: renk.marka }}>numaranla tezgahtan</Text> alırsın.
                </Text>
              ) : oturum ? (
                <>
                  <Text style={s.masaYazi}>
                    Masa: <Text style={{ color: renk.marka }}>{oturum.masa_ad}</Text>
                  </Text>
                  <Pressable onPress={() => { masaBirak(); masaSecimeGit(); }}>
                    <Text style={s.masaDegistir}>Değiştir</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={s.masaYazi}>Sipariş için masa seçmelisin</Text>
                  <Pressable onPress={masaSecimeGit}>
                    <LinearGradient
                      colors={["#c86f2c", "#8a4b1f"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={s.masaBtn}
                    >
                      <Text style={s.masaBtnYazi}>Masa Seç</Text>
                    </LinearGradient>
                  </Pressable>
                </>
              )}
            </View>

            <View style={s.toplamSatir}>
              <Text style={s.toplamYazi}>Toplam</Text>
              <Text style={s.toplam}>{tl(sepetToplam)}</Text>
            </View>
            <Pressable onPress={gonder} disabled={gonderiliyor}>
              <LinearGradient
                colors={["#c86f2c", "#8a4b1f"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[s.gonderBtn, gonderiliyor && s.soluk]}
              >
                <Text style={s.gonderYazi}>
                  {gonderiliyor
                    ? "Gönderiliyor…"
                    : selfServis || oturum
                      ? `Siparişi Gönder · ${tl(sepetToplam)}`
                      : "Masa Seç ve Sipariş Ver"}
                </Text>
              </LinearGradient>
            </Pressable>

            {/* Ödeme bilgisi */}
            <View style={s.odemeKutu}>
              <Pressable disabled style={s.kartBtn}>
                <Ikon ad="kart" boyut={15} renk={renk.metinOrta} />
                <Text style={s.kartBtnYazi}>Kayıtlı kartla öde — çok yakında</Text>
              </Pressable>
              <Text style={s.odemeNot}>
                Online ödeme açılana kadar ödemeni kasada yapabilirsin; siparişin
                kasa onayıyla hazırlanmaya başlar.
              </Text>
            </View>
          </>
        )}

        {/* ── Aktif siparişler ── */}
        {aktifler.length > 0 && (
          <>
            <Text style={s.bolum}>AKTİF SİPARİŞLER</Text>
            {aktifler.map((sp) => (
              <SiparisKart key={sp.siparis_id} sp={sp} toplam={siparisToplam(sp)} />
            ))}
          </>
        )}

        {/* ── Geçmiş ── */}
        {gecmisler.length > 0 && (
          <>
            <Text style={s.bolum}>GEÇMİŞ SİPARİŞLER</Text>
            {gecmisler.map((sp) => (
              <SiparisKart
                key={sp.siparis_id}
                sp={sp}
                toplam={siparisToplam(sp)}
                tekrar={() => aynisiniTekrar(sp)}
              />
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SiparisKart({
  sp,
  toplam,
  tekrar,
}: {
  sp: GecmisSiparis;
  toplam: number;
  tekrar?: () => void;
}) {
  const rozet = DURUM_ETIKET[sp.durum] ?? DURUM_ETIKET.bekliyor;
  return (
    <View style={s.spKart}>
      <View style={s.spUst}>
        <Text style={s.spKafe}>{sp.cafe_ad}</Text>
        <View style={[s.rozet, { backgroundColor: rozet.zemin }]}>
          <Text style={[s.rozetYazi, { color: rozet.renk }]}>{rozet.etiket}</Text>
        </View>
      </View>
      <Text style={s.spAlt}>
        {sp.siparis_no != null ? `#${sp.siparis_no} · ` : ""}
        {sp.masa_ad ? `${sp.masa_ad} · ` : ""}
        {new Date(sp.tarih).toLocaleDateString("tr-TR", { day: "numeric", month: "short" })}{" "}
        {new Date(sp.tarih).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
      </Text>
      {sp.kalemler.map((k, i) => (
        <View key={i} style={s.spKalem}>
          <Text style={[s.spKalemAd, k.reddedildi && s.cizili]}>
            {k.adet}× {k.urun_ad}
          </Text>
          <Text style={s.spKalemTutar}>
            {tl((Number(k.birim_fiyat) + Number(k.opsiyon_ek_fiyat)) * k.adet)}
          </Text>
        </View>
      ))}
      <View style={s.spToplamSatir}>
        <Text style={s.spToplamYazi}>Toplam</Text>
        <Text style={s.spToplam}>{tl(toplam)}</Text>
      </View>
      {sp.durum === "odeme_bekliyor" && (
        <Text style={s.spOdemeNot}>Ödemeni kasada yapınca hazırlanmaya başlar.</Text>
      )}
      {tekrar && (
        <Pressable onPress={tekrar} style={s.tekrarBtn}>
          <Text style={s.tekrarYazi}>Aynısını sepete ekle</Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  guvenli: { flex: 1, backgroundColor: renk.krem },
  icerik: { padding: 18, paddingBottom: 40 },
  baslik: { fontSize: 24, fontWeight: "800", color: renk.metinBaslik },
  bosKutu: { alignItems: "center", paddingVertical: 36, gap: 10 },
  bosYazi: { fontSize: 15, fontWeight: "700", color: renk.metinOrta },
  bosBtn: {
    marginTop: 6,
    backgroundColor: renk.marka,
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 13,
  },
  bosBtnYazi: { color: "#fff", fontSize: 14.5, fontWeight: "800" },
  kafeEtiket: { marginTop: 10, marginBottom: 4, fontSize: 13.5, fontWeight: "700", color: renk.metinSoluk },
  kalem: {
    backgroundColor: renk.kart,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: renk.cizgi,
    padding: 13,
    marginTop: 8,
  },
  kalemAd: { fontSize: 14.5, fontWeight: "700", color: renk.metinBaslik, flex: 1 },
  kalemTutar: { fontSize: 14, fontWeight: "800", color: renk.markaKoyu },
  kalemOps: { marginTop: 2, fontSize: 12, color: renk.metinSoluk },
  kalemNot: { marginTop: 2, fontSize: 12, fontStyle: "italic", color: renk.markaKoyu },
  kalemSatir: { flexDirection: "row", alignItems: "center", marginTop: 9 },
  adetKutu: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: renk.cizgiKoyu,
    backgroundColor: renk.krem,
  },
  adetBtn: { width: 34, height: 32, alignItems: "center", justifyContent: "center" },
  adetBtnYazi: { fontSize: 17, color: renk.markaKoyu },
  adet: { minWidth: 16, textAlign: "center", fontSize: 13.5, fontWeight: "800", color: renk.metin },
  kaldir: { fontSize: 12.5, fontWeight: "700", color: renk.tehlike },
  notAlan: {
    marginTop: 10,
    minHeight: 52,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: renk.cizgiKoyu,
    backgroundColor: renk.kart,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 14.5,
    color: renk.metin,
    textAlignVertical: "top",
  },
  masaKutu: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: renk.kart,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: renk.cizgiKoyu,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  masaYazi: { fontSize: 13.5, fontWeight: "700", color: renk.metin },
  masaDegistir: { fontSize: 12.5, fontWeight: "700", color: renk.marka },
  masaBtn: {
    backgroundColor: renk.marka,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  masaBtnYazi: { color: "#fff", fontSize: 12.5, fontWeight: "800" },
  toplamSatir: { flexDirection: "row", justifyContent: "space-between", marginTop: 14 },
  toplamYazi: { fontSize: 14.5, fontWeight: "700", color: renk.metinOrta },
  toplam: { fontSize: 18, fontWeight: "800", color: renk.metinBaslik },
  gonderBtn: {
    marginTop: 10,
    backgroundColor: renk.marka,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center",
  },
  soluk: { opacity: 0.5 },
  gonderYazi: { color: "#fff", fontSize: 15.5, fontWeight: "800" },
  odemeKutu: { marginTop: 12 },
  kartBtn: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 7,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: renk.cizgiKoyu,
    paddingVertical: 12,
    alignItems: "center",
    opacity: 0.55,
  },
  kartBtnYazi: { fontSize: 13.5, fontWeight: "800", color: renk.metinOrta },
  odemeNot: { marginTop: 8, fontSize: 12, lineHeight: 17, color: renk.metinSoluk, textAlign: "center" },
  bolum: {
    marginTop: 24,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: renk.metinSoluk,
  },
  spKart: {
    backgroundColor: renk.kart,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: renk.cizgi,
    padding: 14,
    marginBottom: 10,
  },
  spUst: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  spKafe: { fontSize: 14.5, fontWeight: "800", color: renk.metinBaslik },
  rozet: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  rozetYazi: { fontSize: 11.5, fontWeight: "800" },
  spAlt: { marginTop: 2, fontSize: 12, color: renk.metinSoluk },
  spKalem: { flexDirection: "row", justifyContent: "space-between", marginTop: 7 },
  spKalemAd: { fontSize: 13.5, fontWeight: "600", color: renk.metin, flex: 1 },
  cizili: { textDecorationLine: "line-through", color: renk.metinSilik },
  spKalemTutar: { fontSize: 13.5, fontWeight: "700", color: renk.metinOrta },
  spToplamSatir: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 9,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: renk.cizgiKoyu,
    borderStyle: "dashed",
  },
  spToplamYazi: { fontSize: 13.5, fontWeight: "800", color: renk.metinBaslik },
  spToplam: { fontSize: 14.5, fontWeight: "800", color: renk.marka },
  spOdemeNot: { marginTop: 8, fontSize: 12, color: "#9a5b13" },
  tekrarBtn: {
    marginTop: 10,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: renk.cizgiKoyu,
    backgroundColor: renk.krem,
    paddingVertical: 10,
    alignItems: "center",
  },
  tekrarYazi: { fontSize: 13, fontWeight: "800", color: renk.markaKoyu },
});
