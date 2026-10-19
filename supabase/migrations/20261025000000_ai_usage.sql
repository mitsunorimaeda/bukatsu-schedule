-- AI 読み取りの使用記録と、学校ごとの月の上限（schools.settings.aiMonthlyYen、既定 1000 円）
-- 記録は /api/import（service_role）だけが書く。メンバーは自分の学校の分を読める（画面に今月の使用額を出す）
create table if not exists bukatsu.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  school_id     text not null references bukatsu.schools(id) on delete cascade,
  layer_id      text,
  user_id       uuid,
  at            timestamptz not null default now(),
  model         text,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  cost_yen      numeric(10,2) not null default 0,
  ok            boolean not null default true
);
create index if not exists ai_usage_school_at on bukatsu.ai_usage (school_id, at desc);
alter table bukatsu.ai_usage enable row level security;
drop policy if exists ai_usage_read on bukatsu.ai_usage;
create policy ai_usage_read on bukatsu.ai_usage for select using (bukatsu.is_member(school_id));
grant select on bukatsu.ai_usage to authenticated;
grant select, insert, update, delete on bukatsu.ai_usage to service_role;
