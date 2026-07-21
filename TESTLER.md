# SofraKur — Manuel Test Betiği

Her sürüm/deploy sonrası bu listeyi baştan sona uygula. Her madde: **Adım → Beklenen**.
Bir madde beklendiği gibi çıkmazsa Claude'a maddenin numarasını ve gördüğünü yaz.

Hazırlık: telefonda bir masa QR linki, kasada `kasa@`, mutfakta `mutfak@`,
yönetimde `admin@` hesabı açık olsun. Kafedeki yazıcı ajanı (BASLAT.bat) çalışıyor olsun.

---

## 1. Müşteri (QR) — telefon

| # | Adım | Beklenen |
|---|---|---|
| 1.1 | Masa QR'ını okut | Menü açılır; üstte kafe adı + masa adı; sekmeler: Menü / Sepet / Siparişler |
| 1.2 | Menüde gezin | Kategoriler ve ürünler fiyatlarıyla listeli; pasif ürünler görünmez |
| 1.3 | "Tümü"deyken en üste bak | 🎉 Kampanyalar şeridi (kampanya işaretli ürünler fotoğraflı kart) |
| 1.4 | Bir ürüne dokun | TAM SAYFA detay: foto (varsa), ad, fiyat, açıklama, opsiyonlar, "Ürün notu" kutusu, altta adet + Sepete Ekle |
| 1.5 | Zorunlu opsiyonu seçmeden Sepete Ekle | Buton soluk; "... seçimi zorunlu" uyarısı |
| 1.6 | Ek fiyatlı opsiyon seç (örn. Yulaf +₺15) | Sepete Ekle tutarı artar |
| 1.7 | Ürün notu yaz, adet 2 yap, Sepete Ekle | Menüye dönülür; altta "Sepeti gör · 2 ürün" çubuğu |
| 1.8 | Sepete git | Kalemler, opsiyonlar, ✎ ürün notu, adet +/−, Kaldır, sipariş notu kutusu, toplam |
| 1.9 | Sipariş Ver | Siparişler sekmesi açılır; durum "Onay bekliyor"; "garsona iletildi, önden ödemek isterseniz kasaya..." uyarısı |
| 1.10 | Düzenle'ye bas | Sipariş iptal olur, kalemler (notlarıyla) sepete geri döner |
| 1.11 | Tekrar sipariş ver → İptal et | Onay sorusu → sipariş listeden düşer |
| 1.12 | 🔔 (garson çağır) | "Garson çağrıldı ✓"; garson ekranında masa kırmızı yanar |
| 1.13 | Başka telefonla aynı QR'ı okut | Masanın siparişleri görünür ama Düzenle/İptal butonları YOK (sadece siparişi veren görür) |
| 1.14 | Masa kapandıktan (hesap + teslim) sonra sayfayı yenile | Eski siparişler görünmez (oturum sıfırlanır) |

## 2. Kasa — kasa@ hesabı

| # | Adım | Beklenen |
|---|---|---|
| 2.1 | /kasa aç | 3 sekme: Ödeme Bekleyenler / Açık Masalar / Cari |
| 2.2 | QR'dan sipariş gelince | Ödeme Bekleyenler'de masa kartı: kalemler, opsiyonlar, ✎ notlar, toplam |
| 2.3 | Ödendi ✓ → 💵 Nakit | Sipariş mutfağa düşer (KDS'te belirir); kafede istasyon fişleri basılır |
| 2.4 | Başka siparişte Ödendi → 💳 Kart | Aynı akış; raporda Kart hanesine yazılır |
| 2.5 | Bir siparişte İptal | Onay → sipariş iptal (KDS'e düşmez, ciroya girmez) |
| 2.6 | Açık Masalar → bir masada Yönet | Panel: kalemler, ara toplam, ikram/iskonto satırları, toplam |
| 2.7 | Bir kaleme 🎁 İkram | Kalem üstü çizili ₺0 sayılır; toplam düşer; raporda "ikram" ayrı |
| 2.8 | Kalem ✕ İptal | Onay → kalem düşer, stok iade |
| 2.9 | Kalem ⇄ Taşı → başka masa | Kalem hedef masanın adisyonuna geçer |
| 2.10 | % İskonto → 10% uygula | İskonto satırı belirir, toplam düşer; "kaldır" ile geri alınır |
| 2.11 | ⇄ Masayı Taşı → boş masa | Adisyon yeni masaya taşınır; dolu masaya taşınırsa hesaplar birleşir |
| 2.12 | 🧾 Yazdır | "Gönderildi ✓"; kafedeki tezgah yazıcısından adisyon fişi çıkar (MALİ DEĞERİ YOKTUR ibaresiyle) |
| 2.13 | Hesabı Kapat → 💵/💳 | Adisyon kapanır, Açık Masalar'dan düşer, ciroya işlenir |
| 2.14 | Hesabı Kapat → Cariye yaz → cari seç veya yeni aç | Tutar carinin borcuna yazılır |
| 2.15 | Cari sekmesi → Ödeme Al (nakit/kart) | Borç düşer; gün raporunda cari tahsilatı görünür |

## 3. Mutfak Ekranı (KDS) — mutfak@ hesabı

| # | Adım | Beklenen |
|---|---|---|
| 3.1 | /kds aç | Koyu tema; üstte istasyon seçici (Tümü/🍳/🍹/🧁), sayaçlar, saat |
| 3.2 | İstasyon seç (örn. bar) | Yalnız o istasyonun kalemleri; diğer istasyonlarınki soluk tek satır |
| 3.3 | Ödeme onaylı sipariş gelince | Kart "SIRADA" belirir + bip sesi; kalem opsiyonları ve ✎ notları görünür |
| 3.4 | Hazırlamaya Başla | Durum "hazırlanıyor" olur |
| 3.5 | İstasyon "Hazır ✓" | Kalemler hazır işaretlenir; TÜM istasyonlar bitince sipariş "HAZIR" + garsona push |
| 3.6 | Teslim Edildi | Kart ekrandan düşer |
| 3.7 | "bitti" (kalem reddet) | Kalem düşer + ürün otomatik pasife çekilir (menüden kalkar) |
| 3.8 | Reddet (tüm sipariş) | Sipariş reddedilir; müşteri ekranında "Reddedildi" |
| 3.9 | 🖨 fiş / oto yazdır | Tarayıcıdan 80mm fiş çıkar (kiosk-printing'de sessiz basar) |

## 4. Garson — garson hesabı (Personel'den açılır)

| # | Adım | Beklenen |
|---|---|---|
| 4.1 | /garson aç | Bölüm filtreli masa haritası; saat; bildirim izni butonu |
| 4.2 | Masa renkleri | Boş=kesikli, dolu=dolgun, hazır=yeşil nabız, hesap=turuncu, çağrı=kırmızı |
| 4.3 | Müşteri 🔔 çağırınca | Masa kırmızı + ses; panelde "İlgilendim" çağrıyı kapatır |
| 4.4 | Sipariş hazır olunca | Masa yeşil + push bildirimi (ekran kapalıyken de); "Teslim Ettim" durumu kapatır |
| 4.5 | Masaya sipariş gir (ürüne dokun→detay/not; +/− hızlı; opsiyonlu ürün seçim ekranı açar) | Sipariş DOĞRUDAN mutfağa düşer, fişte "Yazan: <garson adı>"; hesap Açık Masalar'da birikir |
| 4.6 | Garson hesabıyla /kasa veya /admin'e girmeyi dene | Erişim reddedilir, ana sayfaya döner |
| 4.7 | Müşteri QR'dan sipariş verince | Masa mavi "onay bekliyor" olur + ses + üstte bildirim kartı |
| 4.8 | Panel → "Onayla — Mutfağa Gönder ✓" | Sipariş mutfağa düşer, hesap masada açık kalır (kasada sonra kapanır) |
| 4.9 | Panel → Reddet | Onay sorusu → müşteri ekranında "Reddedildi" görünür, mutfağa gitmez |
| 4.10 | Müşteri kasada önden öderse (kasa "Ödendi") | Onay bloğu kendiliğinden düşer, sipariş mutfağa gider (iki kapı da geçerli) |

## 5. Yönetim — admin@ hesabı

| # | Adım | Beklenen |
|---|---|---|
| 5.1 | Genel Bakış | Bugünkü ciro, nakit/kart kırılımı, kapanan hesap, ortalama, sipariş sayısı, iptal, saatlik grafik — test satışıyla anında güncellenir |
| 5.2 | Menü: kategori + ürün ekle | Müşteri menüsünde anında görünür |
| 5.3 | Menü: fiyata tıkla → değiştir | Yeni fiyat menüye yansır (eski siparişler eski fiyatta kalır) |
| 5.4 | Menü: 🍳/🍹/🧁 istasyon değiştir | Yeni siparişlerin fişi/KDS'i yeni istasyona düşer |
| 5.5 | Menü: ✎ → foto yükle | Foto ürün kartında + müşteri menüsü/detayında görünür; "Kaldır" siler |
| 5.6 | Menü: ✎ → açıklama yaz | Müşteri menüsünde ürün altında görünür |
| 5.7 | Menü: ✎ → 🎉 Kampanya yap | Ürün, QR menü üstündeki Kampanyalar şeridine girer |
| 5.8 | Menü: ⚙ opsiyon grubu + seçenek ekle | Müşteri detay sayfasında görünür; zorunlu/çoklu kuralları işler |
| 5.9 | Menü: 📋 reçete gir (örn. 100g süt) | Satışta hammadde stoğu otomatik düşer; iptalde iade |
| 5.10 | Stok: hammadde + alış girişi (fiyatla) | Stok artar, son birim maliyet güncellenir; kritik seviyede uyarı |
| 5.11 | Stok: vitrin ürününe adet takibi | Adet 0'a inince ürün otomatik pasif |
| 5.12 | Sayım: fiziksel miktarları gir | Fark = fire + TL zarar; Kaydet stokları sayılana çeker; geçmişe yazılır |
| 5.13 | Raporlar | Gün/hafta ciro, ürün satışları, maliyet-kâr, ödeme kırılımı, ikram/iskonto/cari |
| 5.14 | Gün Sonu: açılış kasası + sayılan nakit/kart + gider | Beklenenle fark rozeti; açık masa uyarısı; Günü Kapat kaydeder |
| 5.15 | Masalar & QR: masa/bölüm ekle, QR indir | Yeni QR çalışır |
| 5.16 | Personel: hesap aç (garson/kasa/mutfak) | Yeni hesap girişte kendi ekranına düşer; "Pasife Al" girişi kapatır; Şifre değiştirme çalışır |

## 6. Yazıcı Ajanı — kafe PC'si

| # | Adım | Beklenen |
|---|---|---|
| 6.1 | TEST.bat | 3 yazıcıdan test fişi, kağıt otomatik kesilir |
| 6.2 | KODTEST.bat | Her yazıcıdan 7 seçenekli Türkçe deneme fişi (doğru numara ayara yazılır) |
| 6.3 | QR sipariş + kasada Ödendi | İlgili istasyon yazıcılarından sipariş fişi: masa, saat, "Yazan: Müşteri", kalemler, opsiyonlar, NOT satırı |
| 6.4 | Garson siparişi + Ödendi | Fişte "Yazan: <garson adı>" |
| 6.5 | Kasada 🧾 Yazdır | Tezgah yazıcısından adisyon fişi: tutarlar sağda, İKRAM/İskonto satırları, TOPLAM, "MALİ DEĞERİ YOKTUR" |
| 6.6 | Ajan penceresini kapat | 5 sn içinde kendini yeniden başlatır |
| 6.7 | İnterneti 1 dk kes, sipariş ver | Bağlantı dönünce fiş en geç ~15 sn'de basılır (yedek tarama) |
| 6.8 | PC'yi yeniden başlat | Ajan kendiliğinden açılır (shell:startup kısayolu kuruluysa) |

## 7. Güvenlik / Roller

| # | Adım | Beklenen |
|---|---|---|
| 7.1 | Çıkış yapıp /admin, /kasa, /kds, /garson aç | Hepsi /giris'e yönlendirir |
| 7.2 | kasa@ ile /admin, /kds | Reddedilir |
| 7.3 | garson ile /kasa | Reddedilir |
| 7.4 | sofrakur.com kökünü aç (müşteri gözüyle) | Sadece karşılama sayfası; personel ekranlarına dair liste yok |
| 7.5 | sofrakur.vercel.app aç | sofrakur.com'a yönlenir |
| 7.6 | QR token'ını değiştirerek dene | "QR kodu geçerli değil" |

## 8. Sadakat Programı (0031/0032 — Müşteri Uygulaması M1)

| # | Adım | Beklenen |
|---|---|---|
| 8.1 | Müşteri Google/Apple ile girer (musteri_kayit) | Kayıt açılır, 8 haneli musteri_kod döner; ikinci giriş rolü/kodu değiştirmez |
| 8.2 | Kasada 140₺'lik adisyona müşteri koduyla puan işle | "+140 puan, bakiye 140" (çarpan 1.0; tutar ikram hariç − iskonto) |
| 8.3 | Aynı adisyona ikinci kez puan işle | "Bu hesaba puan zaten işlenmiş" hatası |
| 8.4 | 100 puanlık ödülü kullan (bakiye 140) | Bakiye 40'a düşer; ürün kasada ikram olarak 0₺ yazılır |
| 8.5 | Aynı ödülü tekrar dene (bakiye 40) | "Puan yetersiz (bakiye: 40, gereken: 100)" |
| 8.6 | Müşteri uygulamada özetine bakar (musteri_ozet) | Kod + kafe bazlı bakiye + son hareketler |
| 8.7 | Uygulamadan girişliyken masa QR ile sipariş | siparis.musteri_id damgalanır; "Siparişlerim"de görünür |
| 8.8 | Anonim QR web siparişi (regresyon) | Eskisi gibi çalışır, musteri_id boş kalır |
| 8.9 | Personel girişliyken sipariş | musteri_id boş (yalnız müşteri rolü damgalanır) |
| 8.10 | Kafede sadakat_aktif=false iken puan işle | "Sadakat programı bu kafede kapalı" |
| 8.11 | Müşteri hesabıyla sadakat_puan_isle çağır | "Bu işlem için kasa yetkisi gerekli" |

## 9. Müşteri Uygulaması (Expo — M2/M3/M4)

| # | Adım | Beklenen |
|---|---|---|
| 9.1 | Google/Apple ile giriş | musteri_kayit çağrılır, sekmelere düşer; personel hesabı reddedilir |
| 9.2 | Puanlarım | Kişisel QR + kod + kafe bazlı bakiye + ödül listesi + hareketler |
| 9.3 | Menü → "Masadaki QR'ı Okut" | Kamera açılır, izin istenir; masa QR'ı okununca menü + masa başlığı gelir |
| 9.4 | Ürüne dokun → detay | Foto, açıklama, opsiyonlar, ürün notu, adet, Sepete Ekle |
| 9.5 | Sepet → Sipariş Ver | Sipariş oluşur; müşteri hesabıysa siparis.musteri_id damgalanır |
| 9.6 | Siparişlerim → 🔁 Aynısını tekrar | Kalemler Menü sekmesinde sepete yüklenir (masa yoksa okutunca) |
| 9.7 | Kasada müşteri koduyla puan | Ödeme onayı/Yönet panelinde kod → +puan; ödül → puandan düşülür |

## 10. Müşteri Uygulaması v2 — sekme yapısı (Ana Sayfa/Kafeler/Sepetim)

| # | Adım | Beklenen |
|---|---|---|
| 10.1 | Ana Sayfa | Selamlama + puan kartı (dokununca büyük QR) + kampanyalar + ödüller + son hareketler |
| 10.2 | Kafeler | Sistemdeki tüm aktif kafeler listelenir; kafeye dokun → menüsü (masasız da gezilir) |
| 10.3 | Menüden sepete ekle | Sepetim rozeti artar; alt "Sepetim · N ürün" çubuğu Sepetim'e götürür |
| 10.4 | Sepetim (masa yok) | "Sipariş için masa gerekli · QR Okut"; buton "QR Okut ve Sipariş Ver" |
| 10.5 | Sepetim (masa var) | "📍 Masa · Değiştir"; buton "Siparişi Gönder"; ödeme kutusu: kayıtlı kart yakında + kasada öde notu |
| 10.6 | Uygulamayı kapat/aç | Sepet ve masa oturumu kalıcı (AsyncStorage) |
| 10.7 | Farklı kafe seç / farklı kafenin masasını okut | Sepet + masa sıfırlanır (kafeler karışmaz) |
| 10.8 | Kampanyaya dokun (Ana Sayfa) | İlgili kafenin menüsü açılır |

## 11. Kampanya Push + Hesap Silme + KVKK (M5/M6)

| # | Adım | Beklenen |
|---|---|---|
| 11.1 | Admin → Kampanyalar: taslak kaydet → Gönder | Onay sorusu; üye cihazlarına bildirim; listede "gönderildi · N cihaz" |
| 11.2 | Aynı kampanyayı tekrar gönder | "Bu kampanya zaten gönderilmiş" (409) |
| 11.3 | Kasa hesabıyla kampanya API'si | 403 |
| 11.4 | Uygulamada girişten sonra bildirim izni | İzin verilirse cihaz kaydolur; çıkışta kayıt silinir |
| 11.5 | sofrakur.com/gizlilik | KVKK aydınlatma metni açılır (mağaza privacy URL'i) |
| 11.6 | Uygulama → Hesabım → Hesabı Kalıcı Sil | Onay → hesap+puan+cihaz kaydı silinir, sipariş geçmişi anonim kalır |
| 11.7 | Personel hesabıyla hesap-sil API'si | 403 "Personel hesapları buradan silinemez" |

## 12. Self-servis: yetki anahtarları + panel + platform araçları (0037-0039)

| # | Adım | Beklenen |
|---|------|----------|
| 12.1 | admin@butikek.com ile giriş | /panel açılır (kafe listesi); "Yönet" → o kafenin admin ekranı |
| 12.2 | Kasa hesabıyla giriş | İlk sekme "Sipariş" (eski garson ekranı); Yönetim linki görünmez |
| 12.3 | Personel → Düzenle → "Gün Sonu" yetkisini kapat | O hesapta Gün Sonu sekmesi kaybolur; REST'ten gider insert reddedilir |
| 12.4 | /panel → Yeni Kafe Aç → formu doldur | Kafe+yönetici+bölüm/masalar kurulur; yönetici e-postasıyla giriş /admin'e düşer |
| 12.5 | /panel → Zincirler → zincir aç + kafe ata + franchise hesabı | Franchise girişi /panel'de yalnız zincirindeki kafeleri görür |
| 12.6 | /panel → Platform Raporu (Bugün/Bu Ay) | Kafe başına ciro/adisyon/sipariş; toplam kartları doğru |
| 12.7 | Franchise hesabıyla /panel/yeni-kafe veya /panel/zincirler | Ana sayfaya atılır (yalnız süper admin) |
| 12.8 | Kasa hesabıyla platform_rapor RPC (konsoldan) | 0 satır döner; zincir_olustur hata verir |

## 13. Faz 5 — Sipariş numarası (0040, M1)

| # | Adım | Beklenen |
|---|------|----------|
| 13.1 | QR'dan sipariş ver | KDS kartında büyük "#N" + altında masa adı; kasa "Ödeme Bekleyenler" kartı "Masa · #N" |
| 13.2 | Aynı gün ikinci sipariş (kasadan) | Numara aynı havuzdan devam eder (#N+1) — kanal fark etmez |
| 13.3 | Ertesi gün ilk sipariş | Numara 1'den başlar |
| 13.4 | Mutfak/istasyon fişi (yeni ajan zip'i kuruluysa) | Çift boy satır "Masa · #N" |
| 13.5 | QR "Siparişlerim" + uygulama geçmişi | Kartlarda "#N" görünür; 0040 öncesi eski kayıtlar masa adıyla kalır |
| 13.6 | REST'ten anon/müşteri ile siparis_no_al çağrısı | permission denied / "kasa yetkisi gerekli" |

## 13b. Faz 5 — Masasız şema + kafe modu (0041, M2)

| # | Adım | Beklenen |
|---|------|----------|
| 13b.1 | Yönetim → Ayarlar | Masalı/Self-servis + ödeme modu seçimi; BUTİKEK "Masalı" görünür |
| 13b.2 | Self-servis seçiliyken Açık hesap | Buton pasif ("ödeme her zaman önce alınır" notu) |
| 13b.3 | BUTİKEK regresyon turu | QR sipariş → kasa onay → KDS → ödeme → gün sonu birebir aynı |
| 13b.4 | REST anon musteri_siparis_olustur | "Sipariş için uygulamadan giriş yapmalısınız" |
| 13b.5 | (M3 sonrası) self-servis kafede uygulamadan sipariş | Masasız #N sipariş, ödeme bekliyor |

## 13c. Faz 5 — Self-servis UI (M3)

| # | Adım | Beklenen |
|---|------|----------|
| 13c.1 | Uygulama → Kafeler (self-servis kafe) | Kartta "Self-servis · Tezgahtan teslim"; dokununca masa adımı YOK, direkt menü |
| 13c.2 | Sepetim (self-servis kafe) | Masa kutusu yerine "numaranla tezgahtan alırsın" notu; "Siparişi Gönder" direkt çalışır |
| 13c.3 | Sipariş gönder | "Sipariş alındı" + aktif listede #N "Ödeme bekliyor" |
| 13c.4 | Kasa (self-servis kafede) | Masa haritası yerine "+ Yeni Sipariş (Tezgah)" + numara şeridi; sekme "Açık Hesaplar" |
| 13c.5 | Tezgah satışı gönder | Ödeme adımı: Nakit/Kart → adisyon kapanır; "Sonra" → Açık Hesaplar'da bekler |
| 13c.6 | Şeritte hazırlanıyor kartı "Hazır ✓" → "Teslim Edildi ✓" | Durumlar ilerler; ödeme bekleyende "Ödeme Al →" Ödeme sekmesine götürür |
| 13c.7 | BUTİKEK (masalı) kasa + uygulama | Ekranlar birebir eski görünüm (masa haritası + masa seçimi) |

## 13d. Faz 5 — Müşteriye "hazır" push (0042, M4)

| # | Adım | Beklenen |
|---|------|----------|
| 13d.1 | Uygulamadan sipariş → barista "Hazır ✓" | Telefona "Siparişin hazır · #N" push'u (EAS kurulumu sonrası test edilir) |
| 13d.2 | Sepetim açıkken durum değişimi | Rozet push'suz da anında güncellenir (realtime) |
| 13d.3 | Kasadan girilen sipariş "Hazır ✓" | Müşteri push'u atılmaz (musteri_id yok) |
| 13d.4 | Secretsiz POST /api/push/hazir | 401 yetkisiz |

## 13e. Faz 5 — Zincir menüsü (0043, M5)

| # | Adım | Beklenen |
|---|------|----------|
| 13e.1 | /panel/zincirler → zincirde "Ana şube seç" | Zincirin şubeleri listelenir; seçince "Ana şube atandı" |
| 13e.2 | Ana şubede menü düzenle → "Tüm Şubelere Uygula" | "Menü N şubeye uygulandı ✓"; şubelerde aynı ürün/fiyat/opsiyon/ödül |
| 13e.3 | Şubede ürünü pasife al → tekrar uygula | Şube "bitti" işareti korunur (ürün açılmaz) |
| 13e.4 | Şubede ürün fiyatına "🔒 şube fiyatı" → tekrar uygula | O şubenin fiyatı korunur; diğer şubeler merkez fiyatını alır |
| 13e.5 | Ana şubeden ürün sil → uygula | Şubelerde ürün pasife düşer (silinmez, geçmiş korunur) |
| 13e.6 | Franchise hesabı /panel → Zincir Menüsü kartı | Yalnız kendi zincirini yönetir; başka zincir RPC'si "size bağlı değil" |
| 13e.7 | Kasa/anon ile senkron RPC | "zincir sahibi veya platform yöneticisi girişi gerekli" |

## 13f. Faz 5 — Zincir sadakat + kampanya (0044) ve rol guard'ı (0045, M6)

| # | Adım | Beklenen |
|---|------|----------|
| 13f.1 | Zincir A şubesinde puan işle | Puan zincir hesabına yazılır |
| 13f.2 | Zincir B şubesinde ödül kullan | Aynı bakiyeden düşer (A'da kazan, B'de harca) |
| 13f.3 | BUTİKEK (bağımsız) puan işle | Kafe bazlı hesap; zincirden bağımsız, davranış eskisi gibi |
| 13f.4 | Uygulama → Hesabım | Zincir hesabı zincir adıyla görünür |
| 13f.5 | Zincir kampanyası gönder | Zincirin tüm şubelerindeki üyelere gider (kafe kampanyası yalnız o kafeye) |
| 13f.6 | Oturumsuz REST ile puan/gün sonu RPC'si | İlk adımda "kasa yetkisi gerekli" (0045 sıkılaştırması) |

## 13g. Faz 5 — Toplu şube kurulumu + şube bulma (0046, M7)

| # | Adım | Beklenen |
|---|------|----------|
| 13g.1 | /panel/yeni-kafe → "Toplu şube kurulumu" sekmesi | Zincir seçimi + liste alanı + ortak şifre |
| 13g.2 | 3 satır yapıştır (biri bozuk e-posta) → Kur | 2 şube kurulur, hatalı satır numarasıyla raporlanır |
| 13g.3 | Kurulan şubeye admin e-postasıyla giriş | Kendi /admin paneli; menü zincirden gelmiş (ana şube seçiliyse) |
| 13g.4 | Aynı slug ile ikinci kez kur | "Bu adres (slug) zaten kullanılıyor" — diğer satırlar etkilenmez |
| 13g.5 | Uygulama → Kafeler (5+ şube varken) | Arama kutusu görünür; şubeler il başlıklarıyla gruplu, kartta ilçe |
| 13g.6 | Aramaya semt yaz | Ad/il/ilçe eşleşmesiyle süzülür; eşleşme yoksa uyarı |
| 13g.7 | Yetkisiz POST /api/platform toplu_kafe | 403 platform yöneticisi gerekli |

## 14. Faz 6 — Kasa sadeleştirme (M1-M3)

| # | Adım | Beklenen |
|---|------|----------|
| 14.1 | Kasa → Sipariş, bilgisayarda (1280px) | Ekran tam kullanılır; kartlar yatay (solda #numara, ortada kalemler, sağda buton) |
| 14.2 | Ürün seçme panelini aç (bilgisayar) | Ortalanmış pencere, arka plan tam kararır, ürünler 3 sütun |
| 14.3 | Aynı ekran telefonda | Eskisi gibi: panel tam genişlik, alttan açılır |
| 14.4 | Self-servis kafede sipariş → "Hazır ✓" | Kart listeden düşer; müşteriye "Siparişin hazır · #N" push'u gider |
| 14.5 | Masalı kafede KDS'ten "Hazır ✓" | Sipariş hazırda kalır, masa haritası yeşile döner, garsona bildirim gider |
| 14.6 | Kasa şeridinde karta parmakla sola kaydır | Yeşil "Hazır ✓" zemini belirir, kart kayar ve düşer |
| 14.7 | Yarıya kadar kaydırıp bırak | Kart yerine yaylanır, hiçbir şey olmaz |
| 14.8 | Fareyle sürüklemeyi dene | Hiçbir şey olmaz (buton kullanılır) |
| 14.9 | Şeritte parmakla yukarı/aşağı kaydır | Sayfa normal kayar, kart oynamaz |
