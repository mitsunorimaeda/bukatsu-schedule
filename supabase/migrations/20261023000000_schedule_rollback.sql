-- 公開の予約（手動公開のカレンダーを指定日時に公開）と、前の公開版への巻き戻し。
alter table bukatsu.layers add column if not exists publish_scheduled_at timestamptz;
alter table bukatsu.layers add column if not exists publish_scheduled_by uuid;

-- 公開の中身（publish_layer から出したもの）
create or replace function bukatsu._publish(p_school text, p_layer text, p_label text, p_by uuid)
returns uuid language plpgsql security definer set search_path = bukatsu, pg_temp as $$
declare w_id uuid; new_id uuid; n int;
begin
  select id into w_id from bukatsu.source_versions
   where school_id = p_school and layer_id = p_layer and status = 'working'
   order by imported_at desc limit 1;
  if w_id is null then raise exception '編集中の内容がありません'; end if;
  insert into bukatsu.source_versions (school_id, layer_id, label, source, status, approved_at, approved_by)
  values (p_school, p_layer, coalesce(p_label, '公開 ' || to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI')), 'publish', 'approved', now(), p_by)
  returning id into new_id;
  insert into bukatsu.events (version_id, school_id, layer_id, uid, category, slots, date, end_date, kind, time_start, time_end, place, title, note, source_ref, confidence, draft, created_by)
  select new_id, school_id, layer_id, uid, category, slots, date, end_date, kind, time_start, time_end, place, title, note, source_ref, confidence, false, created_by
  from bukatsu.events where version_id = w_id and draft = false;
  get diagnostics n = row_count;
  update bukatsu.source_versions set event_count = n where id = new_id;
  update bukatsu.layers set published_at = now(), publish_scheduled_at = null, publish_scheduled_by = null where school_id = p_school and id = p_layer;
  return new_id;
end $$;
revoke all on function bukatsu._publish(text, text, text, uuid) from public, anon, authenticated;

create or replace function bukatsu.publish_layer(p_school text, p_layer text, p_label text default null)
returns uuid language plpgsql security definer set search_path = bukatsu, pg_temp as $$
begin
  if not bukatsu.can_edit(p_school, p_layer, '*') and not bukatsu.is_member(p_school, 'teacher') then
    raise exception '編集権限がありません';
  end if;
  return bukatsu._publish(p_school, p_layer, p_label, auth.uid());
end $$;
grant execute on function bukatsu.publish_layer(text, text, text) to authenticated;

-- 予約: p_at が null なら取り消し
create or replace function bukatsu.schedule_publish(p_school text, p_layer text, p_at timestamptz)
returns void language plpgsql security definer set search_path = bukatsu, pg_temp as $$
begin
  if not bukatsu.can_edit(p_school, p_layer, '*') and not bukatsu.is_member(p_school, 'teacher') then
    raise exception '編集権限がありません';
  end if;
  if p_at is not null and p_at <= now() then raise exception '未来の日時を指定してください'; end if;
  update bukatsu.layers set publish_scheduled_at = p_at, publish_scheduled_by = case when p_at is null then null else auth.uid() end
   where school_id = p_school and id = p_layer;
end $$;
grant execute on function bukatsu.schedule_publish(text, text, timestamptz) to authenticated;

-- 定期実行（service_role）: 期限の来た予約を公開する。公開したカレンダーを返す
create or replace function bukatsu.run_due_publishes()
returns table (school_id text, layer_id text, version_id uuid) language plpgsql security definer set search_path = bukatsu, pg_temp as $$
declare r record; v uuid;
begin
  for r in select l.school_id, l.id, l.publish_scheduled_by from bukatsu.layers l where l.publish_scheduled_at is not null and l.publish_scheduled_at <= now() loop
    begin
      v := bukatsu._publish(r.school_id, r.id, '予約公開 ' || to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI'), r.publish_scheduled_by);
    exception when others then
      -- 編集中の版が無いなど。予約は消して次に進む
      update bukatsu.layers set publish_scheduled_at = null, publish_scheduled_by = null where bukatsu.layers.school_id = r.school_id and id = r.id;
      v := null;
    end;
    school_id := r.school_id; layer_id := r.id; version_id := v;
    return next;
  end loop;
end $$;
revoke all on function bukatsu.run_due_publishes() from public, anon, authenticated;
grant execute on function bukatsu.run_due_publishes() to service_role;

-- 巻き戻し: 選んだ公開版の内容を、新しい公開版として写す（履歴は残る）。手動公開なら編集中の版も揃える（下書きは残す）
create or replace function bukatsu.rollback_to_version(p_version uuid)
returns uuid language plpgsql security definer set search_path = bukatsu, pg_temp as $$
declare v record; new_id uuid; w uuid; n int;
begin
  select * into v from bukatsu.source_versions where id = p_version;
  if v is null then raise exception '版が見つかりません'; end if;
  if v.status <> 'approved' then raise exception '公開された版だけに戻せます'; end if;
  if not bukatsu.can_edit(v.school_id, v.layer_id, '*') and not bukatsu.is_member(v.school_id, 'teacher') then
    raise exception '編集権限がありません';
  end if;
  insert into bukatsu.source_versions (school_id, layer_id, label, source, status, approved_at, approved_by)
  values (v.school_id, v.layer_id, '「' || v.label || '」に戻す', 'rollback', 'approved', now(), auth.uid())
  returning id into new_id;
  insert into bukatsu.events (version_id, school_id, layer_id, uid, category, slots, date, end_date, kind, time_start, time_end, place, title, note, source_ref, confidence, draft, created_by)
  select new_id, school_id, layer_id, uid, category, slots, date, end_date, kind, time_start, time_end, place, title, note, source_ref, confidence, false, created_by
  from bukatsu.events where version_id = p_version and draft = false;
  get diagnostics n = row_count;
  update bukatsu.source_versions set event_count = n where id = new_id;
  select id into w from bukatsu.source_versions
   where school_id = v.school_id and layer_id = v.layer_id and status = 'working'
   order by imported_at desc limit 1;
  if w is not null then
    delete from bukatsu.events where version_id = w and draft = false;
    insert into bukatsu.events (version_id, school_id, layer_id, uid, category, slots, date, end_date, kind, time_start, time_end, place, title, note, source_ref, confidence, draft, created_by)
    select w, school_id, layer_id, uid, category, slots, date, end_date, kind, time_start, time_end, place, title, note, source_ref, confidence, false, created_by
    from bukatsu.events where version_id = new_id;
  end if;
  update bukatsu.layers set published_at = now() where school_id = v.school_id and id = v.layer_id;
  return new_id;
end $$;
grant execute on function bukatsu.rollback_to_version(uuid) to authenticated;
