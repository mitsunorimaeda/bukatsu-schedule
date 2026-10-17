-- メンバー一覧にメールアドレスを出す（auth.users は直接読めないので、編集者以上に限って RPC で返す）
create or replace function bukatsu.member_emails(p_school text)
returns table (user_id uuid, email text) language sql security definer set search_path = bukatsu, pg_temp stable as $$
  select m.user_id, u.email::text
    from bukatsu.memberships m
    join auth.users u on u.id = m.user_id
   where m.school_id = p_school
     and bukatsu.is_member(p_school, 'teacher');
$$;
grant execute on function bukatsu.member_emails(text) to authenticated;
