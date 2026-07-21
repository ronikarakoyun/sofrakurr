-- ============================================================================
-- 0042: Müşteriye "siparişin hazır" push'u (Faz 5 — M4)
--
-- Sipariş 'hazir' durumuna geçtiğinde (KDS "Hazır ✓" ya da kasa numara
-- şeridi) sipariş uygulamadan verilmişse (musteri_id dolu) müşterinin
-- telefonuna Expo push düşer: "Siparişin hazır · #N".
--
-- Desen 0020/0024 ile aynı: pg_net → sitenin webhook uç noktası; secret
-- app_ayar'dan okunur (personel push'una dokunulmaz — o ayrı hat).
-- Kasadan girilen (musteri_id null) siparişte push atılmaz.
-- ============================================================================

create or replace function public.siparis_hazir_push() returns trigger
language plpgsql security definer set search_path = public as
$$
declare
  v_secret text;
begin
  if new.durum = 'hazir'
     and old.durum is distinct from 'hazir'
     and new.musteri_id is not null then
    select deger into v_secret from public.app_ayar where anahtar = 'webhook_secret';
    perform net.http_post(
      url := 'https://sofrakur.com/api/push/hazir',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', coalesce(v_secret, '')
      ),
      body := jsonb_build_object(
        'siparis_id', new.id,
        'cafe_id', new.cafe_id,
        'musteri_id', new.musteri_id,
        'siparis_no', new.siparis_no
      )
    );
  end if;
  return new;
end
$$;

drop trigger if exists siparis_hazir_bildir on public.siparis;
create trigger siparis_hazir_bildir
  after update of durum on public.siparis
  for each row execute function public.siparis_hazir_push();
