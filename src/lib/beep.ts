// Yeni sipariş sesi — dosya gerektirmeden Web Audio ile iki tonlu uyarı.
// Tarayıcılar ses için kullanıcı etkileşimi ister; ekrana ilk dokunuşta açılır.
let ctx: AudioContext | null = null;

export function sesHazirla() {
  if (!ctx && typeof window !== "undefined") {
    ctx = new AudioContext();
  }
  if (ctx?.state === "suspended") ctx.resume();
}

export function yeniSiparisSesi() {
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime;
  [880, 1175].forEach((hz, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.frequency.value = hz;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.001, t + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.3, t + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.18 + 0.16);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(t + i * 0.18);
    osc.stop(t + i * 0.18 + 0.2);
  });
}
