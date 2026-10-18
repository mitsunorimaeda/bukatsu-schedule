/** Supabase（bukatsu スキーマ）とのやり取り。画面はこのファイルの関数だけを呼ぶ */
import { createClient, type Session } from '@supabase/supabase-js';
import { DEFAULT_SCHOOL_SETTINGS } from '@bukatsu/core/browser';
import type { LayerType, SchoolSettings } from '@bukatsu/core/browser';
import { diffEvents, type Calendar, type UiEvent, type Version, type Workspace } from './model';

function makeClient(url: string, key: string) {
  return createClient(url, key, { db: { schema: 'bukatsu' } });
}
type Client = ReturnType<typeof makeClient>;
let client: Client | null = null;

export function supabase(): Client | null {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) return null;
  client = makeClient(url, key);
  return client;
}
function must(): Client {
  const sb = supabase();
  if (!sb) throw new Error('接続設定（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）がありません');
  return sb;
}
function fail(prefix: string, error: { message: string } | null): never {
  throw new Error(`${prefix}: ${error?.message ?? '不明なエラー'}`);
}

// ---------- 行の変換 ----------
interface EventRow {
  id: string;
  version_id: string;
  school_id: string;
  layer_id: string;
  uid: string;
  category: string;
  slots: string[] | null;
  date: string;
  end_date: string | null;
  kind: UiEvent['kind'];
  time_start: string | null;
  time_end: string | null;
  place: string | null;
  title: string;
  note: string | null;
  source_ref: string | null;
  confidence: number | null;
  draft: boolean;
}
interface LayerRow {
  school_id: string;
  id: string;
  type: LayerType;
  name: string;
  color: string | null;
  sort: number;
  slots: string[];
  publish_mode: 'auto' | 'manual';
  source: Calendar['source'];
  published_at: string | null;
  publish_scheduled_at: string | null;
}
interface VersionRow {
  id: string;
  school_id: string;
  layer_id: string;
  label: string;
  source: string | null;
  ai_mode: string | null;
  status: Version['status'];
  imported_at: string;
  event_count: number;
}
const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : undefined);

function toEvent(r: EventRow): UiEvent {
  return {
    id: r.id,
    versionId: r.version_id,
    uid: r.uid,
    calendarId: r.layer_id,
    slots: r.slots?.length ? r.slots : [r.category],
    date: r.date,
    endDate: r.end_date ?? undefined,
    kind: r.kind,
    timeStart: hhmm(r.time_start),
    timeEnd: hhmm(r.time_end),
    place: r.place ?? undefined,
    title: r.title,
    note: r.note ?? undefined,
    draft: r.draft,
    confidence: r.confidence ?? undefined,
    sourceRef: r.source_ref ?? undefined,
  };
}
function toRow(schoolId: string, e: UiEvent, versionId: string) {
  return {
    version_id: versionId,
    school_id: schoolId,
    layer_id: e.calendarId,
    uid: e.uid,
    category: e.slots[0],
    slots: e.slots,
    date: e.date,
    end_date: e.endDate ?? null,
    kind: e.kind,
    time_start: e.timeStart ?? null,
    time_end: e.timeEnd ?? null,
    place: e.place ?? null,
    title: e.title,
    note: e.note ?? null,
    source_ref: e.sourceRef ?? null,
    confidence: e.confidence ?? null,
    draft: e.draft,
  };
}
function toVersion(v: VersionRow): Version {
  return { id: v.id, label: v.label, status: v.status, importedAt: v.imported_at, eventCount: v.event_count, source: v.source ?? undefined, aiMode: v.ai_mode ?? undefined };
}

// ---------- ログイン ----------
export async function getSession(): Promise<Session | null> {
  const sb = supabase();
  return sb ? (await sb.auth.getSession()).data.session : null;
}
export function onAuthChange(cb: (s: Session | null) => void): () => void {
  const sb = supabase();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((_e, s) => cb(s));
  return () => data.subscription.unsubscribe();
}
export async function signInWithEmail(email: string): Promise<void> {
  const { error } = await must().auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) fail('ログイン用メールを送れませんでした', error);
}
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await must().auth.signInWithPassword({ email, password });
  if (error) fail('ログインできませんでした', error);
}
export async function signOut(): Promise<void> {
  await must().auth.signOut();
}

// ---------- ワークスペース ----------
export interface WorkspaceSummary {
  id: string;
  name: string;
  role: Workspace['role'];
  calendars: { id: string; name: string; color: string }[];
}
export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const sb = must();
  await sb.rpc('claim_invites').then(() => undefined, () => undefined);
  const uid = (await sb.auth.getUser()).data.user?.id ?? '';
  // 管理者は他の人のメンバー行も読めるので、自分の分だけに絞る
  const { data, error } = await sb.from('memberships').select('school_id, role, schools(name)').eq('user_id', uid);
  if (error) fail('一覧を読めませんでした', error);
  const ids = (data ?? []).map((m) => m.school_id as string);
  const { data: layers } = ids.length ? await sb.from('layers').select('school_id,id,name,color').in('school_id', ids).order('sort') : { data: [] };
  return (data ?? []).map((m) => ({
    id: m.school_id as string,
    role: m.role as Workspace['role'],
    name: ((m.schools as unknown as { name: string } | null)?.name ?? m.school_id) as string,
    calendars: ((layers ?? []) as LayerRow[]).filter((l) => l.school_id === m.school_id).map((l) => ({ id: l.id, name: l.name, color: l.color ?? '#888' })),
  }));
}
export async function createWorkspace(id: string, name: string): Promise<string> {
  const { data, error } = await must().rpc('create_workspace', { p_id: id, p_name: name });
  if (error) fail('予定表を作れませんでした', error);
  return data as string;
}

export async function loadWorkspace(id: string): Promise<Workspace> {
  const sb = must();
  const uid = (await sb.auth.getUser()).data.user?.id ?? '';
  // 管理者は他の人のメンバー行・権限行も読めるので、自分の分だけに絞る
  const [{ data: school, error: e1 }, { data: layers, error: e2 }, { data: versions, error: e3 }, { data: grants }, { data: mem }] = await Promise.all([
    sb.from('schools').select('*').eq('id', id).single(),
    sb.from('layers').select('*').eq('school_id', id).order('sort'),
    sb.from('source_versions').select('*').eq('school_id', id).order('imported_at', { ascending: false }),
    sb.from('layer_grants').select('layer_id, categories').eq('school_id', id).eq('user_id', uid),
    sb.from('memberships').select('role').eq('school_id', id).eq('user_id', uid).maybeSingle(),
  ]);
  if (e1 || e2 || e3) fail('予定表を読めませんでした', e1 ?? e2 ?? e3);

  // 層ごとに: 公開中（最新 approved）、1 つ前の approved、working、確認待ち（公開中より新しい pending）
  type Pick = { approved?: VersionRow; previous?: VersionRow; working?: VersionRow; pending?: VersionRow };
  const pick = new Map<string, Pick>();
  for (const v of (versions ?? []) as VersionRow[]) {
    const p = pick.get(v.layer_id) ?? pick.set(v.layer_id, {}).get(v.layer_id)!;
    if (v.status === 'approved') {
      if (!p.approved) p.approved = v;
      else if (!p.previous) p.previous = v;
    } else if (v.status === 'working' && !p.working) p.working = v;
    else if (v.status === 'pending' && !p.pending && !p.approved) p.pending = v;
  }
  const wanted = [...pick.values()].flatMap((p) => [p.approved, p.previous, p.working, p.pending].filter(Boolean) as VersionRow[]);
  const ids = wanted.map((v) => v.id);
  const { data: rows, error: e4 } = ids.length ? await sb.from('events').select('*').in('version_id', ids).order('date') : { data: [], error: null };
  if (e4) fail('予定を読めませんでした', e4);
  const byVersion = new Map<string, UiEvent[]>();
  for (const r of (rows ?? []) as EventRow[]) (byVersion.get(r.version_id) ?? byVersion.set(r.version_id, []).get(r.version_id)!).push(toEvent(r));
  const evs = (v?: VersionRow) => (v ? byVersion.get(v.id) ?? [] : []);

  const calendars: Calendar[] = ((layers ?? []) as LayerRow[]).map((l) => {
    const p = pick.get(l.id) ?? {};
    const published = evs(p.approved).filter((e) => !e.draft);
    const working = l.publish_mode === 'manual' && p.working ? evs(p.working) : evs(p.approved);
    const c: Calendar = {
      id: l.id,
      name: l.name,
      color: l.color ?? '#888888',
      type: l.type,
      slots: l.slots?.length ? l.slots : ['全体'],
      publishMode: l.publish_mode,
      source: l.source,
      publishedAt: l.published_at ?? undefined,
      publishScheduledAt: l.publish_scheduled_at ?? undefined,
      versions: ((versions ?? []) as VersionRow[]).filter((v) => v.layer_id === l.id).map(toVersion),
      events: working,
      published,
    };
    if (p.pending) {
      // 反映は「確認待ちに含まれる月だけ入れ替え」なので、違いもその月の中で見る
      const pe = evs(p.pending);
      const months = [...new Set(pe.map((e) => e.date.slice(0, 7)))].sort();
      c.pending = { version: toVersion(p.pending), events: pe, changes: diffEvents(published.filter((e) => months.includes(e.date.slice(0, 7))), pe), months };
    }
    if (p.previous) c.previous = { version: toVersion(p.previous), events: evs(p.previous) };
    return c;
  });

  const g: Workspace['grants'] = {};
  for (const r of (grants ?? []) as { layer_id: string; categories: string[] | null }[]) g[r.layer_id] = r.categories;
  return {
    id: school.id,
    name: school.name,
    settings: { ...DEFAULT_SCHOOL_SETTINGS, ...(school.settings as Partial<SchoolSettings>) },
    calendars,
    role: (mem?.role as Workspace['role'] | undefined) ?? 'viewer',
    grants: g,
  };
}

// ---------- カレンダー ----------
export interface CalendarInput {
  id?: string;
  name: string;
  color: string;
  type: LayerType;
  slots: string[];
  publishMode: 'auto' | 'manual';
  source: Calendar['source'];
}
export async function saveCalendar(schoolId: string, c: CalendarInput, sort?: number): Promise<string> {
  const sb = must();
  const id = c.id ?? `cal:${Date.now().toString(36)}`;
  const row: Record<string, unknown> = { school_id: schoolId, id, type: c.type, name: c.name, color: c.color, slots: c.slots, publish_mode: c.publishMode, source: c.source };
  if (sort !== undefined) row.sort = sort;
  const { error } = await sb.from('layers').upsert(row);
  if (error) fail('カレンダーを保存できませんでした', error);
  return id;
}
export async function deleteCalendar(schoolId: string, id: string): Promise<void> {
  const { error } = await must().from('layers').delete().eq('school_id', schoolId).eq('id', id);
  if (error) fail('カレンダーを削除できませんでした', error);
}
/** 班の改名・移動: 編集対象の版と公開中の版の予定の班を付け替える */
export async function remapSlots(_schoolId: string, cal: Calendar, mapping: Record<string, string | null>): Promise<void> {
  const sb = must();
  const versionIds = [...new Set([...cal.events, ...cal.published].map((e) => e.versionId).filter(Boolean))] as string[];
  if (!versionIds.length) return;
  const { data, error } = await sb.from('events').select('id, slots, category').in('version_id', versionIds);
  if (error) fail('予定を読めませんでした', error);
  for (const r of (data ?? []) as { id: string; slots: string[] | null; category: string }[]) {
    const cur = r.slots?.length ? r.slots : [r.category];
    let next = cur.map((s) => (s in mapping ? mapping[s] : s)).filter((s): s is string => !!s);
    next = [...new Set(next)];
    if (JSON.stringify(next) === JSON.stringify(cur)) continue;
    if (!next.length) {
      const { error: de } = await sb.from('events').delete().eq('id', r.id);
      if (de) fail('予定を削除できませんでした', de);
    } else {
      const { error: ue } = await sb.from('events').update({ slots: next, category: next[0] }).eq('id', r.id);
      if (ue) fail('予定を更新できませんでした', ue);
    }
  }
}

// ---------- 予定 ----------
/** 編集先の版。手動公開なら working（無ければ公開中の内容を写して作る）、自動なら公開中の版（無ければ空の approved 版） */
export async function editableVersion(schoolId: string, cal: Calendar): Promise<string> {
  const sb = must();
  if (cal.publishMode === 'manual') {
    const w = cal.versions.find((v) => v.status === 'working');
    if (w) return w.id;
    const { data, error } = await sb.from('source_versions').insert({ school_id: schoolId, layer_id: cal.id, label: '編集中', source: 'manual', status: 'working' }).select('id').single();
    if (error) fail('編集用の版を作れませんでした', error);
    if (cal.published.length) {
      const { error: ce } = await sb.from('events').insert(cal.published.map((e) => toRow(schoolId, { ...e, id: undefined }, data.id as string)));
      if (ce) fail('公開中の内容を写せませんでした', ce);
    }
    return data.id as string;
  }
  const a = cal.versions.find((v) => v.status === 'approved');
  if (a) return a.id;
  const { data, error } = await sb
    .from('source_versions')
    .insert({ school_id: schoolId, layer_id: cal.id, label: '手入力', source: 'manual', status: 'approved', approved_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error) fail('版を作れませんでした', error);
  return data.id as string;
}
export async function saveEvent(schoolId: string, cal: Calendar, e: UiEvent): Promise<UiEvent> {
  const sb = must();
  const versionId = e.versionId ?? (await editableVersion(schoolId, cal));
  if (e.id) {
    const { error } = await sb.from('events').update(toRow(schoolId, e, versionId)).eq('id', e.id);
    if (error) fail('保存できませんでした（編集権限を確認してください）', error);
    return e;
  }
  const { data, error } = await sb.from('events').insert(toRow(schoolId, e, versionId)).select('id').single();
  if (error) fail('保存できませんでした（編集権限を確認してください）', error);
  return { ...e, id: data.id as string, versionId };
}
export async function deleteEvent(id: string): Promise<void> {
  const { error } = await must().from('events').delete().eq('id', id);
  if (error) fail('削除できませんでした', error);
}

// ---------- 公開・承認 ----------
export async function publishCalendar(schoolId: string, cal: Calendar): Promise<void> {
  await editableVersion(schoolId, cal);
  const { error } = await must().rpc('publish_layer', { p_school: schoolId, p_layer: cal.id });
  if (error) fail('公開できませんでした', error);
}
/** 確認待ちの取り込みを反映する。含まれる月だけ入れ替え、他の月の公開内容は残る（RPC approve_version） */
export async function approveVersion(versionId: string): Promise<void> {
  const { error } = await must().rpc('approve_version', { p_version: versionId });
  if (error) fail('反映できませんでした', error);
}
/** 公開の予約（null で取り消し）。手動公開のカレンダー向け */
export async function schedulePublish(schoolId: string, cal: Calendar, at: string | null): Promise<void> {
  if (at) await editableVersion(schoolId, cal);
  const { error } = await must().rpc('schedule_publish', { p_school: schoolId, p_layer: cal.id, p_at: at });
  if (error) fail('予約できませんでした', error);
}
/** 前の公開版に戻す（その内容を新しい公開版として写す） */
export async function rollbackToVersion(versionId: string): Promise<void> {
  const { error } = await must().rpc('rollback_to_version', { p_version: versionId });
  if (error) fail('戻せませんでした', error);
}
export async function setVersionStatus(versionId: string, status: 'approved' | 'rejected'): Promise<void> {
  const sb = must();
  const uid = (await sb.auth.getUser()).data.user?.id ?? null;
  const { error } = await sb.from('source_versions').update({ status, approved_at: new Date().toISOString(), approved_by: uid }).eq('id', versionId);
  if (error) fail('更新できませんでした', error);
}

// ---------- 共有リンク ----------
export interface ShareScope {
  layers?: string[];
  slots?: Record<string, string[]>;
  from?: string;
  to?: string;
}
export interface ShareLink {
  token: string;
  label: string | null;
  scope: ShareScope | null;
  created_at: string;
  revoked_at: string | null;
}
export async function listShareLinks(schoolId: string): Promise<ShareLink[]> {
  const { data, error } = await must().from('share_links').select('*').eq('school_id', schoolId).order('created_at', { ascending: false });
  if (error) fail('共有リンクを読めませんでした', error);
  return (data ?? []) as ShareLink[];
}
export async function createShareLink(schoolId: string, label: string, scope: ShareScope | null): Promise<ShareLink> {
  const sb = must();
  const uid = (await sb.auth.getUser()).data.user?.id ?? null;
  const { data, error } = await sb.from('share_links').insert({ school_id: schoolId, label, scope, created_by: uid }).select('*').single();
  if (error) fail('リンクを作れませんでした', error);
  return data as ShareLink;
}
export async function revokeShareLink(token: string): Promise<void> {
  const { error } = await must().from('share_links').update({ revoked_at: new Date().toISOString() }).eq('token', token);
  if (error) fail('取り消せませんでした', error);
}
export function shareUrl(token: string): string {
  return `${location.origin}${location.pathname}?token=${token}`;
}
export function icsUrl(token: string, calendarId?: string, slot?: string): string {
  const base = (import.meta.env.VITE_ICS_BASE as string | undefined) ?? `${location.origin}/ics`;
  const path = calendarId ? `/${encodeURIComponent(calendarId)}${slot ? `/${encodeURIComponent(slot)}` : ''}` : '';
  return `${base}/${token}${path}.ics`;
}

/** 閲覧トークンで読む（ログイン不要） */
export async function loadByToken(token: string): Promise<Workspace> {
  const { data, error } = await must().rpc('schedule_by_token', { p_token: token });
  if (error) fail('読み込めませんでした', error);
  type Row = { school_id: string; school_name: string; layer_id: string; layer_name: string; layer_type: LayerType; layer_color: string | null; layer_slots: string[]; uid: string; category: string; slots: string[]; date: string; end_date: string | null; kind: UiEvent['kind']; time_start: string | null; time_end: string | null; place: string | null; title: string; note: string | null; version_label: string };
  const rows = (data ?? []) as Row[];
  if (!rows.length) throw new Error('このリンクは無効か、取り消されたか、まだ公開された予定がありません');
  const cals = new Map<string, Calendar>();
  for (const r of rows) {
    const c =
      cals.get(r.layer_id) ??
      cals.set(r.layer_id, { id: r.layer_id, name: r.layer_name, color: r.layer_color ?? '#888', type: r.layer_type, slots: r.layer_slots?.length ? r.layer_slots : ['全体'], publishMode: 'auto', source: null, versions: [], events: [], published: [] }).get(r.layer_id)!;
    const e: UiEvent = { uid: r.uid, calendarId: r.layer_id, slots: r.slots?.length ? r.slots : [r.category], date: r.date, endDate: r.end_date ?? undefined, kind: r.kind, timeStart: hhmm(r.time_start), timeEnd: hhmm(r.time_end), place: r.place ?? undefined, title: r.title, note: r.note ?? undefined, draft: false };
    c.events.push(e);
    c.published.push(e);
  }
  // 閲覧リンクでは、範囲に入っていない班の空の列は出さない
  for (const c of cals.values()) {
    const used = c.slots.filter((s) => c.events.some((e) => e.slots.includes(s)));
    if (used.length) c.slots = used;
  }
  return { id: rows[0].school_id, name: rows[0].school_name, settings: DEFAULT_SCHOOL_SETTINGS, calendars: [...cals.values()], role: 'viewer', grants: {} };
}

// ---------- メンバー ----------
export interface Member {
  user_id?: string;
  email: string;
  role: Workspace['role'];
  grants?: Record<string, string[] | null>;
  pending?: boolean;
}
export async function listMembers(schoolId: string): Promise<Member[]> {
  const sb = must();
  const [{ data: ms }, { data: inv }, { data: gs }, { data: emails }] = await Promise.all([
    sb.from('memberships').select('user_id, role').eq('school_id', schoolId),
    sb.from('invites').select('email, role, grants, accepted_at').eq('school_id', schoolId).order('created_at', { ascending: false }),
    sb.from('layer_grants').select('user_id, layer_id, categories').eq('school_id', schoolId),
    sb.rpc('member_emails', { p_school: schoolId }),
  ]);
  const emailOf = new Map(((emails ?? []) as { user_id: string; email: string }[]).map((r) => [r.user_id, r.email]));
  const grantsByUser = new Map<string, Record<string, string[] | null>>();
  for (const g of (gs ?? []) as { user_id: string; layer_id: string; categories: string[] | null }[]) (grantsByUser.get(g.user_id) ?? grantsByUser.set(g.user_id, {}).get(g.user_id)!)[g.layer_id] = g.categories;
  const invitesByEmail = (inv ?? []) as { email: string; role: Member['role']; grants: Record<string, string[] | null> | null; accepted_at: string | null }[];
  const out: Member[] = ((ms ?? []) as { user_id: string; role: Member['role'] }[]).map((m) => ({
    user_id: m.user_id,
    email: emailOf.get(m.user_id) ?? '（メール非表示）',
    role: m.role,
    grants: grantsByUser.get(m.user_id),
  }));
  for (const i of invitesByEmail) if (!i.accepted_at) out.push({ email: i.email, role: i.role, grants: i.grants ?? undefined, pending: true });
  return out;
}
export async function inviteMember(schoolId: string, email: string, role: Member['role'], grants: Record<string, string[] | null> | null): Promise<'member' | 'invited'> {
  const { data, error } = await must().rpc('invite_member', { p_school: schoolId, p_email: email, p_role: role, p_grants: grants });
  if (error) fail('招待できませんでした', error);
  return data as 'member' | 'invited';
}

// ---------- データの自己管理（docs/data-handling.md） ----------
/** 予定表を丸ごと消す（管理者）。カレンダー・予定・版・メンバー・閲覧リンクも全部 */
export async function deleteWorkspace(schoolId: string): Promise<void> {
  const { error } = await must().rpc('delete_workspace', { p_school: schoolId });
  if (error) fail('予定表を削除できませんでした', error);
}
/** 自分だけ予定表から抜ける */
export async function leaveWorkspace(schoolId: string): Promise<void> {
  const { error } = await must().rpc('leave_workspace', { p_school: schoolId });
  if (error) fail('抜けられませんでした', error);
}

// ---------- 取り込み（API キーなしの経路）: 読み取り済みの予定を「確認待ち」の版として保存 ----------
import type { ScheduleEvent } from '@bukatsu/core/browser';
export async function createPendingVersion(schoolId: string, cal: Calendar, label: string, events: ScheduleEvent[], source: string): Promise<{ versionId: string; count: number; unknownSlots: string[] }> {
  const sb = must();
  const { data, error } = await sb.from('source_versions').insert({ school_id: schoolId, layer_id: cal.id, label, source, ai_model: 'user-chosen', ai_mode: 'manual', status: 'pending', event_count: events.length }).select('id').single();
  if (error) fail('版を作れませんでした', error);
  const versionId = data.id as string;
  const rows = events.map((e) => ({ version_id: versionId, school_id: schoolId, layer_id: cal.id, uid: e.uid, category: e.category, slots: e.slots?.length ? e.slots : [e.category], date: e.date, end_date: e.endDate ?? null, kind: e.kind, time_start: e.timeStart ?? null, time_end: e.timeEnd ?? null, place: e.place ?? null, title: e.title, note: e.note ?? null, source_ref: e.sourceRef ?? null, confidence: e.confidence ?? null, draft: false }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: ie } = await sb.from('events').insert(rows.slice(i, i + 500));
    if (ie) {
      await sb.from('source_versions').delete().eq('id', versionId);
      fail('予定を保存できませんでした', ie);
    }
  }
  const unknownSlots = [...new Set(events.map((e) => e.category))].filter((c) => !cal.slots.includes(c));
  return { versionId, count: events.length, unknownSlots };
}

// ---------- Google シート / CSV ----------
/** サーバー経由で CSV を取ってくる（calendarId 無し = 作成前の確認。管理者だけ） */
export async function fetchSheetCsv(schoolId: string, calendarId: string | undefined, url: string): Promise<string> {
  const session = (await must().auth.getSession()).data.session;
  if (!session) throw new Error('ログインが切れています');
  const res = await fetch('/api/sheet', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ schoolId, calendarId, url }) });
  const body = (await res.json().catch(() => ({}))) as { error?: string; csv?: string };
  if (!res.ok || body.error || body.csv == null) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.csv;
}
