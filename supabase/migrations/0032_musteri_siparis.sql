-- ============================================================================
-- 0032: Müşteri sipariş damgası + sipariş geçmişi (Faz 4 — M1)
--   siparis.musteri_id : uygulamadan giriş yapmış müşteri sipariş verirse
--                        kimliği damgalanır (anonim QR web akışı DEĞİŞMEZ).
--   siparis_olustur    : 0023 gövdesi + musteri_id damgası (tek ek).
--   musteri_siparislerim : geçmiş + "aynısını tekrar" için kalem detayı.
-- ============================================================================

alter table public.siparis
  add column musteri_id uuid references public.kullanici(id) on delete set null;

create index on public.siparis (musteri_id) where musteri_id is not null;

-- ---------------------------------------------------------------------------
-- siparis_olustur: 0023'teki gövdenin AYNISI; tek fark auth.uid() bir müşteri
-- hesabıysa siparişe musteri_id yazılması. Anonim (QR web) çağrıda null kalır.
-- ---------------------------------------------------------------------------
create or replace function public.siparis_olustur(
  p_token text,
  p_kalemler jsonb,
  p_musteri_notu text default null
) returns uuid
language plpgsql security definer set search_path = public as
$$
declare
  v_oturum public.masa_oturumu%rowtype;
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
begin
  select * into v_oturum from public.masa_oturumu
    where token = p_token and bitis > now();
  if not found then
    raise exception 'Oturum geçersiz veya süresi dolmuş; QR kodu yeniden okutun';
  end if;

  select * into v_cafe from public.cafe where id = v_oturum.cafe_id and aktif;
  if not found then
    raise exception 'Kafe aktif değil';
  end if;

  if p_kalemler is null or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'Sipariş boş olamaz';
  end if;

  select count(*) into v_son_dakika from public.siparis
    where masa_id = v_oturum.masa_id and created_at > now() - interval '60 seconds';
  if v_son_dakika >= 3 then
    raise exception 'Çok sık sipariş; lütfen biraz bekleyin';
  end if;

  -- Uygulamadan giriş yapmış müşteriyse kimliği damgala (personel/anon → null)
  select id into v_musteri_id from public.kullanici
    where id = auth.uid() and rol = 'musteri' and aktif;

  select id into v_adisyon_id from public.adisyon
    where masa_id = v_oturum.masa_id and durum = 'acik'
    order by acilis desc limit 1;
  if v_adisyon_id is null then
    insert into public.adisyon (cafe_id, masa_id)
    values (v_oturum.cafe_id, v_oturum.masa_id)
    returning id into v_adisyon_id;
  end if;

  insert into public.siparis (cafe_id, adisyon_id, masa_id, masa_oturumu_id, durum, musteri_notu, musteri_id)
  values (
    v_oturum.cafe_id, v_adisyon_id, v_oturum.masa_id, v_oturum.id,
    case when v_cafe.odeme_modu = 'once_odeme' then 'odeme_bekliyor'::public.siparis_durum
         else 'bekliyor'::public.siparis_durum end,
    p_musteri_notu,
    v_musteri_id
  ) returning id into v_siparis_id;

  for v_kalem in select * from jsonb_array_elements(p_kalemler) loop
    select * into v_urun from public.urun
      where id = (v_kalem->>'urun_id')::uuid and cafe_id = v_oturum.cafe_id and aktif;
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
      v_oturum.cafe_id, v_siparis_id, v_urun.id, v_urun.ad, v_urun.fiyat, v_adet,
      v_opsiyonlar, v_ek_fiyat,
      nullif(trim(coalesce(v_kalem->>'not', '')), '')
    );
  end loop;

  return v_siparis_id;
end
$$;

-- ---------------------------------------------------------------------------
-- RPC: musteri_siparislerim — uygulamadaki "Siparişlerim" + "aynısını tekrar".
-- Kalemlerdeki urun_id + opsiyonlar {grup, secim} sepete geri yüklenebilir.
-- ---------------------------------------------------------------------------
create function public.musteri_siparislerim(p_limit int default 30)
returns jsonb
language plpgsql security definer set search_path = public as
$$
begin
  if auth.uid() is null then
    raise exception 'Giriş gerekli';
  end if;

  return coalesce((
    select jsonb_agg(x) from (
      select jsonb_build_object(
        'siparis_id', s.id,
        'cafe_ad', c.ad,
        'masa_ad', m.ad,
        'durum', s.durum,
        'tarih', s.created_at,
        'kalemler', coalesce((
          select jsonb_agg(jsonb_build_object(
            'urun_id', k.urun_id,
            'urun_ad', k.urun_ad,
            'adet', k.adet,
            'birim_fiyat', k.birim_fiyat,
            'opsiyon_ek_fiyat', k.opsiyon_ek_fiyat,
            'opsiyonlar', k.secilen_opsiyonlar,
            'kalem_notu', k.kalem_notu,
            'reddedildi', k.reddedildi
          ))
          from public.siparis_kalemi k where k.siparis_id = s.id
        ), '[]'::jsonb)
      ) as x
      from public.siparis s
      join public.cafe c on c.id = s.cafe_id
      join public.masa m on m.id = s.masa_id
      where s.musteri_id = auth.uid()
      order by s.created_at desc
      limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) son
  ), '[]'::jsonb);
end
$$;

grant execute on function public.musteri_siparislerim(int) to authenticated;
