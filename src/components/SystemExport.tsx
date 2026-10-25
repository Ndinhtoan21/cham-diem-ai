import { useEffect, useMemo, useState } from 'react';
import type { ClassBook, Phase, ScoreCol, Term } from '../types';
import { PHASE_COLS, TERM_LABEL } from '../types';
import { listClasses } from '../lib/store';
import { openBook, type Book } from '../lib/xlsxBook';
import { detectLayout, guessClass, readRows, withTerm, type Layout } from '../lib/sheetMap';
import { buildAndVerify, planFill, type FillPlan, type Verify } from '../lib/fillTemplate';
import { download, fmt, safeFileName } from '../lib/util';
import { MappingEditor, PhasePicker } from './Shared';

type System = 'FSP' | 'CSDL';
type Part = { layout: Layout; classId: string; include: boolean };

export default function SystemExport() {
  const [classes, setClasses] = useState<ClassBook[]>([]);
  const [term, setTerm] = useState<Term | ''>('');
  const [phase, setPhase] = useState<Phase | ''>('');
  const [system, setSystem] = useState<System>('FSP');
  const [scope, setScope] = useState<'class' | 'grade'>('class');
  const [file, setFile] = useState<File | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ blob: Blob; name: string; verify: Verify } | null>(null);

  useEffect(() => { listClasses().then(setClasses); }, []);
  const cols = phase ? PHASE_COLS[phase] : [];
  const multi = system === 'FSP' && scope === 'grade';

  async function load(f: File) {
    setErr(''); setOut(null); setBusy(true);
    try {
      const b = await openBook(f);
      const ps: Part[] = b.sheets.filter((s) => !s.hidden).map((s) => {
        let l = detectLayout(s, f.name);
        if (term) l = withTerm(l, term);
        return { layout: l, classId: guessClass(l, classes)?.id || '', include: false };
      });
      const withRows = ps.filter((p) => readRows(p.layout).length > 0);
      if (!withRows.length) throw new Error('Không tìm thấy danh sách học sinh trong file này.');
      if (multi) withRows.forEach((p) => (p.include = true));
      else withRows.sort((a, c) => readRows(c.layout).length - readRows(a.layout).length)[0].include = true;
      setFile(f); setBook(b); setParts(ps);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  useEffect(() => { if (term) setParts((ps) => ps.map((p) => ({ ...p, layout: withTerm(p.layout, term) }))); setOut(null); }, [term]);
  // đổi "một lớp / cả khối": chọn lại các trang của cùng file
  useEffect(() => { if (file) load(file); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  // đổi hệ thống: mẫu khác nên bỏ file cũ
  useEffect(() => { setFile(null); setBook(null); setParts([]); setOut(null); setErr(''); }, [system]);

  const plans: (FillPlan | null)[] = useMemo(() => parts.map((p) => {
    const cb = classes.find((c) => c.id === p.classId);
    return p.include && cb && term && phase ? planFill(p.layout, cb, term, cols) : null;
  }), [parts, classes, term, phase]);

  const included = parts.filter((p) => p.include);
  const allIssues: string[] = [];
  if (book?.format === 'xls') allIssues.push('File là định dạng Excel cũ (.xls): file xuất ra vẫn là .xls nhưng có thể mất một phần định dạng màu/viền. Nếu hệ thống chấp nhận .xlsx, nên dùng mẫu .xlsx.');
  parts.forEach((p, i) => {
    if (!p.include) return;
    if (!p.classId) allIssues.push(`Trang "${p.layout.sheet.name}": chưa chọn lớp trong sổ điểm.`);
    if (term && p.layout.term && p.layout.term !== term) allIssues.push(`Trang "${p.layout.sheet.name}" ghi ${TERM_LABEL[p.layout.term]} nhưng bạn đang nhập ${TERM_LABEL[term]}.`);
    const cb = classes.find((c) => c.id === p.classId);
    if (cb && p.layout.className && p.layout.className !== cb.name.replace(/\s+/g, '').toUpperCase()) allIssues.push(`Trang "${p.layout.sheet.name}" có vẻ là lớp ${p.layout.className} nhưng đang ghép với sổ điểm lớp ${cb.name}.`);
    plans[i]?.issues.forEach((x) => allIssues.push(`${multi ? `[${p.layout.sheet.name}] ` : ''}${x}`));
  });
  const dupClass = included.map((p) => p.classId).filter((id, i, a) => id && a.indexOf(id) !== i);
  if (dupClass.length) allIssues.push('Có hai trang cùng ghép với một lớp — kiểm tra lại.');
  const totalWrites = plans.reduce((s, p) => s + (p?.stats.toWrite || 0), 0);
  const ready = !!(term && phase && book && included.length && included.every((p) => p.classId) && totalWrites > 0);

  async function build() {
    if (!file || !term || !phase) return;
    setBusy(true); setErr('');
    try {
      const fresh = await openBook(file);
      const freshPlans = parts.map((p) => {
        if (!p.include) return null;
        const s = fresh.sheets.find((x) => x.name === p.layout.sheet.name)!;
        return planFill({ ...p.layout, sheet: s }, classes.find((c) => c.id === p.classId)!, term, cols);
      }).filter(Boolean) as FillPlan[];
      const r = await buildAndVerify(fresh, freshPlans);
      const base = file.name.replace(/\.[^.]+$/, '');
      const label = multi ? 'ca khoi' : included.map((p) => classes.find((c) => c.id === p.classId)?.name).join('-');
      setOut({ blob: r.blob, name: safeFileName(`${base} - ${system} ${label} ${term} ${phase === 'GK' ? 'giua ki' : 'cuoi ki'}.${r.ext}`), verify: r.verify });
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  const setPart = (i: number, patch: Partial<Part>) => { setOut(null); setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p))); };

  return (
    <main className="main">
      <h1>Xuất điểm theo mẫu FSP / CSDL</h1>
      <p className="muted">Tải lên file mẫu tải từ hệ thống, chọn lớp trong sổ điểm — hệ thống điền đúng các ô điểm, giữ nguyên định dạng file, rồi tự mở lại file để kiểm tra từng ô trước khi giao cho bạn.</p>
      {classes.length === 0 && <div className="banner draft">Chưa có sổ điểm lớp nào. Vào “Sổ điểm lớp” để thêm lớp và nhập điểm trước.</div>}

      <PhasePicker term={term} phase={phase} setTerm={setTerm} setPhase={setPhase} />

      {term && phase && (
        <section className="card">
          <h2>Hệ thống nhập điểm</h2>
          <div className="row">
            {(['FSP', 'CSDL'] as System[]).map((s) => <button key={s} className={`tab ${system === s ? 'on' : ''}`} onClick={() => setSystem(s)}>{s === 'FSP' ? 'FSP (của trường)' : 'CSDL (của Sở)'}</button>)}
            {system === 'FSP' && <>
              <span className="sep" />
              <label className="inline"><input type="radio" checked={scope === 'class'} onChange={() => setScope('class')} /> Một lớp</label>
              <label className="inline"><input type="radio" checked={scope === 'grade'} onChange={() => setScope('grade')} /> Cả khối (mỗi lớp một sheet trong cùng file)</label>
            </>}
          </div>
          <div className="row">
            <label className="btn primary">{book ? 'Chọn file mẫu khác' : `Tải lên file mẫu ${system}${system === 'CSDL' ? ' của lớp' : ''}`}<input hidden type="file" accept=".xlsx,.xlsm,.xls" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} /></label>
            {busy && <span className="muted">Đang xử lý…</span>}
            {err && <span className="danger-text">{err}</span>}
          </div>
          <p className="muted small">Sẽ điền {cols.join(' và ')} của {TERM_LABEL[term]}.</p>
        </section>
      )}

      {book && term && phase && (
        <>
          <section className="card">
            <h2>Những gì tôi đã nhận</h2>
            <p>File <b>{book.fileName}</b> ({book.format.toUpperCase()}) · {book.sheets.length} trang tính.</p>
            <table className="tbl">
              <thead><tr><th>{multi ? 'Điền' : 'Chọn'}</th><th className="left">Trang tính</th><th>Lớp đọc được</th><th>Số HS</th><th className="left">Cột tìm thấy</th><th className="left">Ghép với sổ điểm</th></tr></thead>
              <tbody>{parts.map((p, i) => {
                const n = readRows(p.layout).length;
                const m = p.layout.mapping;
                return (
                  <tr key={p.layout.sheet.name} className={p.include ? '' : 'muted'}>
                    <td>{multi ? <input type="checkbox" checked={p.include} disabled={!n} onChange={(e) => setPart(i, { include: e.target.checked })} /> : <input type="radio" checked={p.include} disabled={!n} onChange={() => { setOut(null); setParts((ps) => ps.map((x, j) => ({ ...x, include: j === i }))); }} />}</td>
                    <td className="left">{p.layout.sheet.name}</td>
                    <td>{p.layout.className || '?'}</td>
                    <td>{n}</td>
                    <td className="left small">{[m.name >= 0 && 'Họ tên', m.code >= 0 && 'Mã HS', m.dob >= 0 && 'Ngày sinh', ...cols.map((k) => m.cols[k] >= 0 && k)].filter(Boolean).join(', ') || '—'}
                      {cols.some((k) => m.cols[k] < 0) && n > 0 && <span className="warn-text"> · thiếu {cols.filter((k) => m.cols[k] < 0).join(', ')}</span>}</td>
                    <td className="left">
                      <select value={p.classId} disabled={!n} onChange={(e) => setPart(i, { classId: e.target.value })}>
                        <option value="">— chọn lớp —</option>
                        {classes.map((c) => <option key={c.id} value={c.id}>Lớp {c.name} ({c.students.length} HS)</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </section>

          {parts.map((p, i) => p.include && (
            <SheetCard key={p.layout.sheet.name} part={p} plan={plans[i]} cols={cols} multi={multi}
              onLayout={(l) => setPart(i, { layout: l })} />
          ))}

          <section className={`card ${allIssues.length ? 'warnbox' : 'okbox'}`}>
            <h2>{allIssues.length ? `Bất thường cần xem (${allIssues.length})` : 'Không thấy bất thường'}</h2>
            {allIssues.length > 0 && <ul>{allIssues.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            <p>Sẽ ghi <b>{totalWrites}</b> ô điểm ({cols.join(', ')}, {TERM_LABEL[term]}) vào {included.length} trang tính.</p>
            <div className="row">
              <button className="btn primary big" disabled={!ready || busy} onClick={build}>{busy ? 'Đang tạo…' : 'Tạo file & tự kiểm tra'}</button>
              {!ready && <span className="muted small">Cần chọn lớp cho mỗi trang và có ít nhất một điểm để ghi.</span>}
            </div>
          </section>

          {out && (
            <section className={`card ${out.verify.bad.length ? 'warnbox' : 'okbox'}`}>
              <h2>Kết quả tự kiểm tra file xuất</h2>
              <p>Đã mở lại file vừa tạo và đối chiếu từng ô: <b>{out.verify.ok}/{out.verify.checked}</b> ô khớp với sổ điểm{out.verify.bad.length ? `, ${out.verify.bad.length} ô sai` : ' — không có ô nào sai'}.</p>
              {out.verify.bad.length > 0 && <ul className="small">{out.verify.bad.slice(0, 30).map((x, i) => <li key={i}>{x}</li>)}</ul>}
              <button className="btn primary" onClick={() => download(out.blob, out.name)}>Tải file {out.name}</button>
              <p className="muted small">Nên mở file kiểm tra lần cuối trước khi tải lên hệ thống {system}.</p>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function SheetCard({ part, plan, cols, multi, onLayout }: { part: Part; plan: FillPlan | null; cols: ScoreCol[]; multi: boolean; onLayout: (l: Layout) => void }) {
  const [open, setOpen] = useState(!multi);
  return (
    <section className="card">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Trang “{part.layout.sheet.name}”{plan ? ` → lớp ${plan.book.name}` : ''}</h2>
        <div className="row">
          {plan && <span className="small">{plan.items.length} HS ghép được · {plan.stats.toWrite} ô sẽ ghi{plan.stats.overwrite ? ` · ${plan.stats.overwrite} ô ghi đè` : ''}</span>}
          <button className="btn" onClick={() => setOpen(!open)}>{open ? 'Thu gọn' : 'Xem chi tiết'}</button>
        </div>
      </div>
      {open && (
        <>
          <h3>Cách đọc các cột (sửa nếu sai)</h3>
          <MappingEditor layout={part.layout} cols={cols} onChange={onLayout} />
          {plan && (
            <div className="tbl-wrap" style={{ maxHeight: 420 }}>
              <table className="tbl">
                <thead><tr><th>Dòng</th><th className="left">Trong file</th><th className="left">Trong sổ điểm</th><th>Ghép theo</th>{plan.cols.map((k) => <th key={k}>{k}<div className="muted small">hiện có → mới</div></th>)}</tr></thead>
                <tbody>
                  {plan.items.map((it) => (
                    <tr key={it.row.r}>
                      <td>{it.row.r + 1}</td><td className="left">{it.row.name}{it.row.code ? <span className="muted small"> · {it.row.code}</span> : ''}</td><td className="left">{it.student.name}</td>
                      <td className={`small ${it.by !== 'mã' ? 'warn-text' : 'muted'}`}>{it.by}</td>
                      {plan.cols.map((k) => {
                        const w = it.writes.find((x) => x.col === k);
                        if (!w) return <td key={k} className="muted">—</td>;
                        const over = w.current != null && w.value != null && Math.abs(w.current - w.value) > 0.001;
                        return <td key={k} className={w.skip ? 'muted small' : over ? 'edited' : ''}>{w.skip ? w.skip : <>{w.current != null ? <s className="ai-old">{fmt(w.current)}</s> : null}{fmt(w.value)}</>}</td>;
                      })}
                    </tr>
                  ))}
                  {plan.unmatchedRows.map((r) => <tr key={'u' + r.r} className="row-bad"><td>{r.r + 1}</td><td className="left">{r.name}</td><td className="left small" colSpan={2 + plan.cols.length}>Không có trong sổ điểm — giữ nguyên dòng này</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
