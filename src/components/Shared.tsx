import type { Phase, ScoreCol, Term } from '../types';
import { COLS, PHASE_LABEL, TERM_LABEL, TERMS } from '../types';
import { colLabel, readRows, type Layout } from '../lib/sheetMap';

export function PhasePicker({ term, phase, setTerm, setPhase, title = 'Nhập điểm cho giai đoạn nào?' }: { term: Term | ''; phase: Phase | ''; setTerm: (t: Term) => void; setPhase: (p: Phase) => void; title?: string }) {
  return (
    <section className={`card ${!term || !phase ? 'askbox' : ''}`}>
      <h2>{title}</h2>
      <div className="row">
        {TERMS.map((t) => <button key={t} className={`tab ${term === t ? 'on' : ''}`} onClick={() => setTerm(t)}>{TERM_LABEL[t]}</button>)}
        <span className="sep" />
        {(['GK', 'CK'] as Phase[]).map((p) => <button key={p} className={`tab ${phase === p ? 'on' : ''}`} onClick={() => setPhase(p)}>{PHASE_LABEL[p]}</button>)}
      </div>
      {(!term || !phase) && <p className="muted small">Chọn học kì và giai đoạn trước. Giữa kì sẽ nhập 2 cột TX1 + GK; cuối kì nhập TX2 + CK.</p>}
    </section>
  );
}

const FIELDS: { key: 'name' | 'given' | 'code' | 'dob'; label: string }[] = [
  { key: 'name', label: 'Họ và tên (hoặc Họ đệm)' },
  { key: 'given', label: 'Tên (nếu tách cột)' },
  { key: 'code', label: 'Mã học sinh' },
  { key: 'dob', label: 'Ngày sinh' },
];

/** Cho giáo viên xem / sửa cách hệ thống hiểu các cột của một trang tính. */
export function MappingEditor({ layout, cols, onChange }: { layout: Layout; cols: ScoreCol[]; onChange: (l: Layout) => void }) {
  const m = layout.mapping;
  const width = layout.sheet.colCount;
  const opts = [-1, ...Array.from({ length: width }, (_, i) => i)];
  const set = (patch: Partial<typeof m>) => onChange({ ...layout, mapping: { ...m, ...patch } });
  const setCol = (k: ScoreCol, c: number) => onChange({ ...layout, mapping: { ...m, cols: { ...m.cols, [k]: c } } });
  const rows = readRows(layout);
  return (
    <div className="mapping">
      <div className="map-grid">
        {FIELDS.map((f) => (
          <label key={f.key}>{f.label}
            <select value={m[f.key]} onChange={(e) => set({ [f.key]: Number(e.target.value) } as any)}>
              {opts.map((c) => <option key={c} value={c}>{colLabel(layout, c)}</option>)}
            </select>
          </label>
        ))}
        {COLS.filter((k) => cols.includes(k)).map((k) => (
          <label key={k} className={m.cols[k] < 0 ? 'need' : ''}>Cột điểm {k}
            <select value={m.cols[k]} onChange={(e) => setCol(k, Number(e.target.value))}>
              {opts.map((c) => <option key={c} value={c}>{colLabel(layout, c)}</option>)}
            </select>
          </label>
        ))}
        <label>Dòng HS đầu tiên
          <input type="number" min={1} value={m.firstDataRow + 1} onChange={(e) => set({ firstDataRow: Math.max(0, Number(e.target.value) - 1) })} />
        </label>
        <label>Dòng HS cuối cùng
          <input type="number" min={1} value={m.lastDataRow + 1} onChange={(e) => set({ lastDataRow: Math.max(0, Number(e.target.value) - 1) })} />
        </label>
      </div>
      <p className="muted small">Đọc được {rows.length} học sinh (dòng {m.firstDataRow + 1}–{m.lastDataRow + 1}){rows[0] ? `: ${rows[0].name}${rows.length > 1 ? ` … ${rows[rows.length - 1].name}` : ''}` : ''}.{layout.term ? ` Trang ghi ${layout.term === 'HK1' ? 'Học kì I' : 'Học kì II'}.` : ''}</p>
      {layout.notes.length > 0 && <ul className="note warn small">{layout.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
    </div>
  );
}
