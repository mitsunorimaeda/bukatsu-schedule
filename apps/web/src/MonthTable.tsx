import { KIND_LABEL } from '@bukatsu/core/browser';
import { WEEKDAYS, daysOf, dayIndex, fmtTime, md, rowCells, spanDays, spanPart, weekday, type Calendar, type Change, type UiEvent } from './model';

export interface ColumnCal {
  cal: Calendar;
  slots: string[];
  events: UiEvent[];
  /** 差分を色で出す（uid → 変更） */
  changes?: Map<string, Change>;
  editable: boolean;
}

export function EventLine({ e, d, change }: { e: UiEvent; d: string; change?: Change }) {
  const part = spanPart(e, d);
  const cls = ['ev', `k-${e.kind}`, `sp-${part}`];
  if (change) cls.push(change.type);
  if (e.draft) cls.push('draft');
  let time = '';
  if (part === 'single' && e.timeStart) time = fmtTime(e);
  if (part === 'start' && e.timeStart) time = `${e.timeStart}〜`;
  if (part === 'end' && e.timeEnd) time = `〜${e.timeEnd}`;
  return (
    <div className={cls.join(' ')} title={[e.note, e.sourceRef].filter(Boolean).join('\n')}>
      {change?.type === 'changed' && change.before && (
        <span className="before">
          {fmtTime(change.before)} {change.before.title}
        </span>
      )}
      {time && <span className="t">{time}</span>}
      {e.title || KIND_LABEL[e.kind]}
      {part === 'start' && <span className="span"> ▸ {md(e.endDate!)}まで（{spanDays(e)}日間）</span>}
      {part === 'mid' && <span className="span"> {dayIndex(e, d)}日目</span>}
      {part === 'end' && <span className="span"> 最終日</span>}
      {e.place && part !== 'mid' && <span className="p">＠{e.place}</span>}
      {change && <span className="badge">{{ added: '追加', changed: '変更', removed: '取消' }[change.type]}</span>}
      {e.draft && <span className="badge draftb">下書き</span>}
    </div>
  );
}

export function MonthTable({
  month,
  columns,
  holidays,
  editing,
  onCell,
  onAddSlot,
}: {
  month: string;
  columns: ColumnCal[];
  holidays: Set<string>;
  editing?: { calId: string; slot: string; date: string } | null;
  onCell: (cal: Calendar, slot: string, date: string, el: HTMLElement, events: UiEvent[], siblings: UiEvent[]) => void;
  onAddSlot?: (cal: Calendar) => void;
}) {
  const days = daysOf(month);
  const flat = columns.flatMap((c) => c.slots.map((s) => ({ c, s })));
  return (
    <div className="tablewrap">
      <table className="month">
        <thead>
          <tr className="cals">
            <th className="fx" rowSpan={2}>
              日
            </th>
            <th className="fx w" rowSpan={2}>
              曜
            </th>
            {columns.map((c) => (
              <th key={c.cal.id} colSpan={c.slots.length} style={{ borderTop: `3px solid ${c.cal.color}` }}>
                {c.cal.name}
                {onAddSlot && c.editable && (
                  <button className="ghost" style={{ padding: '0 5px', color: 'var(--muted)', fontWeight: 400 }} title="班を増やす・名前を変える" onClick={() => onAddSlot(c.cal)}>
                    ＋班
                  </button>
                )}
              </th>
            ))}
          </tr>
          <tr className="slots">
            {flat.map(({ c, s }) => (
              <th key={`${c.cal.id}|${s}`}>{c.cal.slots.length === 1 ? '' : s}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const wd = weekday(d);
            const cls = wd === 0 || holidays.has(d) ? 'sun' : wd === 6 ? 'sat' : '';
            return (
              <tr key={d} className={cls}>
                <td className="d">{Number(d.slice(8))}</td>
                <td className="w">{WEEKDAYS[wd]}</td>
                {columns.map((c) =>
                  rowCells(d, c.slots, c.events).map((cell) => {
                    const isEditing = editing && editing.calId === c.cal.id && editing.slot === cell.slot && editing.date === d;
                    const removed = [...(c.changes?.values() ?? [])].filter((x) => x.type === 'removed' && x.before && x.before.date <= d && (x.before.endDate ?? x.before.date) >= d && x.before.slots.includes(cell.slot));
                    return (
                      <td
                        key={`${c.cal.id}|${cell.slot}|${d}`}
                        className={`cell${isEditing ? ' editing' : ''}${cell.shared ? ' shared' : ''}${c.editable ? '' : ' ro'}`}
                        colSpan={cell.span > 1 ? cell.span : undefined}
                        onClick={(ev) => onCell(c.cal, cell.slot, d, ev.currentTarget, cell.events, cell.siblings ?? [])}
                      >
                        {cell.events.map((e) => (
                          <EventLine key={e.uid} e={e} d={d} change={c.changes?.get(e.uid)} />
                        ))}
                        {cell.shared && cell.events[0] && cell.span < new Set([...cell.events[0].slots, ...(cell.siblings ?? []).flatMap((x) => x.slots)]).size && <div className="span">他の班にも同じ予定</div>}
                        {removed.map((x) => (
                          <EventLine key={`rm-${x.before!.uid}`} e={x.before!} d={d} change={x} />
                        ))}
                      </td>
                    );
                  }),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
