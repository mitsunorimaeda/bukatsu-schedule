-- シートの自動更新（サーバーの定期実行）が、人のログインなしで「月だけ入れ替え」の反映をできるように。
-- approve_version の中身を _approve_merge に出し、service_role だけが呼べる approve_version_system を足す。
create or replace function bukatsu._approve_merge(p_version uuid, p_by uuid)
returns void language plpgsql security definer set search_path = bukatsu, pg_temp as $$
declare v record; cur uuid; w uuid; months text[];
begin
  select * into v from bukatsu.source_versions where id = p_version;
  if v is null then raise exception '版が見つかりません'; end if;
  if v.status <> 'pending' then raise exception 'この版は確認待ちではありません'; end if;

  select array_agg(distinct to_char(date, 'YYYY-MM')) into months from bukatsu.events where version_id = p_version;
  months := coalesce(months, '{}');

  select id into cur from bukatsu.source_versions
   where school_id = v.school_id and layer_id = v.layer_id and status = 'approved'
   order by imported_at desc limit 1;
  if cur is not null then
    insert into bukatsu.events (version_id, school_id, layer_id, uid, category, slots, date, end_date, kind, time_start, time_end, place, title, note, source_ref, confidence, draft, created_by)
    select p_version, school_id, layer_id, uid, category, slots, date, end_date, kind, time_start, time_end, place, title, note, source_ref, confidence, false, created_by
      from bukatsu.events
     where version_id = cur and draft = false and not (to_char(date, 'YYYY-MM') = any(months));
  end if;

  update bukatsu.source_versions
     set status = 'approved', approved_at = now(), approved_by = p_by,
         event_count = (select count(*) from bukatsu.events where version_id = p_version)
   where id = p_version;

  select id into w from bukatsu.source_versions
   where school_id = v.school_id and layer_id = v.layer_id and status = 'working'
   order by imported_at desc limit 1;
  if w is not null then
    delete from bukatsu.events where version_id = w and draft = false and to_char(date, 'YYYY-MM') = any(months);
    insert into bukatsu.events (version_id, school_id, layer_id, uid, category, slots, date, end_date, kind, time_start, time_end, place, title, note, source_ref, confidence, draft, created_by)
    select w, school_id, layer_id, uid, category, slots, date, end_date, kind, time_start, time_end, place, title, note, source_ref, confidence, false, created_by
      from bukatsu.events where version_id = p_version and to_char(date, 'YYYY-MM') = any(months);
  end if;

  update bukatsu.layers set published_at = now() where school_id = v.school_id and id = v.layer_id;
end $$;
revoke all on function bukatsu._approve_merge(uuid, uuid) from public, anon, authenticated;

create or replace function bukatsu.approve_version(p_version uuid)
returns void language plpgsql security definer set search_path = bukatsu, pg_temp as $$
declare v record;
begin
  select * into v from bukatsu.source_versions where id = p_version;
  if v is null then raise exception '版が見つかりません'; end if;
  if not bukatsu.can_edit(v.school_id, v.layer_id, '*') and not bukatsu.is_member(v.school_id, 'teacher') then
    raise exception '編集権限がありません';
  end if;
  perform bukatsu._approve_merge(p_version, auth.uid());
end $$;
grant execute on function bukatsu.approve_version(uuid) to authenticated;

-- 定期実行（service_role）専用。人の権限確認はしない
create or replace function bukatsu.approve_version_system(p_version uuid)
returns void language plpgsql security definer set search_path = bukatsu, pg_temp as $$
begin
  perform bukatsu._approve_merge(p_version, null);
end $$;
revoke all on function bukatsu.approve_version_system(uuid) from public, anon, authenticated;
grant execute on function bukatsu.approve_version_system(uuid) to service_role;
