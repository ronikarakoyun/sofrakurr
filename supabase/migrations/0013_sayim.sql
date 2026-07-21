-- Sayım (envanter): eldeki fiziksel miktar girilir; sistem beklenenle
-- karşılaştırıp fireyi ve TL zararını kaydeder, stokları sayılana çeker.
-- Her sayım tarihçesiyle saklanır.

create table public.sayim (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references public.cafe(id) on delete cascade,
  notu         text,
  kullanici_id uuid references public.kullanici(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table public.sayim_kalemi (
  id            uuid primary key default gen_random_uuid(),
  cafe_id       uuid not null references public.cafe(id) on delete cascade,
  sayim_id      uuid not null references public.sayim(id) on delete cascade,
  hammadde_id   uuid references public.hammadde(id) on delete set null,
  urun_id       uuid references public.urun(id) on delete set null,
  ad            text not null,           -- anlık ad (kayıt silinse de tarihçe okunur)
  birim         text not null,           -- gr / ml / adet
  beklenen      numeric(12,2) not null,  -- sayım anında sistemdeki miktar
  sayilan       numeric(12,2) not null,
  birim_maliyet numeric(12,4),           -- fire zararı = (beklenen - sayılan) × birim_maliyet
  check (hammadde_id is not null or urun_id is not null)
);

create index on public.sayim (cafe_id, created_at);
create index on public.sayim_kalemi (sayim_id);

alter table public.sayim enable row level security;
alter table public.sayim_kalemi enable row level security;
create policy personel_sayim on public.sayim
  for all using (cafe_id = public.aktif_cafe_id());
create policy personel_sayim_kalemi on public.sayim_kalemi
  for all using (cafe_id = public.aktif_cafe_id());

-- Sayımı atomik kaydeder: beklenenler o an okunur, stoklar sayılana çekilir.
-- p_kalemler: [{"tip":"hammadde"|"urun","id":"...","sayilan":123.4}, ...]
create function public.sayim_kaydet(p_kalemler jsonb, p_notu text default null)
returns uuid
language plpgsql security invoker set search_path = public as
$$
declare
  v_cafe_id uuid := public.aktif_cafe_id();
  v_sayim_id uuid;
  v_kalem jsonb;
  v_h public.hammadde%rowtype;
  v_u public.urun%rowtype;
  v_sayilan numeric;
  v_maliyet numeric;
begin
  if v_cafe_id is null then
    raise exception 'Yetkisiz';
  end if;
  if p_kalemler is null or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'Sayım boş olamaz';
  end if;

  insert into public.sayim (cafe_id, notu, kullanici_id)
  values (v_cafe_id, p_notu, auth.uid())
  returning id into v_sayim_id;

  for v_kalem in select * from jsonb_array_elements(p_kalemler) loop
    v_sayilan := (v_kalem->>'sayilan')::numeric;
    if v_sayilan is null or v_sayilan < 0 then
      raise exception 'Geçersiz sayım miktarı';
    end if;

    if v_kalem->>'tip' = 'hammadde' then
      select * into v_h from public.hammadde
        where id = (v_kalem->>'id')::uuid and cafe_id = v_cafe_id;
      if not found then
        raise exception 'Hammadde bulunamadı';
      end if;
      insert into public.sayim_kalemi
        (cafe_id, sayim_id, hammadde_id, ad, birim, beklenen, sayilan, birim_maliyet)
      values
        (v_cafe_id, v_sayim_id, v_h.id, v_h.ad, v_h.birim::text, v_h.stok_miktar, v_sayilan, v_h.son_birim_fiyat);
      update public.hammadde set stok_miktar = v_sayilan where id = v_h.id;

    elsif v_kalem->>'tip' = 'urun' then
      select * into v_u from public.urun
        where id = (v_kalem->>'id')::uuid and cafe_id = v_cafe_id;
      if not found then
        raise exception 'Ürün bulunamadı';
      end if;
      -- vitrin ürününün maliyeti: reçetesi varsa reçeteden
      select sum(r.miktar * h.son_birim_fiyat) into v_maliyet
        from public.recete r
        join public.hammadde h on h.id = r.hammadde_id
        where r.urun_id = v_u.id and h.son_birim_fiyat is not null;
      insert into public.sayim_kalemi
        (cafe_id, sayim_id, urun_id, ad, birim, beklenen, sayilan, birim_maliyet)
      values
        (v_cafe_id, v_sayim_id, v_u.id, v_u.ad, 'adet', coalesce(v_u.stok_adet, 0), v_sayilan, v_maliyet);
      update public.urun
        set stok_adet = v_sayilan,
            aktif = case when v_sayilan > 0 and stok_takip then true else aktif end
        where id = v_u.id;
    else
      raise exception 'Geçersiz kalem tipi';
    end if;
  end loop;

  return v_sayim_id;
end
$$;

revoke execute on function public.sayim_kaydet(jsonb, text) from public;
grant execute on function public.sayim_kaydet(jsonb, text) to authenticated;
