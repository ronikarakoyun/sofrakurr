// SofraKur service worker — personel push bildirimleri (KDS)
self.addEventListener("push", (event) => {
  let veri = { baslik: "SofraKur", govde: "" };
  try {
    veri = event.data.json();
  } catch {
    veri.govde = event.data ? event.data.text() : "";
  }
  event.waitUntil(
    self.registration.showNotification(veri.baslik, {
      body: veri.govde,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      vibrate: [200, 100, 200],
      tag: veri.tag || "sofrakur",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((liste) => {
      // Açık bir SofraKur sekmesi varsa ona odaklan; yoksa mutfak ekranını aç
      // (kasa ekranı emekli edildi — bildirimi alan personel KDS'te).
      const acik = liste.find((c) => c.url.includes("/kds"));
      if (acik) return acik.focus();
      if (liste.length) return liste[0].focus();
      return clients.openWindow("/kds");
    })
  );
});
