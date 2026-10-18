-- 予定表（学校）の設定を管理者が変えられるようにする（国民の祝日を取り込まない、など）。
-- bukatsu スキーマ内だけ。
create policy schools_admin_update on bukatsu.schools
  for update using (bukatsu.is_member(id, 'admin')) with check (bukatsu.is_member(id, 'admin'));
