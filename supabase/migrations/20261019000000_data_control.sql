-- データの自己管理: 予定表の全削除と、メンバーから抜ける RPC（docs/data-handling.md）
-- bukatsu スキーマの中だけを触る。

-- 予定表（school）を丸ごと消す。管理者だけ。カレンダー・版・予定・差分・メンバー・権限・設定・閲覧リンク・招待は外部キーの cascade で消える。
create or replace function bukatsu.delete_workspace(p_school text)
returns void language plpgsql security definer set search_path = bukatsu, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'ログインが必要です'; end if;
  if not bukatsu.is_member(p_school, 'admin') then raise exception 'この予定表を削除できるのは管理者だけです'; end if;
  -- 版は school_id を持つが layers 経由の cascade で消える。念のため明示的にも消す
  delete from bukatsu.events where school_id = p_school;
  delete from bukatsu.source_versions where school_id = p_school;
  delete from bukatsu.schools where id = p_school;
end $$;
grant execute on function bukatsu.delete_workspace(text) to authenticated;

-- 自分だけ予定表から抜ける。最後の管理者は抜けられない（先に別の管理者を招くか、全削除する）。
create or replace function bukatsu.leave_workspace(p_school text)
returns void language plpgsql security definer set search_path = bukatsu, pg_temp as $$
declare admins int;
begin
  if auth.uid() is null then raise exception 'ログインが必要です'; end if;
  select count(*) into admins from bukatsu.memberships where school_id = p_school and role = 'admin' and user_id <> auth.uid();
  if admins = 0 and bukatsu.is_member(p_school, 'admin') then
    raise exception '最後の管理者は抜けられません。別の管理者を招くか、予定表を全削除してください';
  end if;
  delete from bukatsu.layer_grants where school_id = p_school and user_id = auth.uid();
  delete from bukatsu.user_prefs  where school_id = p_school and user_id = auth.uid();
  delete from bukatsu.memberships where school_id = p_school and user_id = auth.uid();
end $$;
grant execute on function bukatsu.leave_workspace(text) to authenticated;
