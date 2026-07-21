-- İstasyonlar: siparişler mutfak / bar / tezgah olarak ayrılır.
-- Her ürün bir istasyona aittir; KDS istasyon bazlı filtrelenir.
-- Kalem bazlı "hazır" işareti: tüm istasyonlar kendi kalemlerini bitirince
-- sipariş otomatik 'hazir' durumuna geçer (garson bildirimi o an gider).

alter table public.urun
  add column if not exists istasyon text not null default 'mutfak';

alter table public.siparis_kalemi
  add column if not exists istasyon text not null default 'mutfak',
  add column if not exists hazir boolean not null default false;

-- Kalem yazılırken ürünün istasyonu kopyalanır (menü sonradan değişse de fiş bozulmaz)
create function public.kalem_istasyon_kopyala() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  select istasyon into new.istasyon from public.urun where id = new.urun_id;
  new.istasyon := coalesce(new.istasyon, 'mutfak');
  return new;
end
$$;

create trigger siparis_kalemi_istasyon
  before insert on public.siparis_kalemi
  for each row execute function public.kalem_istasyon_kopyala();

-- Bir kalem hazır işaretlendiğinde: siparişin (reddedilmemiş) tüm kalemleri
-- hazırsa sipariş 'hazir' durumuna geçer.
create function public.kalem_hazir_kontrol() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if new.hazir and not old.hazir then
    if not exists (
      select 1 from public.siparis_kalemi
      where siparis_id = new.siparis_id and not reddedildi and not hazir
    ) then
      update public.siparis set durum = 'hazir'
      where id = new.siparis_id and durum in ('bekliyor', 'hazirlaniyor');
    end if;
  end if;
  return new;
end
$$;

create trigger siparis_kalemi_hazir
  after update of hazir on public.siparis_kalemi
  for each row execute function public.kalem_hazir_kontrol();

-- Sipariş bütün olarak hazır/teslim işaretlenirse kalemler de hazır sayılır
create function public.siparis_hazir_kalemleri_isaretle() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if new.durum in ('hazir', 'teslim') and old.durum not in ('hazir', 'teslim') then
    update public.siparis_kalemi set hazir = true
    where siparis_id = new.id and not reddedildi and not hazir;
  end if;
  return new;
end
$$;

create trigger siparis_hazir_kalemler
  after update of durum on public.siparis
  for each row execute function public.siparis_hazir_kalemleri_isaretle();
