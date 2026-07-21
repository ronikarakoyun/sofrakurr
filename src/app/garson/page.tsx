import { redirect } from "next/navigation";

// Garson ekranı emekli edildi (self-servis modeli): sipariş girme artık
// kasanın "Sipariş" sekmesinde. Eski kısayollar kırılmasın diye rota yönlenir.
export default function GarsonYonlendirme() {
  redirect("/kasa?sekme=siparis");
}
