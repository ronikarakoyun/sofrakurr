-- Canlı sonrası sağlamlaştırma (SARI bulgular):
--   • Rol bazlı RLS: menü/stok yazma yalnız admin; cari/gider/gün sonu admin+kasa;
--     adisyon güncelleme (kapatma/iskonto) admin+kasa. Garson artık konsoldan
--     menü fiyatı değiştiremez, cari/veresiye göremez.
--   • Ö2: masa birleştirmede kaynak iskontosu hedefe taşınır (kaybolmaz).
--   • Ö3: kalem taşıma yalnız açık hesaptan + ödemesi onaylı kalemle yapılır.
--   • Ö6: eski onay-bekleyen siparişler ve birikmiş kayıtlar için bakım işi.
--   • Cari bakiye view (performans): tüm hareket tablosunu çekmek yerine özet.

-- ---------------------------------------------------------------------------
-- Rol yardımcısı
-- ---------------------------------------------------------------------------
create or replace function public.rol_var(p_roller public.kullanici_rol[])
returns boolean language sql stable security definer set search_path = public as
$$ select public.aktif_rol() = any(p_roller) $$;

-- ---------------------------------------------------------------------------
-- Menü & tarif yazma → yalnız admin (okuma tüm personel + anon)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['urun','kategori','opsiyon','opsiyon_grubu','recete'] loop
    execute format('drop policy if exists personel_%s on public.%I', t, t);
    execute format($f$create policy %I on public.%I for select using (cafe_id = public.aktif_cafe_id())$f$,
      t||'_personel_oku', t);
    execute format($f$create policy %I on public.%I for all
      using (cafe_id = public.aktif_cafe_id() and public.rol_var(array['admin']::public.kullanici_rol[]))
      with check (cafe_id = public.aktif_cafe_id() and public.rol_var(array['admin']::public.kullanici_rol[]))$f$,
      t||'_admin_yaz', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Stok / sayım → yalnız admin
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['hammadde','hammadde_giris','sayim','sayim_kalemi'] loop
    execute format('drop policy if exists personel_%s on public.%I', t, t);
    execute format($f$create policy %I on public.%I for all
      using (cafe_id = public.aktif_cafe_id() and public.rol_var(array['admin']::public.kullanici_rol[]))
      with check (cafe_id = public.aktif_cafe_id() and public.rol_var(array['admin']::public.kullanici_rol[]))$f$,
      t||'_admin', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Cari / gider / gün sonu → admin + kasa
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['cari','cari_hareket','gider','gun_sonu'] loop
    execute format('drop policy if exists personel_%s on public.%I', t, t);
    execute format($f$create policy %I on public.%I for all
      using (cafe_id = public.aktif_cafe_id() and public.rol_var(array['admin','kasa']::public.kullanici_rol[]))
      with check (cafe_id = public.aktif_cafe_id() and public.rol_var(array['admin','kasa']::public.kullanici_rol[]))$f$,
      t||'_kasa', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Masa & bölüm → yazma admin, okuma tüm personel
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['masa','bolum'] loop
    execute format('drop policy if exists personel_%s on public.%I', t, t);
    execute format($f$create policy %I on public.%I for select using (cafe_id = public.aktif_cafe_id())$f$,
      t||'_oku', t);
    execute format($f$create policy %I on public.%I for all
      using (cafe_id = public.aktif_cafe_id() and public.rol_var(array['admin']::public.kullanici_rol[]))
      with check (cafe_id = public.aktif_cafe_id() and public.rol_var(array['admin']::public.kullanici_rol[]))$f$,
      t||'_admin_yaz', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Adisyon: okuma + açma (sipariş) tüm personel; güncelleme (kapatma/iskonto/
-- taşıma) yalnız admin+kasa. Garson masayı görür ve sipariş açar ama kapatamaz.
-- ---------------------------------------------------------------------------
drop policy if exists personel_adisyon on public.adisyon;
create policy adisyon_oku on public.adisyon
  for select using (cafe_id = public.aktif_cafe_id());
create policy adisyon_ekle on public.adisyon
  for insert with check (cafe_id = public.aktif_cafe_id());
create policy adisyon_guncelle on public.adisyon
  for update using (cafe_id = public.aktif_cafe_id() and public.rol_var(array['admin','kasa']::public.kullanici_rol[]))
  with check (cafe_id = public.aktif_cafe_id());

-- ---------------------------------------------------------------------------
-- Ö2) Masa birleştirmede iskonto kaybını önle
-- ---------------------------------------------------------------------------
create or replace function public.adisyon_tasi(p_adisyon_id uuid, p_hedef_masa_id uuid)
returns void language plpgsql security invoker set search_path = public as
$$
declare
  v_adisyon public.adisyon%rowtype;
  v_hedef public.masa%rowtype;
  v_hedef_adisyon_id uuid;
begin
  select * into v_adisyon from public.adisyon where id = p_adisyon_id and durum = 'acik';
  if not found then raise exception 'Açık adisyon bulunamadı'; end if;
  select * into v_hedef from public.masa where id = p_hedef_masa_id and aktif;
  if not found or v_hedef.cafe_id <> v_adisyon.cafe_id then
    raise exception 'Hedef masa bulunamadı';
  end if;
  if v_hedef.id = v_adisyon.masa_id then raise exception 'Hesap zaten bu masada'; end if;

  select id into v_hedef_adisyon_id from public.adisyon
    where masa_id = p_hedef_masa_id and durum = 'acik' order by acilis desc limit 1;

  if v_hedef_adisyon_id is not null then
    update public.siparis set adisyon_id = v_hedef_adisyon_id, masa_id = p_hedef_masa_id
      where adisyon_id = p_adisyon_id;
    -- kaynak iskontosunu hedefe ekle (yoksa müşteri fazla öderdi)
    update public.adisyon set iskonto_tutar = iskonto_tutar + v_adisyon.iskonto_tutar
      where id = v_hedef_adisyon_id;
    update public.adisyon set durum = 'iptal', kapanis = now() where id = p_adisyon_id;
  else
    update public.adisyon set masa_id = p_hedef_masa_id where id = p_adisyon_id;
    update public.siparis set masa_id = p_hedef_masa_id where adisyon_id = p_adisyon_id;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Ö3) Kalem taşıma: yalnız açık hesaptan + ödemesi onaylanmış kalem
-- ---------------------------------------------------------------------------
create or replace function public.kalem_tasi(p_kalem_id uuid, p_hedef_masa_id uuid)
returns void language plpgsql security invoker set search_path = public as
$$
declare
  v_kalem public.siparis_kalemi%rowtype;
  v_hedef public.masa%rowtype;
  v_kaynak_sip public.siparis%rowtype;
  v_kaynak_adisyon public.adisyon%rowtype;
  v_hedef_adisyon_id uuid;
  v_tasima_siparis_id uuid;
begin
  select * into v_kalem from public.siparis_kalemi where id = p_kalem_id and not reddedildi;
  if not found then raise exception 'Kalem bulunamadı'; end if;

  select * into v_kaynak_sip from public.siparis where id = v_kalem.siparis_id;
  select * into v_kaynak_adisyon from public.adisyon where id = v_kaynak_sip.adisyon_id;
  if v_kaynak_adisyon.durum <> 'acik' then
    raise exception 'Kapalı hesaptan kalem taşınamaz';
  end if;
  if v_kaynak_sip.durum = 'odeme_bekliyor' then
    raise exception 'Ödeme onayı bekleyen kalem taşınamaz';
  end if;

  select * into v_hedef from public.masa where id = p_hedef_masa_id and aktif;
  if not found or v_hedef.cafe_id <> v_kalem.cafe_id then
    raise exception 'Hedef masa bulunamadı';
  end if;

  select id into v_hedef_adisyon_id from public.adisyon
    where masa_id = p_hedef_masa_id and durum = 'acik' order by acilis desc limit 1;
  if v_hedef_adisyon_id is null then
    insert into public.adisyon (cafe_id, masa_id)
    values (v_kalem.cafe_id, p_hedef_masa_id) returning id into v_hedef_adisyon_id;
  end if;

  insert into public.siparis (cafe_id, adisyon_id, masa_id, olusturan_id, durum, musteri_notu)
  values (v_kalem.cafe_id, v_hedef_adisyon_id, p_hedef_masa_id, auth.uid(), 'teslim', 'Masa transferi')
  returning id into v_tasima_siparis_id;

  update public.siparis_kalemi set siparis_id = v_tasima_siparis_id where id = p_kalem_id;
end
$$;

-- ---------------------------------------------------------------------------
-- "Ürün bitti": mutfak menü yazamaz ama tükenen ürünü pasife çekebilmeli.
-- Yalnız aktif=false yapar; fiyat/ad/başka alanı değiştiremez.
-- ---------------------------------------------------------------------------
create or replace function public.urun_bitti(p_urun_id uuid) returns void
language plpgsql security definer set search_path = public as
$$
begin
  update public.urun set aktif = false
    where id = p_urun_id and cafe_id = public.aktif_cafe_id();
end
$$;
revoke execute on function public.urun_bitti(uuid) from public;
grant execute on function public.urun_bitti(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Cari bakiye özeti (performans): istemci tüm hareketleri çekmesin
-- ---------------------------------------------------------------------------
create or replace view public.cari_bakiye with (security_invoker = true) as
select c.id as cari_id, c.cafe_id, c.ad,
       coalesce(sum(h.tutar), 0) as bakiye
from public.cari c
left join public.cari_hareket h on h.cari_id = c.id
where c.aktif
group by c.id, c.cafe_id, c.ad;

-- ---------------------------------------------------------------------------
-- Ö6) Bakım: eski onay-bekleyen siparişleri kapat + birikmiş kayıtları temizle
-- ---------------------------------------------------------------------------
create or replace function public.bakim_temizlik() returns void
language plpgsql security definer set search_path = public as
$$
begin
  -- 12 saatten eski, hâlâ onay bekleyen QR siparişleri (müşteri kalkmış) iptal
  update public.siparis set durum = 'iptal'
    where durum = 'odeme_bekliyor' and created_at < now() - interval '12 hours';
  delete from public.masa_oturumu where bitis < now() - interval '2 days';
  delete from public.garson_cagri where not acik and created_at < now() - interval '2 days';
  delete from public.yazdirma_kuyrugu where durum = 'basildi' and created_at < now() - interval '7 days';
  delete from public.basilan_fis where basildi_at < now() - interval '7 days';
end
$$;
revoke execute on function public.bakim_temizlik() from public;

-- pg_cron varsa günlük 04:00'te çalıştır (yoksa sessizce atla; elle de çağrılabilir)
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('sofrakur-bakim', '0 4 * * *', 'select public.bakim_temizlik()');
exception when others then
  raise notice 'pg_cron kurulamadı (Dashboard''dan etkinleştirin): %', sqlerrm;
end $$;
