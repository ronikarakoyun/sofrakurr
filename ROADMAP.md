# SofraKur — Tam Geliştirme Yol Haritası (Revize)

Dört yüzü olan (Kafe Takip, QR Web, Garson, Müşteri App) çok-kiracılı bir kafe sisteminin, **kendi kafende test edilerek** sıfırdan canlıya çıkarılma planı. Önce değer, sonra optimizasyon.

> **Bu revizyonda değişenler:** (1) FlutterFlow iptal — Faz 0–3'ün tamamı tek Next.js + Supabase projesi, hepsi web/PWA. (2) Sipariş, ödeme tamamlanmadan mutfağa düşmez: kasiyer "Ödendi" onayı verince KDS'e geçer; mod kafe başına ayarlanabilir (`once_odeme` / `acik_hesap`). (3) Adisyon ve masa oturumu veri modeli Faz 0'a alındı. (4) İptal/red akışı ve KDS dayanıklılığı Faz 1'e alındı. (5) KVKK, Faz 4 uyarısına eklendi. (6) Personel adaptasyonu test kriterleri eklendi.

---

## Sistemin 4 Yüzü

| # | Yüz | Nedir | Platform |
|---|-----|-------|----------|
| 1 | **Kafe Takip** | Yönetici paneli + Mutfak Ekranı (KDS) + Kasa | Web (tarayıcı / tablet) — `/admin`, `/kds`, `/kasa` |
| 2 | **QR Web** | Müşterinin masadaki QR'ı okutup indirmesiz sipariş verdiği sayfa | Mobil web — `/qr/[kod]` |
| 3 | **Garson** | Masa haritası, manuel sipariş, mutfak bildirimleri | **Android PWA** (ana ekrana kurulur, push destekler) |
| 4 | **Müşteri App** | Sadakat, keşfet, masadan ödeme — premium katman | Native (Flutter/RN) — **karar Faz 4'te** |

**Akışın özeti (once_odeme modu):** Müşteri QR okutur → sipariş verir → sipariş **"ödeme bekliyor"** durumunda bekler, mutfak görmez → müşteri kasada mevcut POS'tan öder (ÖKC fişi otomatik) → kasiyer "Ödendi" der → sipariş **o an** KDS'e düşer → mutfak "Hazır" der → garson taşır. `acik_hesap` modunda sipariş doğrudan mutfağa düşer, hesap sonda kasada kapanır.

---

## Teknoloji Yığını

- **Backend: Supabase.** Postgres (çok-kiracılı, ilişkisel), Row Level Security, Realtime (sipariş anında KDS'e düşer), Auth. Ücretsiz katmanla başlar.
- **Frontend: Next.js (tek depo).** QR Web, KDS, Admin, Kasa ve Garson-PWA aynı projede. QR menü mobil veride 1–2 saniyede açılır. Araç kirası yok; kod baştan sonuna senin.
- **Müşteri App (Faz 4):** Flutter veya React Native — karar o gün verilir, bugün bağlayıcı değil.
- **Ödeme (ileride): iyzico / PayTR** (kartlı online) ve **TR Karekod / FAST** (düşük komisyon). v1'de ödeme entegrasyonu YOK.
- **Fiş / yasal: mevcut Yeni Nesil ÖKC.** v1'de ödeme kasada alındığı için fiş oradan otomatik çıkar.

**Maliyet (başlangıç):** Supabase ücretsiz katman + Vercel ücretsiz katman ≈ 0 TL/ay. Ölçek büyüdükçe Supabase Pro (~$25/ay).

---

## Değişmez İlkeler

1. **İlk günden çok-kiracılı.** Her tablo `cafe_id` taşır; RLS her kafeyi kendi verisine kilitler.
2. **Kendi kafen = canlı laboratuvar.** Gerçek serviste 2 hafta çalışmayan özellik ilerlemez.
3. **Ödeme tamamlanmadan sipariş mutfağa düşmez** (once_odeme modu). Ödeme v1'de kasada, mevcut POS'tan → **ÖKC fişi otomatik, regülasyon sorunu sıfır.** Bonus: ödenmemiş sipariş mutfağa ulaşmadığı için sahte/şaka sipariş riski kökten çözülür.
4. **Ödeme modu kafe başına ayarlanabilir** (`once_odeme` / `acik_hesap`). Sen önce-ödeme ile başlarsın; masaya servis yapan, hesabı sonda kapatan kafeler açık-hesap modunda aynı sisteme katılır.
5. **App = premium katman.** Masadan öde-çık ve sadakat App'e ait; Web insanı yakalar, App sadıklaştırır.
6. **Sadakat modeli: puan/yıldız biriktirme.** Düz indirim bunun özel durumu olarak ifade edilir.

### Ödeme raylarının gerçeği (Faz 4/5 kararı için)
- Apple Pay TR'de yok, Google Pay yaygın değil.
- Kartlı online (iyzico/PayTR): pürüzsüz ama ~%2 komisyon.
- FAST / TR Karekod: ~%0 komisyon ama tek telefonda hantal.
- İkisi aynı anda olmaz → varsayılan kartlı, "hesaptan (FAST) öde → ekstra puan" ile isteyen ucuz raya.

---

## Faz Faz Yol Haritası

### Faz 0 — Temel (Foundation) ✅ kuruldu
- Supabase şeması (çok-kiracılı): `cafe` (odeme_modu ayarı), `bolum`, `masa` (benzersiz QR kodu), `kullanici` (admin/garson/mutfak/musteri), `kategori`, `urun`, `opsiyon_grubu`, `opsiyon`, **`adisyon`**, `siparis` (durum makinesi: odeme_bekliyor → bekliyor → hazirlaniyor → hazir → teslim; + iptal/reddedildi), `siparis_kalemi`, **`masa_oturumu`** (QR token, süre sonu).
- RLS: her kafe kendi verisi; anonim müşteri yalnız menü okur, sipariş yazma güvenli RPC'lerden geçer; **mutfak rolü "ödeme bekliyor" siparişleri hiç görmez.**
- Next.js iskeleti + Supabase bağlantısı; route iskeleti (`/qr`, `/kds`, `/kasa`, `/admin`).
- İlk kiracı = senin kafen: kafe kaydı, bölümler, masalar, QR üretimi.

### Faz 1 — Sipariş Döngüsü ⭐ en kritik faz — ✅ ekranlar kuruldu, sırada kafede canlı test
**QR → sipariş → kasa onayı → mutfak.** Bu döngü oturmadan başka hiçbir şeye geçme.
- **QR Web:** QR okut → masa oturumu açılır → menü → ürün seç + özelleştir → sipariş ver → "Kasada ödeyince hazırlanmaya başlar" ekranı + canlı durum ("hazırlanıyor / hazır").
- **Kasa (minimum):** Ödeme bekleyen siparişler masa numarasıyla listelenir; kasiyer POS'tan tahsil eder, "Ödendi" der → KDS'e düşer.
- **KDS:** Büyük sipariş kartları (masa, ürünler, opsiyonlar, not, saat). Durum butonları: Hazırlanıyor / Hazır / Teslim. **Yeni siparişte sesli uyarı. Realtime koparsa otomatik polling'e düşme.**
- **İptal/red:** Mutfak "ürün bitti" → kalemi reddet + ürünü tek dokunuşla pasife çek (menüden anında düşer). Kasa/garson sipariş iptal edebilir.
- **Kötüye kullanım önlemleri:** masa oturumu (kısa ömürlü token), masa başına dakikada sipariş limiti. (once_odeme zaten ana kalkan.)
- **Admin (minimum):** Kategori/ürün/fiyat/görsel, masa yönetimi, QR indir.
- **Operasyonel:** İnternet tamamen giderse kağıda dönüş prosedürü yazılı olsun.

**Test (kendi kafende, gerçek serviste, 2 hafta):** Müşteri QR'ı okutup sipariş verebiliyor mu? Kasa onayı akışı yavaşlatıyor mu? Menü orta segment Android + mobil veriyle **< 3 saniyede** açılıyor mu? **İnsan ölçütleri:** mutfak yoğun saatte KDS'e mi bakıyor, sözlü teyit mi istiyor? Kasiyer "Ödendi" demeyi unutuyor mu?

### Faz 2 — Kasa Derinliği + Garson PWA — ✅ tamamlandı (2026-07-11)
- **Kasa (tam):** Adisyon görünümü (acik_hesap modu dahil): masanın açık hesabı, kalemler, toplam; "Ödendi" ile kapanış. Sonradan eklenen profesyonel paket (2026-07-11): kalem başına **ikram** (stok düşer, hesaba 0 yazılır) ve iptal, **TL/% iskonto**, **masa taşıma/birleştirme**, **kalem transferi**, **cari hesaplar** (hesabı cariye yazma, tahsilat, bakiye/hareket takibi); raporlara ikram/iskonto/cari kırılımları eklendi.
- **Garson PWA:** Masa haritası (renk kodları: boş/sipariş bekleyen/hesap bekleyen/dolu), masaya manuel sipariş, "X masası hazır" push bildirimi, "garson çağır".
  - *Ön hazırlık:* Web push altyapısı (service worker + bildirim izinleri) bu fazın başında kurulur.
- **Admin genişleme:** Opsiyon yönetimi, stok takibi — iki katmanlı kuruldu: (a) vitrin ürünlerinde adet takibi (stok bitince otomatik pasif), (b) **reçete bazlı hammadde takibi**: hammaddeler (süt/çekirdek), faturadan alış girişi (birim maliyet kaydıyla — Faz 3 kâr analizinin temeli), ürün reçeteleri; siparişte otomatik düşüş, iptalde iade, kritik seviye uyarısı.

**Test:** Tam servis — iki kanal (QR + garson), kasada kapanış. Garsonlar PWA'yı gerçekten kullanıyor mu, yoksa bypass mı ediyor?

### Faz 3 — Yönetim Derinliği — ✅ tamamlandı (2026-07-11)
- Dashboard (Genel Bakış): bugünkü ciro/hesap/ortalama/iptal kartları, anlık durum rozetleri, son 7 gün ciro + saatlik yoğunluk grafikleri, çok satanlar.
- Raporlama: tarih aralığı seçici (bugün/dün/7g/30g/özel), günlük ciro trendi, saatlik yoğunluk, ürün satışları tablosu (**maliyet + kâr + marj** — reçete × hammadde alış fiyatından), iptal/red kayıtları, sipariş kanalı kırılımı.
- Kat/bölüm yönetimi: bölüm ekleme ve yeniden adlandırma (Masalar & QR).
- Ciro tanımı: kapanan hesapların tahsilatı — gün sonu POS Z raporuyla karşılaştırılabilir.

**Test:** Raporlar gerçekle tutuyor mu; kararlarını buradan verebiliyor musun.

### Faz 4 — Müşteri App + Sadakat + Online Ödeme ⚠️ iş burada ciddileşir
- **Native karar:** Flutter vs React Native burada verilir; backend aynı Supabase.
- **Müşteri App:** puan/yıldız barı, ödüller, kafe detay + menü, QR ile masa eşleştirme, sipariş geçmişi + "aynısını tekrar".
- **Sadakat:** `sadakat_hesabi`, `puan_hareketi`, `kampanya` tabloları bu fazda şemaya eklenir. CRM segmentleri.
- **Masadan online ödeme:** kartlı (iyzico/PayTR) ile başla.

> ⚠️ **ÖKC/FİŞ + KVKK — bu fazın giriş kapısı.**
> 1. **ÖKC:** App içi ödemede para POS'tan geçmez → her ödemenin YN ÖKC fişine bağlanması yasal zorunluluk (GMP-3 entegrasyonu). Bu faza girmeden **mali müşavir + banka/PSP** ile: ödeme fişe nasıl bağlanacak, hangi PSP fiş üreten yapıya entegre.
> 2. **KVKK:** Müşteri App kişisel veri toplar → aydınlatma metni, açık rıza, veri saklama süreleri. Mali müşavir görüşmesine KVKK metinlerini de ekle.

**Test:** App indiriliyor mu? Masadan ödeme kasaya tercih ediliyor mu? Fiş her ödemede kesiliyor mu?

### Faz 5 — Optimizasyon & Ölçek
- FAST / TR Karekod: "hesaptan öde → ekstra puan" ile ucuz raya yönlendirme.
- Çoklu kafe: ikinci, üçüncü kafe (multi-tenant zaten hazır).
- Marketplace / Keşfet.
- Garsonu opsiyonelleştir: "Hazır"ı doğrudan komi görür.

---

## Yüz × Faz Haritası

| Yüz \ Faz | Faz 0 | Faz 1 | Faz 2 | Faz 3 | Faz 4 | Faz 5 |
|-----------|:----:|:----:|:----:|:----:|:----:|:----:|
| **Admin** | iskelet | menü/masa/QR | +opsiyon/stok | +dashboard/rapor | +CRM/kampanya | çoklu kafe |
| **KDS** | — | ✅ tam (+ses, +fallback) | — | — | — | — |
| **Kasa** | — | ödeme onayı | ✅ adisyon/kapanış | — | +online ödeme mutabakat | +FAST |
| **QR Web** | QR üret | ✅ tam sipariş + canlı durum | — | — | — | — |
| **Garson (PWA)** | — | — | ✅ tam | — | — | opsiyonel olur |
| **Müşteri App (native)** | — | — | — | — | ✅ tam + sadakat + ödeme | +marketplace |

---

## Kritik Riskler & Uyarılar

- **ÖKC/fiş:** v1'de sorun yok (ödeme kasada). Faz 4'ün giriş kapısı; mali müşavir + PSP + GMP-3 olmadan girme.
- **KVKK:** Faz 4'te Müşteri App ile birlikte zorunlu hale gelir.
- **Personel adaptasyonu (bir numaralı ölüm sebebi):** Teknik değil. Mutfak/garson sisteme güvenmezse kağıda döner ve sistem ölür. Her fazın test kriterlerinde insan ölçütleri var; ciddiye al.
- **Kafe interneti:** Wi-Fi kopması rutin. Realtime→polling fallback yazılımda, kağıda dönüş prosedürü operasyonda hazır olmalı.
- **Ödeme komisyon tradeoff'u:** Ucuz (FAST) ile pürüzsüz (kartlı) aynı anda olmaz; karar Faz 4/5'te.
- **Kapsam kayması:** Marketplace'i erken yapma; tek kafeyle başla.
- **Rekabet notu:** TR'de Adisyo, Menulux gibi hazır adisyon/QR sistemleri var. Kendi kafen + sadakat katmanı için kendi sistemin mantıklı; SaaS olarak satışa karar verirsen önce rekabet analizi yap.
- **Mali/hukuki:** Para akışı, üye işyeri anlaşması, fiş düzeni → mali müşavir/hukuk işi. Erken danış.

---

## Sıradaki Somut Adım

1. ✅ Şema hazır ve canlı Supabase'de kurulu (BUTİKEK + mock menü + 12 masa yüklü).
2. ✅ Faz 1 ekranları kuruldu ve uçtan uca test edildi: QR menü, Kasa (ödeme onayı), KDS, Admin (menü + masalar/QR), personel girişi.
3. Siteyi internete al (Vercel), QR etiketlerini gerçek adresle yazdır.
4. Mock menüyü gerçek BUTİKEK menüsüyle değiştir (Admin panelinden).
5. Kafede canlı teste başla; 2 hafta gerçek serviste dene (insan ölçütleri dahil).
