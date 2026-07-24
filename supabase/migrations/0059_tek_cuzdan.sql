-- ============================================================================
-- 0059 — Tek cüzdan sadakat: puan = para (Faz 7 M5)
--
-- Kilitli kararlar:
--   * 1 TL = 1 puan (teslimde otomatik kazanılır; kasada kod okutma yok)
--   * 10 puan = 1 TL (uygulamada sipariş verirken indirim olarak harcanır)
--   * TEK CÜZDAN: puan tüm SofraKur kafelerinde geçer (kafe/zincir hesabı yok)
--   * Ödül kataloğu kalkar (tek kural kalır)
--
-- MAHSUPLAŞMA DEFTERİ: puan_hareketi.cafe_id işlem şubesi olarak yazılmaya
-- devam eder — "A kafesinde kazanıldı, B'de harcandı" dökümü komisyon sistemi
-- geldiğinde kafeler arası mahsuplaşmanın kaynağıdır. SİLİNMEZ.
--
-- GERİYE UYUMLULUK (eski app sürümleri):
--   * musteri_siparis_olustur: p_puan DEFAULT 0 → eski 3 parametreli çağrı çalışır
--   * musteri_ozet: 'hesaplar' anahtarı tek sentetik satırla korunur (0060'ta kalkar)
--   * odul TABLOSU şimdilik durur (içi boşaltılır) — eski app ana ekranı ödül
--     listesini sorguluyor; tablo 0060'ta (app güncellemesi yayılınca) düşer
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Cüzdan konsolidasyonu: kullanıcı başına TEK satır.
--    Bakiyeler toplanır, hareketler hedef hesaba bağlanır, fazlalıklar silinir.
-- ---------------------------------------------------------------------------
-- Önce zincir_id'ye bağımlı personel policy'si düşer (kolon drop'u engellemesin;
-- kasa ekranı kalktı — cüzdanı yalnız sahibi ve DEFINER RPC'ler okur)
drop policy if exists sadakat_hesabi_personel on public.sadakat_hesabi;

do $$
declare
  r record;
  v_hedef uuid;
begin
  for r in
    select kullanici_id, sum(puan_bakiye) as bakiye
    from public.sadakat_hesabi
    group by kullanici_id
    having count(*) > 1
  loop
    select id into v_hedef from public.sadakat_hesabi
      where kullanici_id = r.kullanici_id
      order by created_at, id
      limit 1;

    update public.puan_hareketi set sadakat_hesabi_id = v_hedef
      where sadakat_hesabi_id in (
        select id from public.sadakat_hesabi
        where kullanici_id = r.kullanici_id and id <> v_hedef);

    delete from public.sadakat_hesabi
      where kullanici_id = r.kullanici_id and id <> v_hedef;

    update public.sadakat_hesabi set puan_bakiye = r.bakiye where id = v_hedef;
  end loop;
end $$;

-- kapsam kolonları düşer (bağlı check/unique/index/FK'ler kolonla birlikte gider)
alter table public.sadakat_hesabi drop column cafe_id;
alter table public.sadakat_hesabi drop column zincir_id;
alter table public.sadakat_hesabi
  add constraint sadakat_hesabi_kullanici_tekil unique (kullanici_id);

-- ---------------------------------------------------------------------------
-- 2) Ödül makinesi + çarpan kalkar (tek kural: 1₺=1p · 10p=1₺)
-- ---------------------------------------------------------------------------
drop function if exists public.odul_kullan(text, uuid, uuid);
drop function if exists public.sadakat_puan_isle(uuid, text);
drop function if exists public.sadakat_hesap_bul(uuid, uuid);
alter table public.puan_hareketi drop column odul_id;
alter table public.cafe drop column puan_carpani;

-- odul tablosu: içi boşalır, admin yazamaz olur; eski app'in SELECT'i boş liste
-- görür (tablo 0060'ta düşecek)
delete from public.odul;
drop policy if exists odul_admin on public.odul;

-- ---------------------------------------------------------------------------
-- 3) sadakat_hesap_bul v2: platform cüzdanını bulur/açar (yalnız DEFINER içi)
-- ---------------------------------------------------------------------------
create function public.sadakat_hesap_bul(p_kullanici_id uuid)
returns uuid
language plpgsql security definer set search_path = public as
$$
declare
  v_id uuid;
begin
  insert into public.sadakat_hesabi (kullanici_id)
  values (p_kullanici_id)
  on conflict (kullanici_id) do nothing;
  select id into v_id from public.sadakat_hesabi where kullanici_id = p_kullanici_id;
  return v_id;
end
$$;

revoke execute on function public.sadakat_hesap_bul(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Kazanım: teslimde otomatik. adisyon_teslimde_kapat (0057) genişler —
--    adisyonu kapatır + müşterili siparişte floor(net tutar) puan yazar.
--    Net tutar iskonto (puan indirimi) SONRASI → puan-üstüne-puan oluşmaz.
--    puan_tek_kazanim unique guard'ı (adisyon_id) çift kazanımı keser.
-- ---------------------------------------------------------------------------
create or replace function public.adisyon_teslimde_kapat() returns trigger
language plpgsql security definer set search_path = public as
$$
declare
  v_tutar numeric(10,2);
  v_puan int;
  v_hesap uuid;
begin
  if new.adisyon_id is null then
    return null;
  end if;

  update public.adisyon a
     set durum = 'odendi', odeme_turu = 'harici', kapanis = now()
   where a.id = new.adisyon_id
     and a.durum = 'acik'
     and not exists (
       select 1 from public.siparis s
        where s.adisyon_id = a.id
          and s.id <> new.id
          and s.durum not in ('teslim', 'iptal', 'reddedildi'));

  -- kapanış bu teslimle olduysa ve sipariş uygulama müşterisininse: puan kazan
  if found and new.musteri_id is not null then
    if exists (select 1 from public.cafe c where c.id = new.cafe_id and c.sadakat_aktif) then
      select tutar into v_tutar from public.adisyon_tutarlari
        where adisyon_id = new.adisyon_id;
      v_puan := floor(coalesce(v_tutar, 0));
      if v_puan > 0 then
        v_hesap := public.sadakat_hesap_bul(new.musteri_id);
        begin
          insert into public.puan_hareketi
            (cafe_id, sadakat_hesabi_id, adisyon_id, tur, puan, aciklama)
          values
            (new.cafe_id, v_hesap, new.adisyon_id, 'kazanim', v_puan,
             'Sipariş' || coalesce(' #' || new.siparis_no, '') || ' · ' || v_tutar || ' TL');
          update public.sadakat_hesabi
            set puan_bakiye = puan_bakiye + v_puan
            where id = v_hesap;
        exception when unique_violation then
          null; -- bu adisyona kazanım zaten işlenmiş (çift teslim yarışı)
        end;
      end if;
    end if;
  end if;

  return null;
end
$$;

-- ---------------------------------------------------------------------------
-- 5) Harcama: musteri_siparis_olustur v3 — p_puan (10'un katı) indirime döner.
--    İndirim adisyon.iskonto_tutar'a yazılır: adisyon_tutarlari ve TÜM rapor
--    aileleri iskontoyu zaten düştüğünden ciro otomatik net çıkar.
--    Eski imza düşer (PostgREST çakışması olmasın); p_puan default 0 → eski
--    app'in 3 parametreli çağrısı aynen çalışır.
-- ---------------------------------------------------------------------------
drop function if exists public.musteri_siparis_olustur(uuid, jsonb, text);

create function public.musteri_siparis_olustur(
  p_cafe_id uuid,
  p_kalemler jsonb,
  p_musteri_notu text default null,
  p_puan int default 0
) returns uuid
language plpgsql security definer set search_path = public as
$$
declare
  v_cafe public.cafe%rowtype;
  v_adisyon_id uuid;
  v_siparis_id uuid;
  v_kalem jsonb;
  v_urun public.urun%rowtype;
  v_ek_fiyat numeric(10,2);
  v_opsiyonlar jsonb;
  v_son_dakika int;
  v_adet int;
  v_musteri_id uuid;
  v_toplam numeric(10,2);
  v_indirim numeric(10,2);
  v_hesap uuid;
begin
  select id into v_musteri_id from public.kullanici
    where id = auth.uid() and rol = 'musteri' and aktif;
  if v_musteri_id is null then
    raise exception 'Sipariş için uygulamadan giriş yapmalısınız';
  end if;

  select * into v_cafe from public.cafe where id = p_cafe_id and aktif;
  if not found then
    raise exception 'Kafe aktif değil';
  end if;

  if p_kalemler is null or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'Sipariş boş olamaz';
  end if;

  if p_puan < 0 or p_puan % 10 <> 0 then
    raise exception 'Puan 10''un katı olmalı';
  end if;
  if p_puan > 0 and not v_cafe.sadakat_aktif then
    raise exception 'Bu kafede puan kullanımı kapalı';
  end if;

  select count(*) into v_son_dakika from public.siparis
    where musteri_id = v_musteri_id and created_at > now() - interval '60 seconds';
  if v_son_dakika >= 3 then
    raise exception 'Çok sık sipariş; lütfen biraz bekleyin';
  end if;

  -- her sipariş kendi adisyonunu açar (teslimde otomatik kapanır)
  insert into public.adisyon (cafe_id) values (v_cafe.id)
  returning id into v_adisyon_id;

  insert into public.siparis
    (cafe_id, adisyon_id, durum, musteri_notu, musteri_id, siparis_no)
  values (
    v_cafe.id, v_adisyon_id,
    'bekliyor'::public.siparis_durum,  -- ödeme kapısı yok: doğrudan mutfağa
    p_musteri_notu,
    v_musteri_id,
    public.siparis_no_al(v_cafe.id)
  ) returning id into v_siparis_id;

  for v_kalem in select * from jsonb_array_elements(p_kalemler) loop
    select * into v_urun from public.urun
      where id = (v_kalem->>'urun_id')::uuid and cafe_id = v_cafe.id and aktif;
    if not found then
      raise exception 'Ürün bulunamadı veya pasif: %', v_kalem->>'urun_id';
    end if;

    v_adet := greatest(coalesce((v_kalem->>'adet')::int, 1), 1);
    if v_urun.stok_takip and coalesce(v_urun.stok_adet, 0) < v_adet then
      raise exception '"%" tükenmek üzere; kalan adet: %', v_urun.ad, coalesce(v_urun.stok_adet, 0);
    end if;

    -- Ek fiyat ve seçim listesi SUNUCUDA opsiyon tablosundan kurulur (fiyat güvenliği)
    select
      coalesce(sum(o.ek_fiyat), 0),
      coalesce(jsonb_agg(jsonb_build_object('grup', g.ad, 'secim', o.ad, 'ek_fiyat', o.ek_fiyat)), '[]'::jsonb)
    into v_ek_fiyat, v_opsiyonlar
    from jsonb_array_elements(coalesce(v_kalem->'opsiyonlar', '[]'::jsonb)) sec
    join public.opsiyon o on o.ad = (sec->>'secim') and o.aktif
    join public.opsiyon_grubu g on g.id = o.opsiyon_grubu_id
      and g.ad = (sec->>'grup') and g.urun_id = v_urun.id;

    insert into public.siparis_kalemi
      (cafe_id, siparis_id, urun_id, urun_ad, birim_fiyat, adet, secilen_opsiyonlar, opsiyon_ek_fiyat, kalem_notu)
    values (
      v_cafe.id, v_siparis_id, v_urun.id, v_urun.ad, v_urun.fiyat, v_adet,
      v_opsiyonlar, v_ek_fiyat,
      nullif(trim(coalesce(v_kalem->>'not', '')), '')
    );
  end loop;

  -- Puan harcama: sunucu fiyatlarıyla hesaplanan toplamın üstünde indirim olamaz;
  -- bakiye düşümü koşullu UPDATE ile yarış-güvenli (eksiye inemez).
  if p_puan > 0 then
    select coalesce(sum((birim_fiyat + opsiyon_ek_fiyat) * adet), 0) into v_toplam
      from public.siparis_kalemi where siparis_id = v_siparis_id;
    v_indirim := p_puan / 10.0;
    if v_indirim > v_toplam then
      raise exception 'Puan indirimi (% TL) sipariş tutarını (% TL) aşamaz', v_indirim, v_toplam;
    end if;

    update public.sadakat_hesabi
      set puan_bakiye = puan_bakiye - p_puan
      where kullanici_id = v_musteri_id and puan_bakiye >= p_puan
      returning id into v_hesap;
    if v_hesap is null then
      raise exception 'Puan bakiyen yetersiz';
    end if;

    update public.adisyon set iskonto_tutar = v_indirim where id = v_adisyon_id;

    insert into public.puan_hareketi
      (cafe_id, sadakat_hesabi_id, adisyon_id, tur, puan, aciklama)
    values
      (v_cafe.id, v_hesap, v_adisyon_id, 'harcama', -p_puan,
       'Puan indirimi: ' || v_indirim || ' TL');
  end if;

  return v_siparis_id;
end
$$;

grant execute on function public.musteri_siparis_olustur(uuid, jsonb, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) İade: sipariş iptal/reddedilirse harcanan puan geri döner.
--    puan_tek_iade partial unique guard'ı çift iadeyi keser (puan_duzelt'in
--    adisyon_id'siz duzeltme satırları indekse girmez — çakışmaz).
-- ---------------------------------------------------------------------------
create unique index puan_tek_iade on public.puan_hareketi (adisyon_id)
  where tur = 'duzeltme' and adisyon_id is not null;

create function public.puan_iade() returns trigger
language plpgsql security definer set search_path = public as
$$
declare
  v_harcama public.puan_hareketi%rowtype;
begin
  if new.adisyon_id is null then
    return null;
  end if;

  select * into v_harcama from public.puan_hareketi
    where adisyon_id = new.adisyon_id and tur = 'harcama'
    limit 1;
  if not found then
    return null; -- bu siparişte puan harcanmamış
  end if;

  begin
    insert into public.puan_hareketi
      (cafe_id, sadakat_hesabi_id, adisyon_id, tur, puan, aciklama)
    values
      (v_harcama.cafe_id, v_harcama.sadakat_hesabi_id, new.adisyon_id,
       'duzeltme', -v_harcama.puan, 'Sipariş iptali — puan iadesi');
    update public.sadakat_hesabi
      set puan_bakiye = puan_bakiye - v_harcama.puan  -- harcama negatifti: çıkarmak = geri eklemek
      where id = v_harcama.sadakat_hesabi_id;
  exception when unique_violation then
    null; -- iade zaten yapılmış
  end;

  return null;
end
$$;

drop trigger if exists siparis_iptal_puan_iade on public.siparis;
create trigger siparis_iptal_puan_iade
  after update of durum on public.siparis
  for each row
  when (new.durum in ('iptal', 'reddedildi')
        and old.durum not in ('iptal', 'reddedildi'))
  execute function public.puan_iade();

-- ---------------------------------------------------------------------------
-- 7) puan_duzelt v2: tek cüzdan (hareket, işlemi yapan kafenin defterine yazılır)
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

  v_hesap_id := public.sadakat_hesap_bul(v_musteri.id);
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
-- 8) musteri_ozet v3: tek bakiye + TL karşılığı. 'hesaplar' anahtarı eski app
--    sürümleri için TEK sentetik satırla korunur (0060'ta kaldırılacak).
-- ---------------------------------------------------------------------------
create or replace function public.musteri_ozet() returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  v_kayit public.kullanici%rowtype;
  v_bakiye int;
begin
  select * into v_kayit from public.kullanici
    where id = auth.uid() and rol = 'musteri' and aktif;
  if not found then
    raise exception 'Müşteri kaydı bulunamadı';
  end if;

  select puan_bakiye into v_bakiye from public.sadakat_hesabi
    where kullanici_id = v_kayit.id;
  v_bakiye := coalesce(v_bakiye, 0);

  return jsonb_build_object(
    'ad', v_kayit.ad,
    'musteri_kod', v_kayit.musteri_kod,
    'puan_bakiye', v_bakiye,
    'tl_karsiligi', round(v_bakiye / 10.0, 2),
    'hesaplar', jsonb_build_array(jsonb_build_object(
      'cafe_id', null,
      'cafe_ad', 'SofraKur',
      'puan_bakiye', v_bakiye
    )),
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
-- 9) zincir_kampanya_uye_sayisi v2: zincir kafelerinde puan hareketi olan
--    benzersiz müşteri sayısı (cüzdan artık zincirsiz — defterden sayılır)
-- ---------------------------------------------------------------------------
create or replace function public.zincir_kampanya_uye_sayisi(p_zincir_id uuid default null)
returns int
language plpgsql stable security definer set search_path = public as
$$
declare
  v_zincir uuid := public._zincir_yetki(p_zincir_id);
begin
  return (
    select count(distinct h.kullanici_id)
    from public.puan_hareketi p
    join public.sadakat_hesabi h on h.id = p.sadakat_hesabi_id
    join public.cafe c on c.id = p.cafe_id
    where c.zincir_id = v_zincir
  );
end
$$;
