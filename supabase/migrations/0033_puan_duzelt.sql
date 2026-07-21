-- ============================================================================
-- 0033: Admin manuel puan düzeltme (Faz 4 — M3)
--   puan_duzelt: admin, müşteri koduyla bakiyeye ± puan işler (şikayet telafisi,
--   yanlış işlem düzeltmesi vb.). puan_hareketi'ne 'duzeltme' olarak yazılır.
-- Ayrıca: uygulama testinde açılan onaysız hesap temizliği.
-- ============================================================================

create function public.puan_duzelt(p_musteri_kod text, p_puan int, p_aciklama text default null)
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

  insert into public.sadakat_hesabi (cafe_id, kullanici_id)
  values (v_cafe_id, v_musteri.id)
  on conflict (cafe_id, kullanici_id) do nothing;

  select id, puan_bakiye into v_hesap_id, v_bakiye from public.sadakat_hesabi
    where cafe_id = v_cafe_id and kullanici_id = v_musteri.id;

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

grant execute on function public.puan_duzelt(text, int, text) to authenticated;

-- Uygulama giriş testi sırasında açılan, e-postası hiç onaylanmamış hesap
delete from auth.users
  where email = 'sofrakur.apptest@gmail.com' and email_confirmed_at is null;
