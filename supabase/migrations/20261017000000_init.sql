-- bukatsu-schedule 初期スキーマ（docs/plan.md 3 章）
-- すべて専用スキーマ bukatsu に置く。public など他のスキーマには触れない（既存の Supabase プロジェクトに同居できるように）。
-- 依存: 拡張なし（gen_random_uuid と sha256 は PostgreSQL 本体の関数）。auth.users は参照のみ。

create schema if not exists bukatsu;

grant usage on schema bukatsu to anon, authenticated, service_role;

-- ---------- ワークスペース（学校。将来は個人・職場も同じ入れ物） ----------
create table bukatsu.schools (
  id          text primary key,
  name        text not null,
  settings    jsonb not null default '{"afterSchoolStart":"15:30","defaultDurationMin":120,"fiscalYearStartMonth":4}',
  created_at  timestamptz not null default now()
);

-- 層 = カレンダー（学校予定 / 部 / 外部 / 手入力）
create table bukatsu.layers (
  school_id       text not null references bukatsu.schools(id) on delete cascade,
  id              text not null,
  type            text not null check (type in ('school','club','external','manual')),
  name            text not null,
  color           text,
  default_visible boolean not null default true,
  sort            int not null default 0,
  primary key (school_id, id)
);

-- 取り込み 1 回分 = 1 版。AI 読みは pending で入り、承認されて approved になる
create table bukatsu.source_versions (
  id            uuid primary key default gen_random_uuid(),
  school_id     text not null,
  layer_id      text not null,
  label         text not null,
  source        text,
  ai_model      text,
  ai_mode       text,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  event_count   int not null default 0,
  imported_at   timestamptz not null default now(),
  approved_at   timestamptz,
  approved_by   uuid,
  foreign key (school_id, layer_id) references bukatsu.layers(school_id, id) on delete cascade
);
create index on bukatsu.source_versions (school_id, layer_id, imported_at desc);

create table bukatsu.events (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references bukatsu.source_versions(id) on delete cascade,
  school_id   text not null,
  layer_id    text not null,
  uid         text not null,
  category    text not null default '全体',
  date        date not null,
  end_date    date,
  kind        text not null,
  time_start  time,
  time_end    time,
  place       text,
  title       text not null,
  note        text,
  source_ref  text,
  confidence  real,
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  unique (version_id, uid)
);
create index on bukatsu.events (school_id, date);
create index on bukatsu.events (version_id);

-- 版と版の差分（取り込み時に計算して保存。差分モードと変更一覧の元）
create table bukatsu.event_changes (
  id            uuid primary key default gen_random_uuid(),
  school_id     text not null,
  layer_id      text not null,
  from_version  uuid references bukatsu.source_versions(id) on delete cascade,
  to_version    uuid not null references bukatsu.source_versions(id) on delete cascade,
  uid           text not null,
  change        text not null check (change in ('added','removed','changed')),
  fields        jsonb not null default '[]',
  before        jsonb,
  after         jsonb
);
create index on bukatsu.event_changes (to_version);

-- 利用者とワークスペースの関係。admin = ARCA、teacher = 入力可、viewer = 閲覧のみ
create table bukatsu.memberships (
  user_id    uuid not null references auth.users(id) on delete cascade,
  school_id  text not null references bukatsu.schools(id) on delete cascade,
  role       text not null default 'teacher' check (role in ('admin','teacher','viewer')),
  primary key (user_id, school_id)
);

-- 層（とスロット = カテゴリ）単位の編集権限。categories が null ならその層の全カテゴリ
create table bukatsu.layer_grants (
  user_id     uuid not null references auth.users(id) on delete cascade,
  school_id   text not null,
  layer_id    text not null,
  categories  text[],
  primary key (user_id, school_id, layer_id),
  foreign key (school_id, layer_id) references bukatsu.layers(school_id, id) on delete cascade
);

-- 人ごとの層の表示/非表示
create table bukatsu.user_prefs (
  user_id           uuid not null references auth.users(id) on delete cascade,
  school_id         text not null references bukatsu.schools(id) on delete cascade,
  hidden_layers     text[] not null default '{}',
  hidden_categories text[] not null default '{}',
  primary key (user_id, school_id)
);

-- 閲覧 URL / ICS 用のトークン（リンクを知っている人向け）。scope で層・カテゴリ・期間・個別イベントを絞れる
create table bukatsu.share_links (
  token       text primary key default encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'),
  school_id   text not null references bukatsu.schools(id) on delete cascade,
  label       text,
  -- 例: {"layers":["club:track"],"categories":["トップ"],"from":"2026-10-01","to":"2026-12-31","uids":[...]}
  scope       jsonb,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

-- ---------- 現在有効なイベント = 各層の最新 approved 版 ----------
-- security_invoker: ビュー経由でも呼び出した人の RLS を適用する
create view bukatsu.current_versions with (security_invoker = true) as
select distinct on (school_id, layer_id) *
from bukatsu.source_versions
where status = 'approved'
order by school_id, layer_id, imported_at desc;

create view bukatsu.current_events with (security_invoker = true) as
select e.*
from bukatsu.events e
join bukatsu.current_versions v on v.id = e.version_id;

-- ---------- 権限 ----------
grant select, insert, update, delete on all tables in schema bukatsu to authenticated, service_role;
grant select on bukatsu.current_versions, bukatsu.current_events to authenticated, service_role;
-- anon はテーブルを直接読めない（閲覧は schedule_by_token 経由）

alter table bukatsu.schools enable row level security;
alter table bukatsu.layers enable row level security;
alter table bukatsu.source_versions enable row level security;
alter table bukatsu.events enable row level security;
alter table bukatsu.event_changes enable row level security;
alter table bukatsu.memberships enable row level security;
alter table bukatsu.layer_grants enable row level security;
alter table bukatsu.user_prefs enable row level security;
alter table bukatsu.share_links enable row level security;

create or replace function bukatsu.is_member(sid text, min_role text default 'viewer')
returns boolean language sql stable security definer set search_path = bukatsu, pg_temp as $$
  select exists (
    select 1 from bukatsu.memberships m
    where m.user_id = auth.uid() and m.school_id = sid
      and case min_role when 'admin' then m.role = 'admin'
                        when 'teacher' then m.role in ('admin','teacher')
                        else true end
  );
$$;

-- その層・カテゴリを編集できるか（admin は常に可。teacher は layer_grants に従う）
create or replace function bukatsu.can_edit(sid text, lid text, cat text)
returns boolean language sql stable security definer set search_path = bukatsu, pg_temp as $$
  select bukatsu.is_member(sid, 'admin')
      or exists (
        select 1 from bukatsu.layer_grants g
        where g.user_id = auth.uid() and g.school_id = sid and g.layer_id = lid
          and (g.categories is null or cat = any(g.categories))
      );
$$;

create policy schools_read on bukatsu.schools for select using (bukatsu.is_member(id));
create policy layers_read on bukatsu.layers for select using (bukatsu.is_member(school_id));
create policy layers_admin on bukatsu.layers for all using (bukatsu.is_member(school_id, 'admin')) with check (bukatsu.is_member(school_id, 'admin'));
create policy versions_read on bukatsu.source_versions for select using (bukatsu.is_member(school_id));
create policy versions_write on bukatsu.source_versions for all using (bukatsu.is_member(school_id, 'teacher')) with check (bukatsu.is_member(school_id, 'teacher'));
create policy events_read on bukatsu.events for select using (bukatsu.is_member(school_id));
create policy events_write on bukatsu.events for all using (bukatsu.can_edit(school_id, layer_id, category)) with check (bukatsu.can_edit(school_id, layer_id, category));
create policy changes_read on bukatsu.event_changes for select using (bukatsu.is_member(school_id));
create policy memberships_self on bukatsu.memberships for select using (user_id = auth.uid() or bukatsu.is_member(school_id, 'admin'));
create policy grants_read on bukatsu.layer_grants for select using (user_id = auth.uid() or bukatsu.is_member(school_id, 'admin'));
create policy grants_admin on bukatsu.layer_grants for all using (bukatsu.is_member(school_id, 'admin')) with check (bukatsu.is_member(school_id, 'admin'));
create policy prefs_self on bukatsu.user_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy share_links_rw on bukatsu.share_links for all using (bukatsu.is_member(school_id, 'teacher')) with check (bukatsu.is_member(school_id, 'teacher'));

-- ---------- 閲覧 URL（ログイン不要）: トークンで現在のイベントを返す ----------
create or replace function bukatsu.schedule_by_token(p_token text)
returns table (
  school_id text, school_name text, layer_id text, layer_name text, layer_type text, layer_color text,
  uid text, category text, date date, end_date date, kind text, time_start time, time_end time,
  place text, title text, note text, version_label text
) language sql stable security definer set search_path = bukatsu, pg_temp as $$
  select s.id, s.name, l.id, l.name, l.type, l.color,
         e.uid, e.category, e.date, e.end_date, e.kind, e.time_start, e.time_end,
         e.place, e.title, e.note, v.label
  from bukatsu.share_links sl
  join bukatsu.schools s on s.id = sl.school_id
  join bukatsu.layers l on l.school_id = s.id
  join bukatsu.source_versions v on v.school_id = l.school_id and v.layer_id = l.id and v.status = 'approved'
  join bukatsu.events e on e.version_id = v.id
  where sl.token = p_token and sl.revoked_at is null
    and v.id = (select v2.id from bukatsu.source_versions v2
                where v2.school_id = l.school_id and v2.layer_id = l.id and v2.status = 'approved'
                order by v2.imported_at desc limit 1)
    and (sl.scope->'layers' is null or (sl.scope->'layers') ? l.id)
    and (sl.scope->'categories' is null or e.category = '全体' or (sl.scope->'categories') ? e.category)
    and (sl.scope->>'from' is null or coalesce(e.end_date, e.date) >= (sl.scope->>'from')::date)
    and (sl.scope->>'to' is null or e.date <= (sl.scope->>'to')::date)
    and (sl.scope->'uids' is null or (sl.scope->'uids') ? e.uid);
$$;
revoke all on function bukatsu.schedule_by_token(text) from public;
grant execute on function bukatsu.schedule_by_token(text) to anon, authenticated, service_role;
