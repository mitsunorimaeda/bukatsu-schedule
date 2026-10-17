-- 画面の作り直し（docs/ux-redesign.md）に合わせた変更。すべて bukatsu スキーマ内。
--  * 層 = カレンダー。班（slots）の一覧と順序、公開のしかた（auto / manual）を持つ
--  * 予定は複数の班にまたがれる（slots）。下書き（draft）は編集者だけに見える
--  * 手動公開: 編集は working 版に入り、「公開する」で approved 版のスナップショットを作る
--  * 共有リンクの範囲に班（slots）を追加
--  * 画面からワークスペースを作る RPC、メンバー招待

alter table bukatsu.layers
  add column if not exists slots text[] not null default '{全体}',
  add column if not exists publish_mode text not null default 'auto' check (publish_mode in ('auto','manual')),
  add column if not exists source jsonb,                 -- 取り込み元の設定（kind: pdf / gsheet / csv / manual など）
  add column if not exists published_at timestamptz;

alter table bukatsu.events
  add column if not exists slots text[],                 -- null なら {category}
  add column if not exists draft boolean not null default false,
  add column if not exists updated_by uuid;

alter table bukatsu.source_versions drop constraint if exists source_versions_status_check;
alter table bukatsu.source_versions add constraint source_versions_status_check
  check (status in ('working','pending','approved','rejected'));

-- 公開中 = 最新の approved 版、下書きは除く
create or replace view bukatsu.current_versions with (security_invoker = true) as
select distinct on (school_id, layer_id) *
from bukatsu.source_versions
where status = 'approved'
order by school_id, layer_id, imported_at desc;

create or replace view bukatsu.current_events with (security_invoker = true) as
select e.*
from bukatsu.events e
join bukatsu.current_versions v on v.id = e.version_id
where e.draft = false;

-- ---------- 閲覧 URL: 班の範囲と下書き除外に対応 ----------
drop function if exists bukatsu.schedule_by_token(text);
create function bukatsu.schedule_by_token(p_token text)
returns table (
  school_id text, school_name text, layer_id text, layer_name text, layer_type text, layer_color text, layer_slots text[],
  uid text, category text, slots text[], date date, end_date date, kind text, time_start time, time_end time,
  place text, title text, note text, version_label text
) language sql stable security definer set search_path = bukatsu, pg_temp as $$
  select s.id, s.name, l.id, l.name, l.type, l.color, l.slots,
         e.uid, e.category, coalesce(e.slots, array[e.category]), e.date, e.end_date, e.kind, e.time_start, e.time_end,
         e.place, e.title, e.note, v.label
  from bukatsu.share_links sl
  join bukatsu.schools s on s.id = sl.school_id
  join bukatsu.layers l on l.school_id = s.id
  join bukatsu.source_versions v on v.school_id = l.school_id and v.layer_id = l.id and v.status = 'approved'
  join bukatsu.events e on e.version_id = v.id and e.draft = false
  where sl.token = p_token and sl.revoked_at is null
    and v.id = (select v2.id from bukatsu.source_versions v2
                where v2.school_id = l.school_id and v2.layer_id = l.id and v2.status = 'approved'
                order by v2.imported_at desc limit 1)
    and (sl.scope->'layers' is null or (sl.scope->'layers') ? l.id)
    -- 班の範囲: scope.slots = {"club:soccer": ["トップ","セカンド"]}。指定が無い層は全部
    and (sl.scope->'slots'->l.id is null
         or exists (select 1 from unnest(coalesce(e.slots, array[e.category])) x
                    where (sl.scope->'slots'->l.id) ? x))
    and (sl.scope->>'from' is null or coalesce(e.end_date, e.date) >= (sl.scope->>'from')::date)
    and (sl.scope->>'to' is null or e.date <= (sl.scope->>'to')::date)
    and (sl.scope->'uids' is null or (sl.scope->'uids') ? e.uid);
$$;
revoke all on function bukatsu.schedule_by_token(text) from public;
grant execute on function bukatsu.schedule_by_token(text) to anon, authenticated, service_role;

-- ---------- ワークスペースを作る（作った人が admin） ----------
create or replace function bukatsu.create_workspace(p_id text, p_name text, p_settings jsonb default null)
returns text language plpgsql security definer set search_path = bukatsu, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'ログインが必要です'; end if;
  if p_id !~ '^[a-z0-9][a-z0-9-]{1,40}$' then raise exception 'ID は英小文字・数字・ハイフン'; end if;
  insert into bukatsu.schools (id, name, settings)
  values (p_id, p_name, coalesce(p_settings, '{"afterSchoolStart":"15:30","defaultDurationMin":120,"fiscalYearStartMonth":4}'::jsonb));
  insert into bukatsu.memberships (user_id, school_id, role) values (auth.uid(), p_id, 'admin');
  return p_id;
end $$;
grant execute on function bukatsu.create_workspace(text, text, jsonb) to authenticated;

-- ---------- 手動公開: working 版の内容（下書き以外）を approved 版として写す ----------
create or replace function bukatsu.publish_layer(p_school text, p_layer text, p_label text default null)
returns uuid language plpgsql security definer set search_path = bukatsu, pg_temp as $$
declare w_id uuid; new_id uuid; n int;
begin
  if not bukatsu.can_edit(p_school, p_layer, '*') and not bukatsu.is_member(p_school, 'teacher') then
    raise exception '編集権限がありません';
  end if;
  select id into w_id from bukatsu.source_versions
   where school_id = p_school and layer_id = p_layer and status = 'working'
   order by imported_at desc limit 1;
  if w_id is null then raise exception '編集中の内容がありません'; end if;
  insert into bukatsu.source_versions (school_id, layer_id, label, source, status, approved_at, approved_by)
  values (p_school, p_layer, coalesce(p_label, '公開 ' || to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI')), 'publish', 'approved', now(), auth.uid())
  returning id into new_id;
  insert into bukatsu.events (version_id, school_id, layer_id, uid, category, slots, date, end_date, kind, time_start, time_end, place, title, note, source_ref, confidence, draft, created_by)
  select new_id, school_id, layer_id, uid, category, slots, date, end_date, kind, time_start, time_end, place, title, note, source_ref, confidence, false, created_by
  from bukatsu.events where version_id = w_id and draft = false;
  get diagnostics n = row_count;
  update bukatsu.source_versions set event_count = n where id = new_id;
  update bukatsu.layers set published_at = now() where school_id = p_school and id = p_layer;
  return new_id;
end $$;
grant execute on function bukatsu.publish_layer(text, text, text) to authenticated;

-- ---------- 招待: メールで既存ユーザーならすぐ、未登録なら招待表に ----------
create table if not exists bukatsu.invites (
  id          uuid primary key default gen_random_uuid(),
  school_id   text not null references bukatsu.schools(id) on delete cascade,
  email       text not null,
  role        text not null default 'teacher' check (role in ('admin','teacher','viewer')),
  grants      jsonb,                                     -- {"club:soccer": ["トップ"], "manual:teacher": null}
  invited_by  uuid,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);
alter table bukatsu.invites enable row level security;
create policy invites_admin on bukatsu.invites for all using (bukatsu.is_member(school_id, 'admin')) with check (bukatsu.is_member(school_id, 'admin'));
grant select, insert, update, delete on bukatsu.invites to authenticated, service_role;

create or replace function bukatsu.invite_member(p_school text, p_email text, p_role text default 'teacher', p_grants jsonb default null)
returns text language plpgsql security definer set search_path = bukatsu, pg_temp as $$
declare uid uuid; k text; v jsonb;
begin
  if not bukatsu.is_member(p_school, 'admin') then raise exception '管理者だけが招待できます'; end if;
  select id into uid from auth.users where lower(email) = lower(p_email) limit 1;
  insert into bukatsu.invites (school_id, email, role, grants, invited_by, accepted_at)
  values (p_school, lower(p_email), p_role, p_grants, auth.uid(), case when uid is null then null else now() end);
  if uid is null then return 'invited'; end if;
  insert into bukatsu.memberships (user_id, school_id, role) values (uid, p_school, p_role)
    on conflict (user_id, school_id) do update set role = excluded.role;
  if p_grants is not null then
    for k, v in select * from jsonb_each(p_grants) loop
      insert into bukatsu.layer_grants (user_id, school_id, layer_id, categories)
      values (uid, p_school, k, case when v = 'null'::jsonb then null else array(select jsonb_array_elements_text(v)) end)
      on conflict (user_id, school_id, layer_id) do update set categories = excluded.categories;
    end loop;
  end if;
  return 'member';
end $$;
grant execute on function bukatsu.invite_member(text, text, text, jsonb) to authenticated;

-- ログイン時に未承諾の招待を取り込む
create or replace function bukatsu.claim_invites()
returns int language plpgsql security definer set search_path = bukatsu, pg_temp as $$
declare r record; n int := 0; k text; v jsonb; my_email text;
begin
  select lower(email) into my_email from auth.users where id = auth.uid();
  if my_email is null then return 0; end if;
  for r in select * from bukatsu.invites where email = my_email and accepted_at is null loop
    insert into bukatsu.memberships (user_id, school_id, role) values (auth.uid(), r.school_id, r.role)
      on conflict (user_id, school_id) do update set role = excluded.role;
    if r.grants is not null then
      for k, v in select * from jsonb_each(r.grants) loop
        insert into bukatsu.layer_grants (user_id, school_id, layer_id, categories)
        values (auth.uid(), r.school_id, k, case when v = 'null'::jsonb then null else array(select jsonb_array_elements_text(v)) end)
        on conflict (user_id, school_id, layer_id) do update set categories = excluded.categories;
      end loop;
    end if;
    update bukatsu.invites set accepted_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function bukatsu.claim_invites() to authenticated;

-- can_edit: 班が複数の予定は、どれか 1 つでも許可された班なら編集可。'*' は層全体の権限確認用
create or replace function bukatsu.can_edit(sid text, lid text, cat text)
returns boolean language sql stable security definer set search_path = bukatsu, pg_temp as $$
  select bukatsu.is_member(sid, 'admin')
      or exists (
        select 1 from bukatsu.layer_grants g
        where g.user_id = auth.uid() and g.school_id = sid and g.layer_id = lid
          and (g.categories is null or cat = any(g.categories) or cat = '*')
      );
$$;
