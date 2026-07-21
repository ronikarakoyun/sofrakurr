-- ============================================================================
-- 0038: Self-servis dönüşümü — zincir (franchise), süper admin, kasa yetkileri
-- ÖNCE 0037 tek başına Run'lanmış olmalı (yeni rol değerleri).
--
-- Mimari numara: tüm RLS politikaları aktif_cafe_id()/aktif_rol() üzerinden
-- çalışır. Bu iki fonksiyon "seçili kafe" destekli hale getirilir; böylece
-- franchise ve super_admin, kafe seçtiğinde HİÇBİR policy değişmeden o
-- kafenin admin'i gibi çalışır (impersonate dahil).
--
-- Garson rolü emekli edilir: mevcut garson hesapları kasaya çevrilir
-- (self-servis modeli — sipariş girme kasada). Tarihsel kayıtlar bozulmaz.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Zincir (franchise) yapısı
-- ---------------------------------------------------------------------------
create table public.zincir (
  id         uuid primary key default gen_random_uuid(),
  ad         text not null,
  created_at timestamptz not null default now()
);

alter table public.cafe
  add column zincir_id uuid references public.zincir(id) on delete set null;

alter table public.kullanici
  add column zincir_id uuid references public.zincir(id) on delete set null,
  add column secili_cafe_id uuid references public.cafe(id) on delete set null,
  add column yetkiler jsonb; -- kasa hesapları için anahtar/kapama; null = hepsi açık

-- franchise ve super_admin kafeye bağlı olmak zorunda değil
alter table public.kullanici drop constraint if exists kullanici_check;
alter table public.kullanici add constraint kullanici_check
  check (rol in ('musteri', 'franchise', 'super_admin') or cafe_id is not null);

alter table public.zincir enable row level security;
-- zincir kayıtları yalnız süper admin RPC'leri/servis ile yönetilir (policy yok)
revoke all on public.zincir from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Çekirdek yardımcılar: seçili kafe destekli bağlam
-- ---------------------------------------------------------------------------
create or replace function public.aktif_cafe_id() returns uuid
language sql stable security definer set search_path = public as
$$
  select case
    when u.rol = 'super_admin' then u.secili_cafe_id
    when u.rol = 'franchise' then (
      select c.id from public.cafe c
      where c.id = u.secili_cafe_id
        and u.zincir_id is not null
        and c.zincir_id = u.zincir_id
    )
    else u.cafe_id
  end
  from public.kullanici u
  where u.id = auth.uid() and u.aktif
$$;

-- franchise/super_admin, seçili kafe bağlamında 'admin' sayılır
create or replace function public.aktif_rol() returns public.kullanici_rol
language sql stable security definer set search_path = public as
$$
  select case
    when u.rol in ('franchise', 'super_admin') then 'admin'::public.kullanici_rol
    else u.rol
  end
  from public.kullanici u
  where u.id = auth.uid() and u.aktif
$$;

-- Panel guard'ları için maskesiz rol
create function public.gercek_rol() returns public.kullanici_rol
language sql stable security definer set search_path = public as
$$ select rol from public.kullanici where id = auth.uid() and aktif $$;

-- Kasa hesabı yetki anahtarı: admin (ve maskeli admin) her zaman izinli;
-- kasa için yetkiler->>kod false değilse izinli (null = açık, geriye uyumlu)
create function public.yetki_var(p_kod text) returns boolean
language sql stable security definer set search_path = public as
$$
  select case
    when public.aktif_rol() = 'admin' then true
    else coalesce((
      select coalesce((u.yetkiler ->> p_kod)::boolean, true)
      from public.kullanici u where u.id = auth.uid() and u.aktif
    ), false)
  end
$$;

-- ---------------------------------------------------------------------------
-- Panel RPC'leri: kafe seçimi + erişilebilir kafeler
-- ---------------------------------------------------------------------------
create function public.kafe_sec_panel(p_cafe_id uuid) returns void
language plpgsql security definer set search_path = public as
$$
declare
  v_rol public.kullanici_rol := public.gercek_rol();
begin
  if v_rol not in ('franchise', 'super_admin') then
    raise exception 'Bu işlem için franchise veya platform yöneticisi girişi gerekli';
  end if;
  if v_rol = 'franchise' and not exists (
    select 1 from public.cafe c
    join public.kullanici u on u.id = auth.uid()
    where c.id = p_cafe_id and c.zincir_id = u.zincir_id and u.zincir_id is not null
  ) then
    raise exception 'Bu kafe zincirinize bağlı değil';
  end if;
  if not exists (select 1 from public.cafe where id = p_cafe_id) then
    raise exception 'Kafe bulunamadı';
  end if;
  update public.kullanici set secili_cafe_id = p_cafe_id where id = auth.uid();
end
$$;

grant execute on function public.kafe_sec_panel(uuid) to authenticated;

create function public.erisilebilir_kafeler()
returns table (id uuid, ad text, slug text, aktif boolean, zincir_ad text, secili boolean)
language sql stable security definer set search_path = public as
$$
  select c.id, c.ad, c.slug, c.aktif, z.ad,
         (c.id = u.secili_cafe_id)
  from public.cafe c
  left join public.zincir z on z.id = c.zincir_id
  join public.kullanici u on u.id = auth.uid() and u.aktif
  where u.rol = 'super_admin'
     or (u.rol = 'franchise' and u.zincir_id is not null and c.zincir_id = u.zincir_id)
  order by c.ad
$$;

grant execute on function public.erisilebilir_kafeler() to authenticated;

-- ---------------------------------------------------------------------------
-- Kasa yetkilerinin sunucu tarafı uygulaması (para-kritik alanlar)
--   gunsonu   → gider + gun_sonu yazma
--   tedarikci → tedarikçi belgesi + stok girişi + malzeme kartı
--   odul      → ödül kullanımı (puan düşme)
-- ---------------------------------------------------------------------------
drop policy if exists gider_kasa on public.gider;
create policy gider_kasa on public.gider
  for all
  using (cafe_id = public.aktif_cafe_id()
         and public.rol_var(array['admin','kasa']::public.kullanici_rol[])
         and public.yetki_var('gunsonu'))
  with check (cafe_id = public.aktif_cafe_id()
              and public.rol_var(array['admin','kasa']::public.kullanici_rol[])
              and public.yetki_var('gunsonu'));

drop policy if exists gun_sonu_kasa on public.gun_sonu;
create policy gun_sonu_kasa on public.gun_sonu
  for all
  using (cafe_id = public.aktif_cafe_id()
         and public.rol_var(array['admin','kasa']::public.kullanici_rol[])
         and public.yetki_var('gunsonu'))
  with check (cafe_id = public.aktif_cafe_id()
              and public.rol_var(array['admin','kasa']::public.kullanici_rol[])
              and public.yetki_var('gunsonu'));

drop policy if exists tedarikci_fatura_kasa on public.tedarikci_fatura;
create policy tedarikci_fatura_kasa on public.tedarikci_fatura
  for all
  using (cafe_id = public.aktif_cafe_id()
         and public.rol_var(array['admin','kasa']::public.kullanici_rol[])
         and public.yetki_var('tedarikci'))
  with check (cafe_id = public.aktif_cafe_id()
              and public.rol_var(array['admin','kasa']::public.kullanici_rol[])
              and public.yetki_var('tedarikci'));

drop policy if exists hammadde_yaz on public.hammadde;
create policy hammadde_yaz on public.hammadde
  for all
  using (cafe_id = public.aktif_cafe_id()
         and public.rol_var(array['admin','kasa']::public.kullanici_rol[])
         and public.yetki_var('tedarikci'))
  with check (cafe_id = public.aktif_cafe_id()
              and public.rol_var(array['admin','kasa']::public.kullanici_rol[])
              and public.yetki_var('tedarikci'));

drop policy if exists hammadde_giris_yaz on public.hammadde_giris;
create policy hammadde_giris_yaz on public.hammadde_giris
  for all
  using (cafe_id = public.aktif_cafe_id()
         and public.rol_var(array['admin','kasa']::public.kullanici_rol[])
         and public.yetki_var('tedarikci'))
  with check (cafe_id = public.aktif_cafe_id()
              and public.rol_var(array['admin','kasa']::public.kullanici_rol[])
              and public.yetki_var('tedarikci'));

-- Sadakat RPC'lerinde garson kalkar; ödül kullanımı yetkiye bağlanır
create or replace function public.sadakat_puan_isle(p_adisyon_id uuid, p_musteri_kod text)
returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  v_cafe public.cafe%rowtype;
  v_musteri public.kullanici%rowtype;
  v_hesap_id uuid;
  v_tutar numeric(10,2);
  v_puan int;
  v_bakiye int;
begin
  if not public.rol_var(array['admin','kasa']::public.kullanici_rol[]) then
    raise exception 'Bu işlem için kasa yetkisi gerekli';
  end if;

  select * into v_cafe from public.cafe where id = public.aktif_cafe_id();
  if not v_cafe.sadakat_aktif then
    raise exception 'Sadakat programı bu kafede kapalı';
  end if;

  select tutar into v_tutar from public.adisyon_tutarlari
    where adisyon_id = p_adisyon_id and cafe_id = v_cafe.id;
  if v_tutar is null then
    raise exception 'Adisyon bulunamadı';
  end if;
  if v_tutar <= 0 then
    raise exception 'Bu hesabın puanlanacak tutarı yok';
  end if;

  select * into v_musteri from public.kullanici
    where musteri_kod = upper(trim(p_musteri_kod)) and rol = 'musteri' and aktif;
  if not found then
    raise exception 'Müşteri kodu bulunamadı: %', upper(trim(p_musteri_kod));
  end if;

  insert into public.sadakat_hesabi (cafe_id, kullanici_id)
  values (v_cafe.id, v_musteri.id)
  on conflict (cafe_id, kullanici_id) do nothing;

  select id into v_hesap_id from public.sadakat_hesabi
    where cafe_id = v_cafe.id and kullanici_id = v_musteri.id;

  v_puan := floor(v_tutar * v_cafe.puan_carpani);
  if v_puan <= 0 then
    raise exception 'Bu tutar için puan oluşmuyor';
  end if;

  begin
    insert into public.puan_hareketi
      (cafe_id, sadakat_hesabi_id, adisyon_id, tur, puan, aciklama, olusturan_id)
    values
      (v_cafe.id, v_hesap_id, p_adisyon_id, 'kazanim', v_puan,
       'Hesap: ' || v_tutar || ' TL', auth.uid());
  exception when unique_violation then
    raise exception 'Bu hesaba puan zaten işlenmiş';
  end;

  update public.sadakat_hesabi
    set puan_bakiye = puan_bakiye + v_puan
    where id = v_hesap_id
    returning puan_bakiye into v_bakiye;

  return jsonb_build_object(
    'musteri_ad', v_musteri.ad,
    'kazanilan', v_puan,
    'yeni_bakiye', v_bakiye
  );
end
$$;

create or replace function public.odul_kullan(p_musteri_kod text, p_odul_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  v_cafe_id uuid;
  v_musteri public.kullanici%rowtype;
  v_odul public.odul%rowtype;
  v_hesap public.sadakat_hesabi%rowtype;
  v_bakiye int;
begin
  if not public.rol_var(array['admin','kasa']::public.kullanici_rol[]) then
    raise exception 'Bu işlem için kasa yetkisi gerekli';
  end if;
  if not public.yetki_var('odul') then
    raise exception 'Ödül kullanma yetkiniz kapalı — yöneticinize başvurun';
  end if;
  v_cafe_id := public.aktif_cafe_id();

  select * into v_odul from public.odul
    where id = p_odul_id and cafe_id = v_cafe_id and aktif;
  if not found then
    raise exception 'Ödül bulunamadı veya pasif';
  end if;

  select * into v_musteri from public.kullanici
    where musteri_kod = upper(trim(p_musteri_kod)) and rol = 'musteri' and aktif;
  if not found then
    raise exception 'Müşteri kodu bulunamadı: %', upper(trim(p_musteri_kod));
  end if;

  select * into v_hesap from public.sadakat_hesabi
    where cafe_id = v_cafe_id and kullanici_id = v_musteri.id;
  if not found or v_hesap.puan_bakiye < v_odul.puan_bedeli then
    raise exception 'Puan yetersiz (bakiye: %, gereken: %)',
      coalesce(v_hesap.puan_bakiye, 0), v_odul.puan_bedeli;
  end if;

  insert into public.puan_hareketi
    (cafe_id, sadakat_hesabi_id, odul_id, tur, puan, aciklama, olusturan_id)
  values
    (v_cafe_id, v_hesap.id, v_odul.id, 'harcama', -v_odul.puan_bedeli,
     'Ödül: ' || v_odul.ad, auth.uid());

  update public.sadakat_hesabi
    set puan_bakiye = puan_bakiye - v_odul.puan_bedeli
    where id = v_hesap.id
    returning puan_bakiye into v_bakiye;

  return jsonb_build_object(
    'musteri_ad', v_musteri.ad,
    'odul_ad', v_odul.ad,
    'harcanan', v_odul.puan_bedeli,
    'yeni_bakiye', v_bakiye
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Garson rolü emekli: mevcut garson hesapları kasaya çevrilir
-- (ad/fiş geçmişi aynen kalır; yetkiler admin tarafından kısılabilir)
-- ---------------------------------------------------------------------------
update public.kullanici set rol = 'kasa' where rol = 'garson';

-- ---------------------------------------------------------------------------
-- Platform sahibi: mevcut yönetici hesabı süper admin olur
-- (BUTİKEK seçili başlar; /panel'den tüm kafelere geçebilir)
-- ---------------------------------------------------------------------------
update public.kullanici
set rol = 'super_admin', secili_cafe_id = cafe_id
where id = (select id from auth.users where email = 'admin@butikek.com');
