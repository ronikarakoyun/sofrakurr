-- Webhook gizli anahtarını git'ten çıkar: artık kod/migration'da açık metin
-- yok, DB'deki app_ayar tablosunda tutulur. Tabloda RLS var ve HİÇBİR politika
-- yok → anon/authenticated erişemez; yalnız security definer fonksiyonlar okur.
--
-- KURULUM: Bu migration'ı çalıştırdıktan sonra gerçek anahtarı ayrıca girin:
--   update public.app_ayar set deger = '<yeni-secret>' where anahtar = 'webhook_secret';
-- ve aynı değeri Vercel'de WEBHOOK_SECRET ortam değişkenine yazın.

create table if not exists public.app_ayar (
  anahtar text primary key,
  deger   text not null
);
alter table public.app_ayar enable row level security;
-- Bilinçli olarak hiç policy yok: sadece SECURITY DEFINER fonksiyonlar erişir.

insert into public.app_ayar (anahtar, deger)
values ('webhook_secret', 'DEGISTIRILECEK')
on conflict (anahtar) do nothing;

-- Push tetikleyici fonksiyonu: sabit anahtar yerine tablodan okur
create or replace function public.yeni_siparis_push() returns trigger
language plpgsql security definer set search_path = public as
$$
declare
  v_secret text;
begin
  if new.durum = 'odeme_bekliyor' then
    select deger into v_secret from public.app_ayar where anahtar = 'webhook_secret';
    perform net.http_post(
      url := 'https://sofrakur.com/api/push/siparis',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', coalesce(v_secret, '')
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
