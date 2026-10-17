-- 取り込み（確認待ち）の反映を「差し替え」ではなく「その月だけ入れ替え」にする。
-- 月間の PDF を毎月取り込む運用で、11 月を反映しても 10 月が消えないように。
--  1. 確認待ちの版に含まれる月（YYYY-MM）を求める
--  2. 公開中（最新 approved）の、その月以外の予定（下書き除く）を確認待ちの版に写す → 版が全体のスナップショットになる
--  3. 確認待ちの版を approved にする
--  4. 手動公開のカレンダーは、編集中（working）の版も同じ月を入れ替える（下書きは残す）。編集画面と公開内容がずれないように
create or replace function bukatsu.approve_version(p_version uuid)
returns void language plpgsql security definer set search_path = bukatsu, pg_temp as $$
declare v record; cur uuid; w uuid; months text[];
begin
  select * into v from bukatsu.source_versions where id = p_version;
  if v is null then raise exception '版が見つかりません'; end if;
  if v.status <> 'pending' then raise exception 'この版は確認待ちではありません'; end if;
  if not bukatsu.can_edit(v.school_id, v.layer_id, '*') and not bukatsu.is_member(v.school_id, 'teacher') then
    raise exception '編集権限がありません';
  end if;

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
     set status = 'approved', approved_at = now(), approved_by = auth.uid(),
         event_count = (select count(*) from bukatsu.events where version_id = p_version)
   where id = p_version;

  -- 手動公開: 編集中の版も同じ月を入れ替える
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
grant execute on function bukatsu.approve_version(uuid) to authenticated;
