# Yazıcı Kurulum Kılavuzu (mutfak+tezgah: Xprinter XP-Q805K · bar: KODPOS Kps70)

> ## ⚡ BUTİKEK'in mevcut kurulumu (yazıcılar zaten aktif)
> Hiçbir ağ ayarı DEĞİŞTİRME — mevcut adisyon sistemi bozulmasın. Ajan şuna göre ayarlı:
> - **Mutfak:** 192.168.1.21 (Xprinter, ağ)
> - **Bar:** 192.168.1.20 (KODPOS, ağ) — kurulumda self-test fişiyle teyit et
> - **Tezgah/hesap:** ana bilgisayara USB bağlı Xprinter → aşağıdaki "USB yazıcıyı
>   paylaşıma açma" adımını yap, sonra 3. bölümden devam et.
>
> ### USB yazıcıyı paylaşıma açma (Windows, ~2 dk — mevcut sistemi etkilemez)
> 1. Ayarlar → Bluetooth ve cihazlar → **Yazıcılar ve tarayıcılar** → USB'deki Xprinter'ı seç
> 2. **Yazıcı özellikleri** → **Paylaşım** sekmesi → "Bu yazıcıyı paylaş" ✓ → Paylaşım adı: **TEZGAH** → Tamam
> 3. Denetim Masası → Ağ ve Paylaşım Merkezi → Gelişmiş paylaşım ayarları → "Dosya ve yazıcı paylaşımını aç" ✓
> 4. Test (Komut İstemi'nde): `echo TEST > %TEMP%\t.txt && copy /b %TEMP%\t.txt \\localhost\TEZGAH`
>    → yazıcıdan "TEST" çıkmalı (kağıdı elle ilerletmen gerekebilir, normal).
>
> Eski sistemle SofraKur aynı yazıcıları paylaşır — geçiş döneminde ikisi yan yana çalışır.
> Aşağıdaki 1-2. bölümler yalnız SIFIRDAN kurulan ağ yazıcıları içindir.

Bu kılavuz kafede, yazıcıların başında uygulanır. Takıldığın adımda Claude'a yaz —
ekran başında birlikte bitiririz.

## Gerekenler

- 3 × Xprinter (80mm, Ethernet'li) + güç kabloları
- 3 × Ethernet (internet) kablosu — yazıcıdan modeme/switch'e yetişecek uzunlukta
- Modemde/switch'te 3 boş port (yetmezse ~150 TL'lik 5 portlu switch al)
- Sürekli açık kalacak bilgisayar (ajanın çalışacağı yer)
- 80mm termal kağıt ruloları

## 1. Kafenin ağ aralığını öğren

Bilgisayarda:
- **Windows:** Başlat → `cmd` → `ipconfig` yaz → "IPv4 Address" satırına bak (örn. `192.168.1.34`)
- **Mac:** Sistem Ayarları → Wi-Fi/Ethernet → Ayrıntılar → IP adresi

İlk üç bölüm senin ağın (örn. `192.168.1.x`). Yazıcılara bu ağdan, kullanılmayan üç
numara vereceğiz: **.50 (mutfak), .51 (bar), .52 (tezgah)** — kılavuz bu üçünü varsayar;
ağın farklıysa (örn. `192.168.0.x`) numaraların başını ona göre uyarla ve
`araclar/yazici-ajani.mjs` dosyasındaki `YAZICILAR` bölümüne yaz.

## 2. Yazıcılara IP atama — TEK TEK yap!

> ⚠️ Xprinter'lar fabrikadan hepsi AYNI adresle gelir (genelde `192.168.123.100`).
> Üçünü aynı anda takarsan çakışır — mutlaka sırayla, teki takılıyken ayarla.

Her yazıcı için:

1. Yalnız o yazıcıyı Ethernet kablosuyla bağla ve aç.
2. **Self-test:** Yazıcı kapalıyken FEED (kağıt) tuşunu basılı tut, basılı tutarken aç —
   birkaç saniye sonra ayar fişi basar. Fişte **IP Address** satırını bul.
3. Fişteki IP kafenin ağıyla **aynı aralıktaysa** (örn. 192.168.1.x): sadece not al,
   çakışmasın diye yine de sabitlemek istersen 4. adımı uygula.
4. Fişteki IP `192.168.123.100` gibi **farklı aralıktaysa** IP'yi değiştirmek gerekir.
   En kolay yol Xprinter'ın ayar programı:
   - Bilgisayara **"Xprinter Printer Setting Tool"** indir (xprinter.net → Download)
     ve yazıcıyı geçici olarak **USB ile** bilgisayara bağla.
   - Programda: portu USB seç → **Ethernet/Network ayarları** → IP: `192.168.1.50`
     (bar için .51, tezgah için .52), Subnet: `255.255.255.0`, Gateway: modemin IP'si
     (genelde `192.168.1.1`), **DHCP: Kapalı** → kaydet, yazıcıyı kapat-aç.
   - Self-test'i tekrar bas, yeni IP'yi doğrula.
5. Yazıcının üstüne bantla etiket: **"MUTFAK — 192.168.1.50"** gibi. Sıradakine geç.

## 3. Bilgisayara ajanı kur

1. **Node.js** kur: [nodejs.org](https://nodejs.org) → LTS sürümü indir → kur (hep "İleri").
2. **SofraKur klasörünü** bu bilgisayara kopyala (USB bellekle ya da Claude ile birlikte).
3. Terminal/Komut İstemi aç, klasöre gir ve bir kez:
   ```
   npm install
   ```
4. `araclar/yazici-ajani.mjs` dosyasını Not Defteri ile aç, üstteki `YAZICILAR`
   bölümündeki IP'lerin etiketlerdekiyle aynı olduğunu kontrol et.

## 4. Test — üç yazıcıdan deneme fişi

```
node araclar/yazici-ajani.mjs --test
```

Üç yazıcıdan da "TEST FİŞİ / Türkçe deneme: ğüşıöç" fişi çıkmalı ve kağıt otomatik
kesilmeli. Çıkmayan olursa: kablo takılı mı → self-test'teki IP dosyadakiyle aynı mı →
bilgisayardan `ping 192.168.1.50` cevap veriyor mu?

## 5. Ajanı sürekli çalıştır

Deneme için (terminal açık kaldığı sürece çalışır):
```
YAZICI_SIFRE="mutfak-hesabinin-sifresi" node araclar/yazici-ajani.mjs
```

Kalıcı kurulum (bilgisayar açıldığında kendiliğinden başlasın) — pm2 ile:
```
npm install -g pm2
YAZICI_SIFRE="şifre" pm2 start araclar/yazici-ajani.mjs --name yazici
pm2 save
pm2 startup     # çıkan komutu kopyala-çalıştır (Mac/Linux)
```
Windows'ta `pm2 startup` yerine: `pm2-windows-startup` paketi ya da görev zamanlayıcı —
kurulum günü birlikte yaparız.

## 6. Canlı prova

QR'dan sipariş ver → kasadan "Ödendi" de → mutfak fişi mutfak yazıcısından,
bar kalemleri bar yazıcısından çıkmalı. Ajan penceresinde her baskı loglanır:
`🖨 Salon 1 → mutfak (2 kalem)`

## Sorun giderme

| Belirti | Muhtemel neden |
|---|---|
| Test fişi çıkmıyor | Kablo/IP; `ping` at; yazıcıyı kapat-aç |
| Türkçe karakterler bozuk | Yazıcı firmware'i CP857 desteklemiyor olabilir — modeli Claude'a yaz |
| Fişler tek yazıcıdan çıkıyor | `YAZICILAR` içindeki IP'ler karışmış — etiketlerle karşılaştır |
| Sipariş var, fiş yok | Ajan çalışıyor mu? (`pm2 status`) İnternet var mı? |
