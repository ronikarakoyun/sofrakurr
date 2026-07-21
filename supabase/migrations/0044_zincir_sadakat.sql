-- ============================================================================
-- 0044: Zincir sadakat + zincir kampanyası (Faz 5 — M6)
--
-- Franchise beklentisi: müşteri Arabica Kadıköy'de kazandığı puanı Arabica
-- Beşiktaş'ta harcayabilmeli. Bu yüzden zincire bağlı kafelerde sadakat hesabı
-- KAFE değil ZİNCİR bazlıdır; bağımsız kafelerde (BUTİKEK) bugünkü davranış
-- birebir korunur.
--
-- puan_hareketi.cafe_id İŞLEM ŞUBESİ olarak yazılmaya devam eder — şube bazlı
-- puan raporu bozulmaz.
-- ============================================================================

alter table public.sadakat_hesabi alter column cafe_id drop not null;
alter table public.sadakat_hesabi
  add column zincir_id uuid references public.zincir(id) on delete cascade;
alter table public.sadakat_hesabi
  add constraint sadakat_hesabi_kapsam check (cafe_id is not null or zincir_id is not null);

create unique index sadakat_hesabi_zincir_tekil
  on public.sadakat_hesabi (zincir_id, kullanici_id) where zincir_id is not null;

alter table public.kampanya
  add column zincir_id uuid references public.zincir(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Mevcut kafe hesaplarını zincir hesabında birleştir (zincire bağlı kafeler)
-- Bakiyeler toplanır, hareketler yeni hesaba bağlanır, eski satırlar silinir.
-- Yeni kurulan zincirlerde bu küme boştur — risksiz.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_yeni uuid;
begin
  for r in
    select c.zincir_id, h.kullanici_id, sum(h.puan_bakiye) as bakiye
    from public.sadakat_hesabi h
    join public.cafe c on c.id = h.cafe_id
    where c.zincir_id is not null and h.zincir_id is null
    group by c.zincir_id, h.kullanici_id
  loop
    insert into public.sadakat_hesabi (zincir_id, kullanici_id, puan_bakiye)
    values (r.zincir_id, r.kullanici_id, r.bakiye)
    returning id into v_yeni;

    update public.puan_hareketi p set sadakat_hesabi_id = v_yeni
    where p.sadakat_hesabi_id in (
      select h.id from public.sadakat_hesabi h
      join public.cafe c on c.id = h.cafe_id
      where c.zincir_id = r.zincir_id and h.kullanici_id = r.kullanici_id
        and h.zincir_id is null
    );

    delete from public.sadakat_hesabi h
    using public.cafe c
    where h.cafe_id = c.id and c.zincir_id = r.zincir_id
      and h.kullanici_id = r.kullanici_id and h.zincir_id is null;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Ortak yardımcı: kafenin sadakat hesabını bulur/açar.
-- Kafe bir zincire bağlıysa ZİNCİR hesabı, değilse kafe hesabı.
-- ---------------------------------------------------------------------------
create function public.sadakat_hesap_bul(p_cafe_id uuid, p_kullanici_id uuid)
returns uuid
language plpgsql security definer set search_path = public as
$$
declare
  v_zincir uuid;
  v_id uuid;
begin
  select zincir_id into v_zincir from public.cafe where id = p_cafe_id;

  if v_zincir is not null then
    insert into public.sadakat_hesabi (zincir_id, kullanici_id)
    values (v_zincir, p_kullanici_id)
    on conflict (zincir_id, kullanici_id) where zincir_id is not null do nothing;
    select id into v_id from public.sadakat_hesabi
      where zincir_id = v_zincir and kullanici_id = p_kullanici_id;
  else
    insert into public.sadakat_hesabi (cafe_id, kullanici_id)
    values (p_cafe_id, p_kullanici_id)
    on conflict (cafe_id, kullanici_id) do nothing;
    select id into v_id from public.sadakat_hesabi
      where cafe_id = p_cafe_id and kullanici_id = p_kullanici_id;
  end if;
  return v_id;
end
$$;

revoke execute on function public.sadakat_hesap_bul(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Personel, kendi kafesinin zincir hesabını da görebilmeli (RLS)
-- ---------------------------------------------------------------------------
drop policy if exists sadakat_hesabi_personel on public.sadakat_hesabi;
create policy sadakat_hesabi_personel on public.sadakat_hesabi
  for select using (
    cafe_id = public.aktif_cafe_id()
    or (zincir_id is not null and zincir_id = (
      select c.zincir_id from public.cafe c where c.id = public.aktif_cafe_id()
    ))
  );

-- ---------------------------------------------------------------------------
-- Puan işleme: 0038 gövdesi + hesap bulma bloğu sadakat_hesap_bul'a çevrildi
-- ---------------------------------------------------------------------------
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

  v_hesap_id := public.sadakat_hesap_bul(v_cafe.id, v_musteri.id);

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

-- ---------------------------------------------------------------------------
-- Ödül kullanımı: hesap zincir genelinde bulunur (A'da kazan, B'de harca)
-- ---------------------------------------------------------------------------
create or replace function public.odul_kullan(p_musteri_kod text, p_odul_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  v_cafe_id uuid;
  v_musteri public.kullanici%rowtype;
  v_odul public.odul%rowtype;
  v_hesap_id uuid;
  v_mevcut int;
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

  v_hesap_id := public.sadakat_hesap_bul(v_cafe_id, v_musteri.id);
  select puan_bakiye into v_mevcut from public.sadakat_hesabi where id = v_hesap_id;
  if coalesce(v_mevcut, 0) < v_odul.puan_bedeli then
    raise exception 'Puan yetersiz (bakiye: %, gereken: %)',
      coalesce(v_mevcut, 0), v_odul.puan_bedeli;
  end if;

  insert into public.puan_hareketi
    (cafe_id, sadakat_hesabi_id, odul_id, tur, puan, aciklama, olusturan_id)
  values
    (v_cafe_id, v_hesap_id, v_odul.id, 'harcama', -v_odul.puan_bedeli,
     'Ödül: ' || v_odul.ad, auth.uid());

  update public.sadakat_hesabi
    set puan_bakiye = puan_bakiye - v_odul.puan_bedeli
    where id = v_hesap_id
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
-- Yönetici puan düzeltmesi: aynı hesap bulma kuralı (0033 gövdesi)
-- ---------------------------------------------------------------------------
create or replace function public.puan_duzelt(p_musteri_kod text, p_puan int, p_aciklama text default null)
returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  v_cafe_id uuid;
  v_musteri public.kullanici%rowtype;
  v_hesap_id uuid;
  v_bakiye int;
begin
  if not public.rol_var(array['admin']::public.kullanici_rol[]) then
    raise exception 'Bu işlem için yönetici yetkisi gerekli';
  end if;
  if p_puan = 0 then
    raise exception 'Puan 0 olamaz';
  end if;
  v_cafe_id := public.aktif_cafe_id();

  select * into v_musteri from public.kullanici
    where musteri_kod = upper(trim(p_musteri_kod)) and rol = 'musteri' and aktif;
  if not found then
    raise exception 'Müşteri kodu bulunamadı: %', upper(trim(p_musteri_kod));
  end if;

  v_hesap_id := public.sadakat_hesap_bul(v_cafe_id, v_musteri.id);
  select puan_bakiye into v_bakiye from public.sadakat_hesabi where id = v_hesap_id;

  if v_bakiye + p_puan < 0 then
    raise exception 'Bakiye eksiye düşemez (mevcut: %, istenen: %)', v_bakiye, p_puan;
  end if;

  insert into public.puan_hareketi
    (cafe_id, sadakat_hesabi_id, tur, puan, aciklama, olusturan_id)
  values
    (v_cafe_id, v_hesap_id, 'duzeltme', p_puan,
     coalesce(nullif(trim(p_aciklama), ''), 'Yönetici düzeltmesi'), auth.uid());

  update public.sadakat_hesabi
    set puan_bakiye = puan_bakiye + p_puan
    where id = v_hesap_id
    returning puan_bakiye into v_bakiye;

  return jsonb_build_object(
    'musteri_ad', v_musteri.ad,
    'islenen', p_puan,
    'yeni_bakiye', v_bakiye
  );
end
$$;

-- ---------------------------------------------------------------------------
-- musteri_ozet: hesap adı zincirse zincir adı, değilse kafe adı
-- ---------------------------------------------------------------------------
create or replace function public.musteri_ozet() returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  v_kayit public.kullanici%rowtype;
begin
  select * into v_kayit from public.kullanici
    where id = auth.uid() and rol = 'musteri' and aktif;
  if not found then
    raise exception 'Müşteri kaydı bulunamadı';
  end if;

  return jsonb_build_object(
    'ad', v_kayit.ad,
    'musteri_kod', v_kayit.musteri_kod,
    'hesaplar', coalesce((
      select jsonb_agg(jsonb_build_object(
        'cafe_id', h.cafe_id,
        'cafe_ad', coalesce(z.ad, c.ad),
        'puan_bakiye', h.puan_bakiye
      ) order by h.created_at)
      from public.sadakat_hesabi h
      left join public.cafe c on c.id = h.cafe_id
      left join public.zincir z on z.id = h.zincir_id
      where h.kullanici_id = v_kayit.id
    ), '[]'::jsonb),
    'hareketler', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
          'cafe_ad', c.ad,
          'tur', p.tur,
          'puan', p.puan,
          'aciklama', p.aciklama,
          'tarih', p.created_at
        ) as x
        from public.puan_hareketi p
        join public.sadakat_hesabi h on h.id = p.sadakat_hesabi_id
        join public.cafe c on c.id = p.cafe_id
        where h.kullanici_id = v_kayit.id
        order by p.created_at desc
        limit 20
      ) son
    ), '[]'::jsonb)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Zincir kampanyası: franchise/süper admin zincir geneline kampanya yazabilir
-- (kafe kampanyası bugünkü gibi admin policy'sinden yönetilir)
-- ---------------------------------------------------------------------------
create policy kampanya_zincir on public.kampanya
  for all
  using (
    zincir_id is not null and zincir_id = (
      select u.zincir_id from public.kullanici u
      where u.id = auth.uid() and u.aktif and u.rol = 'franchise'
    )
  )
  with check (
    zincir_id is not null and zincir_id = (
      select u.zincir_id from public.kullanici u
      where u.id = auth.uid() and u.aktif and u.rol = 'franchise'
    )
  );

-- Zincir kampanyası için hedef kitle sayısı (gönderim öncesi bilgi)
create function public.zincir_kampanya_uye_sayisi(p_zincir_id uuid default null)
returns int
language plpgsql stable security definer set search_path = public as
$$
declare
  v_zincir uuid := public._zincir_yetki(p_zincir_id);
begin
  return (select count(*) from public.sadakat_hesabi where zincir_id = v_zincir);
end
$$;

grant execute on function public.zincir_kampanya_uye_sayisi(uuid) to authenticated;
