-- Yeni müşteri siparişi push bildirimi: QR'dan onay bekleyen sipariş düştüğü
-- anda veritabanı, sitenin push uç noktasına haber verir; o da kafedeki abone
-- cihazlara (garson telefonları) bildirim basar. Ekran kapalıyken de çalışır.

-- pg_net: Postgres'ten HTTP isteği atma eklentisi (Supabase'de hazır gelir)
do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net kurulamadı (yerel test ortamı olabilir): %', sqlerrm;
end
$$;

create or replace function public.yeni_siparis_push() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  -- yalnız müşteri (QR) siparişleri: personel siparişi 'bekliyor' ile doğar
  if new.durum = 'odeme_bekliyor' then
    perform net.http_post(
      url := 'https://sofrakur.com/api/push/siparis',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', 'DEGISTIRILECEK'
      ),
      body := jsonb_build_object(
        'siparis_id', new.id,
        'cafe_id', new.cafe_id,
        'masa_id', new.masa_id
      )
    );
  end if;
  return new;
end
$$;

drop trigger if exists siparis_push on public.siparis;
create trigger siparis_push
  after insert on public.siparis
  for each row execute function public.yeni_siparis_push();
