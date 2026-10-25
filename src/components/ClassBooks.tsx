import { useEffect, useMemo, useState } from 'react';
import type { ClassBook, ScoreCol, Term } from '../types';
import { COLS, TERM_LABEL, TERMS } from '../types';
import { deleteClass, listClasses, saveClass } from '../lib/store';
import { newClassBook, parsePastedScores, type PasteLine } from '../lib/gradebook';
import { parsePasted, parseRosterFile } from '../lib/roster';
import { matchPeople, parseScore } from '../lib/sheetMap';
import { fmt } from '../lib/util';

export default function ClassBooks() {
  const [classes, setClasses] = useState<ClassBook[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const reload = async () => setClasses(await listClasses());
  useEffect(() => { reload(); }, []);

  const open = classes?.find((c) => c.id === openId);
  if (open) return <ClassView key={open.id} book={open} onBack={() => setOpenId(null)} onSaved={reload} />;

  return (
    <main className="main">
      <div className="home-head">
        <div>
          <h1>Sổ điểm lớp</h1>
          <p className="muted">Mỗi lớp có 4 cột điểm cho mỗi học kì: TX1, TX2, GK, CK. Điểm chấm bằng AI được ghi vào đây khi bạn chốt; điểm TX bạn dán từ Excel.</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Thêm lớp</button>
      </div>
      {adding && <AddClass onDone={async (c) => { setAdding(false); if (c) { await saveClass(c); await reload(); setOpenId(c.id); } }} />}
      {classes === null ? <p className="muted">Đang tải…</p> : classes.length === 0 && !adding ? (
        <div className="empty">Chưa có lớp nào. Bấm “Thêm lớp” và nhập danh sách học sinh (từ file Excel hoặc dán).</div>
      ) : (
        <div className="cards">
          {classes.map((c) => {
            const count = (t: Term, k: ScoreCol) => c.students.filter((s) => c.scores[t][k][s.id] != null).length;
            return (
              <div key={c.id} className="card proj" onClick={() => setOpenId(c.id)}>
                <div className="proj-title">Lớp {c.name}</div>
                <div className="muted small">{c.students.length} học sinh · cập nhật {new Date(c.updatedAt).toLocaleString('vi-VN')}</div>
                <table className="mini">
                  <tbody>{TERMS.map((t) => <tr key={t}><th>{t}</th>{COLS.map((k) => <td key={k} className={count(t, k) === c.students.length && c.students.length ? 'full' : count(t, k) ? 'part' : ''}>{k} {count(t, k)}/{c.students.length}</td>)}</tr>)}</tbody>
                </table>
                <button className="link danger" onClick={async (e) => { e.stopPropagation(); if (confirm(`Xóa sổ điểm lớp ${c.name}?`)) { await deleteClass(c.id); reload(); } }}>Xóa</button>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function AddClass({ onDone }: { onDone: (c: ClassBook | null) => void }) {
  const [name, setName] = useState('');
  const [paste, setPaste] = useState('');
  const [res, setRes] = useState<{ students: ClassBook['students']; notes: string[]; from: string } | null>(null);
  const [err, setErr] = useState('');
  return (
    <section className="card">
      <h2>Thêm lớp</h2>
      <div className="grid2">
        <label>Tên lớp<input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: 6A1" /></label>
        <label>Danh sách học sinh (file Excel bảng điểm lớp / danh sách)
          <input type="file" accept=".xlsx,.xlsm,.xls,.csv" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const r = await parseRosterFile(f);
              setRes({ students: r.students, notes: r.notes, from: f.name });
              if (!name) { const m = /(\d{1,2}\s*[A-Za-z]\d{0,2})/.exec(f.name); if (m) setName(m[1].toUpperCase()); }
              setErr('');
            } catch (x: any) { setErr(x.message); }
          }} />
        </label>
      </div>
      <details>
        <summary>Hoặc copy danh sách từ Excel rồi dán (có dòng tiêu đề “Họ và tên”, nên có “Mã HS”)</summary>
        <textarea rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'STT\tMã HS\tHọ và tên\tNgày sinh\n1\t0480…\tNguyễn Văn An\t01/02/2014'} />
        <button className="btn" onClick={() => { const r = parsePasted(paste); setRes({ students: r.students, notes: r.notes, from: 'dán từ Excel' }); }}>Nhận danh sách</button>
      </details>
      {err && <p className="danger-text">{err}</p>}
      {res && (
        <div className="note">
          <b>Đã nhận {res.students.length} học sinh</b> ({res.from}){res.students.filter((s) => s.code).length ? ` · ${res.students.filter((s) => s.code).length} HS có mã` : ' · không có cột mã HS'}.
          {res.notes.length > 0 && <ul className="warn-text small">{res.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          <div className="roster-preview">{res.students.slice(0, 50).map((s) => <span key={s.id} className="chip">{s.stt}. {s.name}{s.code ? ` · ${s.code}` : ''}</span>)}</div>
        </div>
      )}
      <div className="row end">
        <button className="btn" onClick={() => onDone(null)}>Hủy</button>
        <button className="btn primary" disabled={!name.trim() || !res?.students.length} onClick={() => onDone(newClassBook(name, res!.students))}>Tạo sổ điểm lớp</button>
      </div>
    </section>
  );
}

function ClassView({ book: initial, onBack, onSaved }: { book: ClassBook; onBack: () => void; onSaved: () => void }) {
  const [book, setBook] = useState(initial);
  const [term, setTerm] = useState<Term>('HK1');
  const [showPaste, setShowPaste] = useState(false);
  const [saved, setSaved] = useState(true);

  const commit = async (b: ClassBook) => { setBook(b); setSaved(false); await saveClass(b); setSaved(true); onSaved(); };
  const setScore = (sid: string, k: ScoreCol, raw: string) => {
    const v = parseScore(raw);
    if (v != null && (Number.isNaN(v) || v < 0 || v > 10)) return;
    const b = structuredClone(book);
    b.scores[term][k][sid] = v;
    commit(b);
  };
  /** Dán cả cột từ Excel vào một ô: điền xuống các dòng bên dưới. */
  const onCellPaste = (e: React.ClipboardEvent, startIdx: number, k: ScoreCol) => {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\n') && !text.includes('\t')) return;
    e.preventDefault();
    const rows = text.replace(/\r/g, '').split('\n').filter((l, i, a) => l !== '' || i < a.length - 1);
    const b = structuredClone(book);
    const ki = COLS.indexOf(k);
    let bad = 0;
    rows.forEach((line, i) => {
      const st = book.students[startIdx + i];
      if (!st) return;
      line.split('\t').forEach((cell, j) => {
        const col = COLS[ki + j];
        if (!col) return;
        const v = parseScore(cell);
        if (v != null && (Number.isNaN(v) || v < 0 || v > 10)) { bad++; return; }
        b.scores[term][col][st.id] = v;
      });
    });
    commit(b);
    if (bad) alert(`${bad} ô không phải điểm hợp lệ (0–10) nên bị bỏ qua.`);
    if (startIdx + rows.length > book.students.length) alert(`Khối dán có ${rows.length} dòng, thừa ${startIdx + rows.length - book.students.length} dòng so với danh sách.`);
  };

  const stats = useMemo(() => COLS.map((k) => {
    const vals = book.students.map((s) => book.scores[term][k][s.id]).filter((v): v is number => v != null);
    return { k, n: vals.length, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
  }), [book, term]);

  return (
    <main className="main">
      <div className="row between">
        <div className="row">
          <button className="btn" onClick={onBack}>← Các lớp</button>
          <h1 style={{ margin: 0 }}>Sổ điểm lớp {book.name}</h1>
          <span className="muted small">{saved ? 'Đã lưu' : 'Đang lưu…'}</span>
        </div>
        <div className="row">
          {TERMS.map((t) => <button key={t} className={`tab ${term === t ? 'on' : ''}`} onClick={() => setTerm(t)}>{TERM_LABEL[t]}</button>)}
          <button className="btn primary" onClick={() => setShowPaste(true)}>Dán bảng điểm TX từ Excel</button>
        </div>
      </div>
      {showPaste && <PastePanel book={book} term={term} onClose={() => setShowPaste(false)} onApply={(b) => { commit(b); setShowPaste(false); }} />}
      <section className="card">
        <p className="muted small">Mẹo: copy cả cột điểm trong Excel, bấm vào ô của học sinh đầu tiên rồi Ctrl+V — điểm sẽ được điền xuống theo thứ tự. Có thể dán nhiều cột liền nhau (VD TX1 và TX2).</p>
        <div className="tbl-wrap">
          <table className="tbl scores book">
            <thead>
              <tr><th>STT</th><th className="left">Họ và tên</th><th>Mã HS</th>{COLS.map((k) => <th key={k}>{k}</th>)}</tr>
            </thead>
            <tbody>
              {book.students.map((s, i) => (
                <tr key={s.id}>
                  <td>{s.stt}</td><td className="left">{s.name}</td><td className="small muted">{s.code || ''}</td>
                  {COLS.map((k) => {
                    const v = book.scores[term][k][s.id];
                    return (
                      <td key={k} className="cell-in">
                        <input key={`${term}-${k}-${v}`} defaultValue={v == null ? '' : fmt(v)} inputMode="decimal"
                          onBlur={(e) => { const nv = parseScore(e.target.value); if (!(nv == null && v == null) && nv !== v) setScore(s.id, k, e.target.value); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'ArrowDown') { (e.currentTarget.closest('tr')?.nextElementSibling?.children[3 + COLS.indexOf(k)]?.querySelector('input') as HTMLInputElement | null)?.focus(); } if (e.key === 'ArrowUp') (e.currentTarget.closest('tr')?.previousElementSibling?.children[3 + COLS.indexOf(k)]?.querySelector('input') as HTMLInputElement | null)?.focus(); }}
                          onPaste={(e) => onCellPaste(e, i, k)} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td /><td className="left muted small">Đã có điểm / trung bình</td><td />{stats.map((x) => <td key={x.k} className="small muted">{x.n}/{book.students.length}{x.avg != null ? ` · ${fmt(Math.round(x.avg * 10) / 10)}` : ''}</td>)}</tr></tfoot>
          </table>
        </div>
      </section>
      <StudentsEditor book={book} onChange={commit} />
    </main>
  );
}

function PastePanel({ book, term, onClose, onApply }: { book: ClassBook; term: Term; onClose: () => void; onApply: (b: ClassBook) => void }) {
  const [col, setCol] = useState<ScoreCol>('TX1');
  const [text, setText] = useState('');
  const parsed = useMemo(() => (text.trim() ? parsePastedScores(text, book.students) : null), [text, book.students]);
  const good = parsed?.lines.filter((l) => l.studentId && !l.problem) || [];
  const bad = parsed?.lines.filter((l) => l.problem) || [];
  const overwrite = good.filter((l) => { const o = book.scores[term][col][l.studentId!]; return o != null && l.score != null && Math.abs(o - l.score) > 0.001; });
  const apply = () => {
    const b = structuredClone(book);
    good.forEach((l) => (b.scores[term][col][l.studentId!] = l.score));
    onApply(b);
  };
  return (
    <section className="card">
      <div className="row between"><h2>Dán điểm vào lớp {book.name} — {TERM_LABEL[term]}</h2><button className="btn" onClick={onClose}>Đóng</button></div>
      <div className="row">
        <span>Cột điểm:</span>
        {COLS.map((k) => <button key={k} className={`tab ${col === k ? 'on' : ''}`} onClick={() => setCol(k)}>{k}</button>)}
      </div>
      <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Copy từ Excel rồi dán vào đây. Chấp nhận:\n• Hai cột "Họ và tên | Điểm" (có thể kèm STT, Mã HS) — ghép theo tên/mã\n• Hoặc chỉ một cột điểm — điền theo đúng thứ tự danh sách lớp'} />
      {parsed && (
        <>
          <div className={`note ${bad.length || parsed.notes.length ? 'warn' : ''}`}>
            <b>Đã nhận {parsed.lines.length} dòng</b> ({parsed.mode === 'order' ? 'chỉ có điểm — điền theo thứ tự danh sách' : 'ghép theo họ tên / mã HS'}) · {good.length} điểm hợp lệ{bad.length ? ` · ${bad.length} dòng có vấn đề` : ''}{overwrite.length ? ` · ${overwrite.length} điểm sẽ thay điểm đang có` : ''}.
            {parsed.notes.length > 0 && <ul className="small">{parsed.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          </div>
          <div className="tbl-wrap" style={{ maxHeight: 320 }}>
            <table className="tbl">
              <thead><tr><th>Dòng</th><th className="left">Học sinh</th><th>Điểm dán</th><th>Điểm hiện có</th><th className="left">Ghi chú</th></tr></thead>
              <tbody>{parsed.lines.map((l: PasteLine) => {
                const st = book.students.find((s) => s.id === l.studentId);
                const old = st ? book.scores[term][col][st.id] : null;
                return (
                  <tr key={l.line} className={l.problem ? 'row-bad' : ''}>
                    <td>{l.line}</td><td className="left">{st ? `${st.stt}. ${st.name}` : l.name || '—'}</td><td>{l.score == null ? (l.raw ? l.raw : <span className="muted">trống</span>) : fmt(l.score)}</td>
                    <td className={old != null && l.score != null && Math.abs(old - l.score) > 0.001 ? 'warn-text' : 'muted'}>{old == null ? '' : fmt(old)}</td>
                    <td className="left small">{l.problem || ''}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <div className="row end"><button className="btn primary" disabled={!good.length} onClick={apply}>Ghi {good.length} điểm vào cột {col}</button></div>
        </>
      )}
    </section>
  );
}

function StudentsEditor({ book, onChange }: { book: ClassBook; onChange: (b: ClassBook) => void }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  return (
    <details className="card">
      <summary><b>Cập nhật danh sách học sinh</b> <span className="muted small">(thêm HS chuyển đến, bổ sung mã HS…)</span></summary>
      <p className="muted small">Dán danh sách mới (có “Họ và tên”, nên có “Mã HS”). Học sinh cũ được giữ nguyên điểm (ghép theo mã/tên), học sinh mới được thêm vào cuối.</p>
      <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn" onClick={() => {
        const r = parsePasted(text);
        if (!r.students.length) return setMsg('Không đọc được danh sách.');
        const m = matchPeople(r.students, book.students);
        const b = structuredClone(book);
        m.pairs.forEach(({ row, person }) => { const s = b.students.find((x) => x.id === person.id)!; if (row.code && !s.code) s.code = row.code; s.stt = row.stt; });
        m.unmatchedRows.forEach((s) => b.students.push({ ...s }));
        b.students.sort((a, c) => a.stt - c.stt);
        onChange(b);
        setMsg(`Đã cập nhật: ${m.pairs.length} HS khớp, thêm ${m.unmatchedRows.length} HS mới.${m.missing.length ? ` ${m.missing.length} HS cũ không có trong danh sách mới (vẫn giữ): ${m.missing.map((s) => s.name).join(', ')}.` : ''}`);
      }}>Cập nhật</button>
      {msg && <p className="small">{msg}</p>}
    </details>
  );
}
