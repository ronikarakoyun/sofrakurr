import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gizlilik Politikası — SofraKur",
  description: "SofraKur uygulaması ve QR menü hizmeti kişisel verilerin korunması aydınlatma metni",
};

// KVKK aydınlatma metni — App Store / Google Play "privacy policy URL" olarak
// da kullanılır. Hukuki nihai metin mali müşavir/avukat onayından geçmelidir.
export default function GizlilikSayfasi() {
  return (
    <main className="min-h-dvh bg-krem px-5 py-10 text-metin">
      <article className="mx-auto max-w-[720px]">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="SofraKur" className="h-12 w-12 rounded-xl" />
          <div>
            <h1 className="font-serif text-2xl font-semibold text-metin-baslik">
              Gizlilik Politikası ve Aydınlatma Metni
            </h1>
            <p className="text-[13px] text-metin-soluk">Son güncelleme: 19 Temmuz 2026</p>
          </div>
        </div>

        <section className="mt-8 space-y-6 text-[15px] leading-relaxed text-metin-orta">
          <div>
            <h2 className="mb-1.5 text-[17px] font-extrabold text-metin-baslik">1. Veri Sorumlusu</h2>
            <p>
              SofraKur uygulaması ve sofrakur.com üzerinden sunulan QR menü / sipariş
              hizmetleri kapsamında kişisel verileriniz, 6698 sayılı Kişisel Verilerin
              Korunması Kanunu (&quot;KVKK&quot;) uyarınca veri sorumlusu sıfatıyla SofraKur
              işletmecisi tarafından işlenmektedir. İletişim:{" "}
              <a href="mailto:destek@sofrakur.com" className="font-bold text-marka">
                destek@sofrakur.com
              </a>
            </p>
          </div>

          <div>
            <h2 className="mb-1.5 text-[17px] font-extrabold text-metin-baslik">2. İşlenen Veriler</h2>
            <p>
              <strong>Uygulama üyeliğinde:</strong> Google veya Apple hesabınızla giriş
              yaptığınızda ad-soyad ve e-posta adresiniz; kullanım sırasında sipariş
              geçmişiniz, sadakat puanı hareketleriniz ve (izin verirseniz) bildirim
              gönderimi için cihaz tanımlayıcınız işlenir.
              <br />
              <strong>QR menüde (üyeliksiz):</strong> Masadan verdiğiniz siparişin
              içeriği dışında kişisel veri toplanmaz; kimlik bilgisi istenmez.
            </p>
          </div>

          <div>
            <h2 className="mb-1.5 text-[17px] font-extrabold text-metin-baslik">3. İşleme Amaçları</h2>
            <p>
              Veriler; siparişlerinizin alınması ve hazırlanması, sadakat puanlarınızın
              işlenmesi ve ödüllerin kullandırılması, talep ettiğiniz kampanya
              bildirimlerinin gönderilmesi ve hizmetin güvenliğinin sağlanması
              amaçlarıyla, KVKK m.5&apos;teki &quot;sözleşmenin kurulması ve ifası&quot; ile
              &quot;meşru menfaat&quot; hukuki sebeplerine dayanılarak işlenir. Kampanya
              bildirimleri yalnızca cihazınızda bildirim iznini açık tutmanız hâlinde
              gönderilir; izni dilediğiniz an cihaz ayarlarından kapatabilirsiniz.
            </p>
          </div>

          <div>
            <h2 className="mb-1.5 text-[17px] font-extrabold text-metin-baslik">4. Aktarım ve Saklama</h2>
            <p>
              Verileriniz, barındırma hizmeti aldığımız güvenli bulut altyapısında
              (Supabase/Amazon Web Services, Vercel) saklanır; bildirim iletimi için
              Expo bildirim servisi kullanılır. Verileriniz üçüncü kişilere
              satılmaz ve reklam amacıyla paylaşılmaz. Üyelik verileri, hesabınız
              açık kaldığı sürece; sipariş kayıtları ise yasal saklama süreleri
              boyunca muhafaza edilir.
            </p>
          </div>

          <div>
            <h2 className="mb-1.5 text-[17px] font-extrabold text-metin-baslik">5. Haklarınız</h2>
            <p>
              KVKK m.11 kapsamında verilerinize erişme, düzeltme, silme, işlemeye
              itiraz etme ve aktarım talep etme haklarına sahipsiniz. Hesabınızı
              uygulama içinden <strong>Hesabım → Hesabı Sil</strong> adımıyla kalıcı
              olarak silebilirsiniz; silme işleminde üyelik, puan ve cihaz kayıtlarınız
              geri alınamaz şekilde kaldırılır. Diğer talepleriniz için yukarıdaki
              e-posta adresine yazabilirsiniz; başvurular en geç 30 gün içinde
              yanıtlanır.
            </p>
          </div>

          <div>
            <h2 className="mb-1.5 text-[17px] font-extrabold text-metin-baslik">6. Değişiklikler</h2>
            <p>
              Bu metin gerektiğinde güncellenebilir; güncel sürüm her zaman bu adreste
              yayımlanır.
            </p>
          </div>
        </section>

        <p className="mt-10 border-t border-cizgi pt-4 text-center text-[12.5px] text-metin-silik">
          SofraKur · sofrakur.com
        </p>
      </article>
    </main>
  );
}
