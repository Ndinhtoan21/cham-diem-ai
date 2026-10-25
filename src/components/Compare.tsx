import { useMemo, useState } from 'react';
import type { ScoreCol, Term } from '../types';
import { COLS, TERM_LABEL, TERMS } from '../types';
import { openBook } from '../lib/xlsxBook';
import { detectLayout, readRows, withTerm } from '../lib/sheetMap';
import { compareReportXlsx, compareTables, pct, type ClassResult, type Table } from '../lib/compare';
import { download, normKey, uid } from '../lib/util';
import { MappingEditor } from './Shared';

export default function Compare() {
  const [tables, setTables] = useState<Table[]>([]);
  const [pairs, setPairs] = useState<Record<string, string>>({}); // fspId -> csdlId
  const [term, setTerm] = useState<Term>('HK1');
  const [cols, setCols] = useState<ScoreCol[]>(['TX1', 'GK']);
  const [results, setResults] = useState<ClassResult[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);

  const fsp = tables.filter((t) => t.system === 'FSP');
  const csdl = tables.filter((t) => t.system === 'CSDL');

  async function addFiles(list: FileList | null, system: 'FSP' | 'CSDL') {
    if (!list) return;
    setBusy(true); setErr(''); setResults(null);
    const add: Table[] = [];
    const errs: string[] = [];
    for (const f of Array.from(list)) {
      try {
        const b = await openBook(f);
        for (const s of b.sheets) {
          if (s.hidden) continue;
          const l = withTerm(detectLayout(s, f.name), term);
          if (!readRows(l).length) continue;
          add.push({ id: uid(), system, fileName: f.name, layout: l, className: l.className });
        }
      } catch (e: any) { errs.push(`${f.name}: ${e.message}`); }
    }
    if (errs.length) setErr(errs.join(' · '));
    setTables((t) => {
      const all = [...t, ...add];
      autoPair(all);
      return all;
    });
    setBusy(false);
  }

  function autoPair(all: Table[]) {
    const f = all.filter((t) => t.system === 'FSP');
    const c = all.filter((t) => t.system === 'CSDL');
    const p: Record<string, string> = {};
    const used = new Set<string>();
    for (const a of f) {
      let hit = a.className ? c.find((b) => !used.has(b.id) && b.className === a.className) : undefined;
      if (!hit) {
        // theo số tên trùng
        const names = new Set(readRows(a.layout).map((r) => normKey(r.name)));
        let best = 0;
        for (const b of c) {
          if (used.has(b.id)) continue;
          const n = readRows(b.layout).filter((r) => names.has(normKey(r.name))).length;
          if (n > best && n >= names.size * 0.5) { best = n; hit = b; }
        }
      }
      if (hit) { p[a.id] = hit.id; used.add(hit.id); }
    }
    setPairs(p);
  }

  const changeTerm = (t: Term) => { setTerm(t); setResults(null); setTables((ts) => ts.map((x) => ({ ...x, layout: withTerm(x.layout, t) }))); };
  const setTable = (id: string, patch: Partial<Table>) => { setResults(null); setTables((ts) => ts.map((x) => (x.id === id ? { ...x, ...patch } : x))); };

  const issues: string[] = [];
  fsp.forEach((a) => { if (!pairs[a.id]) issues.push(`FSP "${a.fileName} › ${a.layout.sheet.name}" chưa ghép được với file CSDL nào.`); });
  csdl.forEach((b) => { if (!Object.values(pairs).includes(b.id)) issues.push(`CSDL "${b.fileName} › ${b.layout.sheet.name}" chưa ghép với lớp FSP nào.`); });
  tables.forEach((t) => cols.forEach((k) => { if (t.layout.mapping.cols[k] < 0) issues.push(`${t.system} "${t.fileName} › ${t.layout.sheet.name}" không tìm thấy cột ${k} — bấm "Sửa cột" để chọn.`); }));
  tables.forEach((t) => { if (t.layout.term && t.layout.term !== term) issues.push(`${t.system} "${t.fileName}" ghi ${TERM_LABEL[t.layout.term]}, đang đối chiếu ${TERM_LABEL[term]}.`); });

  function run() {
    const out: ClassResult[] = [];
    fsp.forEach((a) => { const b = csdl.find((x) => x.id === pairs[a.id]); if (b) out.push(compareTables(a, b, cols)); });
    out.sort((x, y) => x.className.localeCompare(y.className, 'vi', { numeric: true }));
    setResults(out);
  }

  const tot = useMemo(() => (results || []).reduce((s, r) => ({ c: s.c + r.compared, d: s.d + r.diff, ok: s.ok + r.same, hs: s.hs + r.students }), { c: 0, d: 0, ok: 0, hs: 0 }), [results]);
  const editing = tables.find((t) => t.id === edit);

  return (
    <main className="main">
      <h1>Đối chiếu điểm FSP ↔ CSDL</h1>
      <p className="muted">Bước cuối trước khi vào điểm trên hệ thống thật: tải lên file nhập điểm của cả hai hệ thống (của bạn hoặc của giáo viên khác). Hệ thống ghép từng lớp, từng học sinh và báo số điểm đúng/sai, tỉ lệ sai.</p>

      <section className="card">
        <h2>1. Học kì và cột điểm cần đối chiếu</h2>
        <div className="row">
          {TERMS.map((t) => <button key={t} className={`tab ${term === t ? 'on' : ''}`} onClick={() => changeTerm(t)}>{TERM_LABEL[t]}</button>)}
          <span className="sep" />
          <button className={`tab ${cols.join() === 'TX1,GK' ? 'on' : ''}`} onClick={() => { setCols(['TX1', 'GK']); setResults(null); }}>Giữa kì (TX1 + GK)</button>
          <button className={`tab ${cols.join() === 'TX2,CK' ? 'on' : ''}`} onClick={() => { setCols(['TX2', 'CK']); setResults(null); }}>Cuối kì (TX2 + CK)</button>
          <span className="sep" />
          {COLS.map((k) => <label key={k} className="inline small"><input type="checkbox" checked={cols.includes(k)} onChange={(e) => { setResults(null); setCols(e.target.checked ? COLS.filter((x) => cols.includes(x) || x === k) : cols.filter((x) => x !== k)); }} />{k}</label>)}
        </div>
      </section>

      <section className="card">
        <h2>2. Tải lên file</h2>
        <div className="grid2">
          <div>
            <label className="btn primary">+ File FSP (1 file nhiều sheet, hoặc nhiều file)<input hidden type="file" multiple accept=".xlsx,.xlsm,.xls" onChange={(e) => { addFiles(e.target.files, 'FSP'); e.target.value = ''; }} /></label>
            <TableList list={fsp} cols={cols} onEdit={setEdit} onRemove={(id) => setTables((t) => t.filter((x) => x.id !== id))} />
          </div>
          <div>
            <label className="btn primary">+ File CSDL (mỗi lớp một file, chọn được nhiều file)<input hidden type="file" multiple accept=".xlsx,.xlsm,.xls" onChange={(e) => { addFiles(e.target.files, 'CSDL'); e.target.value = ''; }} /></label>
            <TableList list={csdl} cols={cols} onEdit={setEdit} onRemove={(id) => setTables((t) => t.filter((x) => x.id !== id))} />
          </div>
        </div>
        {busy && <p className="muted">Đang đọc file…</p>}
        {err && <p className="danger-text small">{err}</p>}
      </section>

      {editing && (
        <section className="card">
          <div className="row between"><h2>Sửa cột — {editing.system} “{editing.fileName} › {editing.layout.sheet.name}”</h2><button className="btn" onClick={() => setEdit(null)}>Xong</button></div>
          <label className="inline">Lớp <input style={{ width: 100 }} value={editing.className} onChange={(e) => setTable(editing.id, { className: e.target.value.toUpperCase() })} /></label>
          <MappingEditor layout={editing.layout} cols={cols} onChange={(l) => setTable(editing.id, { layout: l })} />
        </section>
      )}

      {fsp.length > 0 && csdl.length > 0 && (
        <section className="card">
          <h2>3. Ghép lớp FSP ↔ CSDL</h2>
          <table className="tbl">
            <thead><tr><th>Lớp</th><th className="left">FSP</th><th className="left">CSDL</th></tr></thead>
            <tbody>{fsp.map((a) => (
              <tr key={a.id}>
                <td>{a.className || '?'}</td>
                <td className="left small">{a.fileName} › {a.layout.sheet.name} ({readRows(a.layout).length} HS)</td>
                <td className="left">
                  <select value={pairs[a.id] || ''} onChange={(e) => { setResults(null); setPairs({ ...pairs, [a.id]: e.target.value }); }}>
                    <option value="">— không đối chiếu —</option>
                    {csdl.map((b) => <option key={b.id} value={b.id}>{b.className || '?'} · {b.fileName} › {b.layout.sheet.name} ({readRows(b.layout).length} HS)</option>)}
                  </select>
                </td>
              </tr>
            ))}</tbody>
          </table>
          {issues.length > 0 && <ul className="note warn small">{issues.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          <div className="row"><button className="btn primary big" disabled={!Object.values(pairs).some(Boolean) || !cols.length} onClick={run}>Đối chiếu</button></div>
        </section>
      )}

      {results && (
        <>
          <section className={`card ${tot.d ? 'warnbox' : 'okbox'}`}>
            <div className="row between">
              <h2 style={{ margin: 0 }}>Kết quả: {tot.d ? `${tot.d} điểm sai lệch` : 'không có điểm sai lệch'}</h2>
              <button className="btn" onClick={async () => download(await compareReportXlsx(results, cols, `BÁO CÁO ĐỐI CHIẾU ĐIỂM FSP – CSDL · ${TERM_LABEL[term]}`), `Doi chieu FSP-CSDL ${term} ${cols.join('-')}.xlsx`)}>Tải báo cáo Excel</button>
            </div>
            <div className="kpis">
              <div><b>{results.length}</b><span>lớp</span></div>
              <div><b>{tot.hs}</b><span>học sinh ghép được</span></div>
              <div><b>{tot.c}</b><span>điểm đã so sánh</span></div>
              <div className="ok"><b>{tot.ok}</b><span>đúng</span></div>
              <div className={tot.d ? 'bad' : ''}><b>{tot.d}</b><span>sai</span></div>
              <div className={tot.d ? 'bad' : ''}><b>{pct(tot.d, tot.c)}</b><span>tỉ lệ sai</span></div>
            </div>
            <table className="tbl">
              <thead><tr><th>Lớp</th><th>Số HS</th>{cols.map((k) => <th key={k}>{k}<div className="muted small">sai/so</div></th>)}<th>Đúng</th><th>Sai</th><th>Tỉ lệ sai</th><th className="left">HS chỉ có một bên</th></tr></thead>
              <tbody>{results.map((r) => (
                <tr key={r.fspFile} className={r.diff ? 'row-bad' : ''}>
                  <td><b>{r.className || '?'}</b></td><td>{r.students}</td>
                  {cols.map((k) => <td key={k}>{r.byCol[k] ? `${r.byCol[k].diff}/${r.byCol[k].compared}` : <span className="warn-text small">không có cột</span>}</td>)}
                  <td>{r.same}</td><td>{r.diff}</td><td>{pct(r.diff, r.compared)}</td>
                  <td className="left small">{r.onlyFsp.length ? `FSP: ${r.onlyFsp.join(', ')}. ` : ''}{r.onlyCsdl.length ? `CSDL: ${r.onlyCsdl.join(', ')}.` : ''}</td>
                </tr>
              ))}</tbody>
            </table>
          </section>
          {tot.d > 0 && (
            <section className="card">
              <h2>Chi tiết sai lệch</h2>
              <div className="tbl-wrap" style={{ maxHeight: 520 }}>
                <table className="tbl">
                  <thead><tr><th>Lớp</th><th className="left">Họ và tên</th><th>Mã HS</th><th>Cột</th><th>FSP</th><th>CSDL</th><th className="left">Loại</th></tr></thead>
                  <tbody>{results.flatMap((r) => r.diffs).map((d, i) => (
                    <tr key={i}><td>{d.className}</td><td className="left">{d.name}</td><td className="small muted">{d.code}</td><td>{d.col}</td><td className="danger-text">{d.fsp}</td><td className="danger-text">{d.csdl}</td><td className="left small">{d.kind}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function TableList({ list, cols, onEdit, onRemove }: { list: Table[]; cols: ScoreCol[]; onEdit: (id: string) => void; onRemove: (id: string) => void }) {
  if (!list.length) return <p className="muted small">Chưa có file.</p>;
  return (
    <ul className="list small">
      {list.map((t) => {
        const miss = cols.filter((k) => t.layout.mapping.cols[k] < 0);
        return (
          <li key={t.id}>
            <b>{t.className || '?'}</b> · {t.fileName} › {t.layout.sheet.name} · {readRows(t.layout).length} HS
            {miss.length > 0 && <span className="warn-text"> · thiếu cột {miss.join(', ')}</span>}
            {' '}<button className="link" onClick={() => onEdit(t.id)}>Sửa cột</button>{' '}
            <button className="link danger" onClick={() => onRemove(t.id)}>Bỏ</button>
          </li>
        );
      })}
    </ul>
  );
}
