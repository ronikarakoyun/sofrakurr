import { redirect } from "next/navigation";

// Gün Sonu artık kasa ekranının bir sekmesi — eski adres oraya yönlenir
// (telefon/masaüstü kısayolları ve yer imleri kırılmasın diye rota duruyor).
export default function GunSonuYonlendirme() {
  redirect("/kasa?sekme=gunsonu");
}
