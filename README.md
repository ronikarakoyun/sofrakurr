# SofraKur

Çok-kiracılı kafe sipariş ve takip sistemi. **Canlı:** https://sofrakur.vercel.app Yol haritası ve tüm mimari kararlar için: [ROADMAP.md](ROADMAP.md)

**Yığın:** Next.js (tek depo: QR Web + KDS + Kasa + Admin + Garson-PWA) + Supabase (Postgres, RLS, Realtime, Auth).

## Kurulum

### 1. Supabase projesi aç
1. [supabase.com](https://supabase.com) → yeni proje oluştur (bölge: Frankfurt/eu-central en yakını).
2. **SQL Editor**'ü aç, [supabase/migrations/0001_initial_schema.sql](supabase/migrations/0001_initial_schema.sql) dosyasının tamamını yapıştır ve çalıştır.
   - Alternatif (Supabase CLI kuruluysa): `supabase link --project-ref <ref>` sonra `supabase db push`.

### 2. Ortam değişkenleri
```bash
cp .env.example .env.local
```
Supabase Dashboard → **Project Settings → API**'den `Project URL` ve `anon public` anahtarını `.env.local`'e yaz.

### 3. Çalıştır
```bash
npm install
npm run dev
```
http://localhost:3000 → dört yüzün iskeleti listelenir (`/admin`, `/kds`, `/kasa`, `/qr/[kod]`).

## Kendi kafeni ekleme (ilk kiracı)

SQL Editor'de (değerleri kendine göre düzenle):

```sql
insert into public.cafe (ad, slug) values ('Kafem', 'kafem');

insert into public.bolum (cafe_id, ad)
  select id, 'Salon' from public.cafe where slug = 'kafem';

-- 10 masa aç; her masaya benzersiz qr_kod otomatik üretilir
insert into public.masa (cafe_id, bolum_id, ad)
  select c.id, b.id, 'Masa ' || n
  from public.cafe c
  join public.bolum b on b.cafe_id = c.id
  cross join generate_series(1, 10) n
  where c.slug = 'kafem';

-- QR etiketlerine basılacak linkler:
select ad, 'https://SITENIZ/qr/' || qr_kod as qr_link from public.masa order by ad;
```

QR görsellerini herhangi bir QR üreticiyle (veya Faz 1'de Admin panelindeki "QR indir" ile) bu linklerden üret.

### Personel hesabı ekleme
1. Supabase Dashboard → **Authentication → Users** → kullanıcı oluştur (e-posta+şifre).
2. SQL Editor'de rol ata:
```sql
insert into public.kullanici (id, cafe_id, rol, ad)
values (
  '<auth kullanıcı id>',
  (select id from public.cafe where slug = 'kafem'),
  'admin', -- admin | garson | mutfak
  'Adın'
);
```

## Sipariş akışı (özet)

`once_odeme` modu (varsayılan): QR sipariş → **ödeme bekliyor** (mutfak görmez) → kasiyer POS'tan tahsil edip "Ödendi" der → **bekliyor** → KDS'e düşer → hazırlanıyor → hazır → teslim. `acik_hesap` modunda sipariş doğrudan mutfağa düşer, adisyon kasada kapanır. Mod, `cafe.odeme_modu` alanından kafe başına ayarlanır.

Anonim müşteri veritabanına doğrudan yazamaz; yalnız şu RPC'leri çağırır: `masa_oturumu_ac(qr_kod)`, `siparis_olustur(token, kalemler, not)`, `oturum_siparisleri(token)`.

## Termal yazıcı (sipariş fişi)

Siparişler istasyonlara ayrılır (Menü'de ürünün 🍳/🍹/🧁 butonu) ve iki yolla fişe basılır:

**Yol 1 — Tarayıcıdan (USB yazıcı):** KDS'te sağ üstteki **"🖨 oto"** anahtarını aç; yeni sipariş
geldiğinde 80mm fiş otomatik yazdırılır (kartlardaki "🖨 fiş" ile elle de basılır). Diyalog
çıkmadan sessiz basması için Chrome'u şu şekilde başlat:

```bash
# macOS
open -na "Google Chrome" --args --kiosk-printing
# Windows kısayol hedefi sonuna:  --kiosk-printing
```
Yazıcı, sistemde varsayılan yazıcı olarak seçili olmalı (80mm kağıt).

**Yol 2 — Ağ yazıcısı + ajan (önerilen, ekran gerektirmez):** Ethernet/WiFi'li ESC/POS yazıcı
(port 9100) kullan. [araclar/yazici-ajani.mjs](araclar/yazici-ajani.mjs) dosyasının başındaki
`YAZICILAR` eşlemesine istasyon→IP yaz, sonra kafedeki bir bilgisayarda çalıştır:

```bash
YAZICI_SIFRE="personel-şifresi" node araclar/yazici-ajani.mjs
```
Ajan siparişleri canlı dinler; mutfak kalemlerini mutfak yazıcısına, bar kalemlerini bar
yazıcısına basar (Türkçe karakter desteğiyle). Sürekli çalışması için `pm2 start` önerilir.

## Deploy (Faz 1 sonunda)

Vercel'e bağla (ücretsiz katman yeter), env değişkenlerini Vercel'de tanımla. Kendi kafende canlı teste başlamadan önce deploy et — telefonlar localhost'a erişemez.
