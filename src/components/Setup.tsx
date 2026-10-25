import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, Criterion, ClassBook, ScoreCol, Term } from '../types';
import { COLS, TERMS, TERM_LABEL } from '../types';
import { listClasses, listTextbooks, saveTextbook } from '../lib/store';
import { autoPick, contextFor, gradeOf, rankLessons, readTextbookFiles, type Textbook } from '../lib/textbook';
import { findClassFor } from '../lib/gradebook';
import type { Updater } from '../App';
import { readTeacherFile, isJunkFile } from '../lib/extract';
import { parsePasted, parseRosterFile } from '../lib/roster';
import { matchFiles } from '../lib/match';
import { api } from '../lib/api';
import { setSetting } from '../lib/store';
import { uid, fmt } from '../lib/util';
import { maxTotal, DEFAULT_CURRICULUM } from '../lib/grading';

type Props = { p: Project; update: Updater; files: File[]; setFiles: (f: File[]) => void };

export function parseRubricTable(text: string): Criterion[] {
  return text.replace(/\r/g, '').split('\n').map((l) => l.split('\t').map((c) => c.trim())).filter((r) => r.some(Boolean)).map((cells) => {
    const numIdx = cells.findIndex((c) => /^\d+([.,]\d+)?$/.test(c));
    const textCells = cells.filter((c, i) => i !== numIdx && c && !/^\d+[.)]?$/.test(c));
    return { id: uid(), name: textCells[0] || '', max: numIdx >= 0 ? Number(cells[numIdx].replace(',', '.')) : 0, desc: textCells.slice(1).join(' — '), header: numIdx < 0 };
  }).filter((c) => c.name && !(c.header && /^(tiêu chí|tieu chi|nội dung|stt|tt)/i.test(c.name)) && !/^(tổng|tong cong|cộng)\b/i.test(c.name))
    .map(({ header, ...c }) => c);
}

export default function Setup({ p, update, files, setFiles }: Props) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [rosterNotes, setRosterNotes] = useState<string[]>([]);
  const [rubricText, setRubricText] = useState('');
  const [rubricNote, setRubricNote] = useState('');
  const [pasteRoster, setPasteRoster] = useState('');
  const folderRef = useRef<HTMLInputElement>(null);
  const [classes, setClasses] = useState<ClassBook[]>([]);
  useEffect(() => { listClasses().then(setClasses); }, []);

  function pickClassBook(id: string) {
    const c = classes.find((x) => x.id === id);
    if (!c) return;
    const students = c.students.map((s) => ({ ...s }));
    update({ classId: c.id, className: c.name, students, rosterFileName: `Sổ điểm lớp ${c.name}`, results: {}, submissions: {}, fileMap: {} });
    setRosterNotes([]);
    say('roster', `Đã lấy ${students.length} học sinh từ sổ điểm lớp ${c.name}.`);
    if (files.length) rematch(students, files);
  }
  const linked = classes.find((c) => c.id === p.classId) || (p.className ? findClassFor(p.className, classes) : undefined);

  const say = (k: string, v: string) => setMsg((m) => ({ ...m, [k]: v }));

  async function onExamFile(f: File) {
    setBusy('exam');
    try {
      const r = await readTeacherFile(f);
      update({ examText: r.text, examImages: r.images, examFileName: f.name });
      say('exam', r.text ? `Đã đọc ${f.name}: ${r.text.length} ký tự${r.images.length ? `, ${r.images.length} hình` : ''}.` : `Không đọc được chữ trong ${f.name} — sẽ gửi dạng hình.`);
    } catch (e: any) { say('exam', 'Lỗi: ' + e.message); }
    setBusy('');
  }

  async function onRubricFile(f: File) {
    setBusy('rubric');
    try {
      const r = await readTeacherFile(f);
      setRubricText(r.text);
      say('rubric', `Đã đọc ${f.name}. Bấm “AI tách tiêu chí” để chuyển thành bảng.`);
    } catch (e: any) { say('rubric', 'Lỗi: ' + e.message); }
    setBusy('');
  }

  async function aiParseRubric() {
    if (!rubricText.trim()) return say('rubric', 'Chưa có nội dung tiêu chí.');
    setBusy('rubric');
    try {
      const r = await api<{ criteria: { name: string; max: number; desc: string }[]; notes?: string }>('parse-rubric', { text: rubricText });
      const crit = (r.criteria || []).map((c) => ({ id: uid(), name: c.name, max: Number(c.max) || 0, desc: c.desc || '' }));
      update({ rubric: crit });
      setRubricNote(r.notes || '');
      say('rubric', `AI tách được ${crit.length} tiêu chí. Kiểm tra lại bảng bên dưới.`);
    } catch (e: any) { say('rubric', 'Lỗi: ' + e.message); }
    setBusy('');
  }

  function pasteRubric() {
    const crit = parseRubricTable(rubricText);
    if (!crit.length) return say('rubric', 'Không nhận ra bảng. Dán từ Excel theo cột: Tiêu chí | Điểm | Mô tả.');
    update({ rubric: crit });
    say('rubric', `Đã nhận ${crit.length} tiêu chí từ bảng dán.`);
  }

  const setCrit = (id: string, patch: Partial<Criterion>) => update((x) => ({ rubric: x.rubric.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  async function onRosterFile(f: File) {
    setBusy('roster');
    try {
      const r = await parseRosterFile(f);
      update({ students: r.students, rosterFileName: f.name, classId: undefined, results: {}, submissions: {}, fileMap: {} });
      setRosterNotes(r.notes);
      say('roster', `Đã đọc ${r.students.length} học sinh từ ${f.name}.`);
      if (files.length) rematch(r.students, files);
    } catch (e: any) { say('roster', 'Lỗi: ' + e.message); }
    setBusy('');
  }

  function onPasteRoster() {
    const r = parsePasted(pasteRoster);
    if (!r.students.length) return say('roster', 'Không nhận ra danh sách. Hãy copy cả cột “Họ và tên” (kèm dòng tiêu đề) từ Excel.');
    update({ students: r.students, rosterFileName: '(dán từ Excel)', classId: undefined, results: {}, submissions: {}, fileMap: {} });
    setRosterNotes(r.notes);
    say('roster', `Đã nhận ${r.students.length} học sinh.`);
    if (files.length) rematch(r.students, files);
  }

  function rematch(students = p.students, fs = files) {
    const m = matchFiles(students, fs);
    update({ fileMap: m.map, unmatchedFiles: m.unmatched, submissions: {} });
    const matched = Object.keys(m.map).length;
    say('files', `${fs.length} file · ghép được bài cho ${matched}/${students.length} HS · ${m.unmatched.length} file chưa ghép.`);
  }

  function onFolder(list: FileList | null) {
    if (!list) return;
    const fs = Array.from(list).filter((f) => !isJunkFile((f as any).webkitRelativePath || f.name));
    setFiles(fs);
    if (p.students.length) rematch(p.students, fs);
    else say('files', `Đã chọn ${fs.length} file. Nhập danh sách lớp để ghép bài.`);
  }

  const total = maxTotal(p.rubric);
  const ready = p.rubric.length > 0 && p.students.length > 0 && (files.length > 0 || Object.keys(p.submissions).length > 0);

  return (
    <div className="setup">
      <section className="card">
        <h2>1. Thông tin bài chấm</h2>
        <div className="grid2">
          <label>Tên bài<input value={p.name} onChange={(e) => update({ name: e.target.value })} placeholder="VD: Thực hành Word — Tin 6 — Giữa kì I" /></label>
          <label>Lớp<input value={p.className} onChange={(e) => update({ className: e.target.value, grade: gradeOf(e.target.value) || p.grade })} placeholder="VD: 6A1" /></label>
          <label>Trường<input value={p.school} onChange={(e) => { update({ school: e.target.value }); setSetting('school', e.target.value); }} /></label>
          <label>Giáo viên chấm<input value={p.teacher} onChange={(e) => { update({ teacher: e.target.value }); setSetting('teacher', e.target.value); }} /></label>
          <label>Học kì
            <select value={p.term || 'HK1'} onChange={(e) => { update({ term: e.target.value as Term }); setSetting('term', e.target.value); }}>
              {TERMS.map((t) => <option key={t} value={t}>{TERM_LABEL[t]}</option>)}
            </select>
          </label>
          <label>Điểm bài này là cột
            <select value={p.column || 'GK'} onChange={(e) => update({ column: e.target.value as ScoreCol })}>
              {COLS.map((k) => <option key={k} value={k}>{k === 'GK' ? 'GK — giữa kì' : k === 'CK' ? 'CK — cuối kì' : `${k} — thường xuyên`}</option>)}
            </select>
          </label>
        </div>
        <p className="muted small">Khi bạn chốt điểm, điểm (thang 10, 1 chữ số thập phân) được ghi vào cột {p.column || 'GK'} – {TERM_LABEL[p.term || 'HK1']} của sổ điểm lớp {p.className || '…'}{linked ? '' : ' (sổ sẽ được tạo mới nếu chưa có)'}.</p>
      </section>

      <section className="card">
        <h2>2. Đề bài</h2>
        <div className="row">
          <label className="btn">Chọn file đề (Word, PDF, PowerPoint, ảnh)<input hidden type="file" accept=".docx,.pdf,.pptx,.txt,image/*" onChange={(e) => e.target.files?.[0] && onExamFile(e.target.files[0])} /></label>
          {busy === 'exam' && <span className="muted">Đang đọc…</span>}
          {msg.exam && <span className="muted">{msg.exam}</span>}
        </div>
        <textarea rows={6} value={p.examText} onChange={(e) => update({ examText: e.target.value })} placeholder="…hoặc gõ / dán nội dung đề vào đây" />
      </section>

      <section className="card">
        <h2>3. Tiêu chí chấm</h2>
        <div className="row">
          <label className="btn">Chọn file tiêu chí<input hidden type="file" accept=".docx,.pdf,.xlsx,.txt" onChange={(e) => e.target.files?.[0] && onRubricFile(e.target.files[0])} /></label>
          <button className="btn" disabled={busy === 'rubric'} onClick={aiParseRubric}>AI tách tiêu chí</button>
          <button className="btn" onClick={pasteRubric} title="Dán từ Excel: Tiêu chí | Điểm | Mô tả">Nhận bảng dán từ Excel</button>
          {busy === 'rubric' && <span className="muted">Đang xử lý…</span>}
        </div>
        {msg.rubric && <p className="muted small">{msg.rubric}</p>}
        <textarea rows={4} value={rubricText} onChange={(e) => setRubricText(e.target.value)} placeholder="Nội dung file tiêu chí sẽ hiện ở đây — hoặc dán bảng từ Excel (Tiêu chí | Điểm | Mô tả) rồi bấm “Nhận bảng dán từ Excel”" />
        {rubricNote && <div className="note warn">AI lưu ý: {rubricNote}</div>}
        <table className="tbl rubric">
          <thead><tr><th>#</th><th>Tiêu chí</th><th style={{ width: 90 }}>Điểm tối đa</th><th>Mô tả / cách chấm</th><th /></tr></thead>
          <tbody>
            {p.rubric.map((c, i) => (
              <tr key={c.id}>
                <td>TC{i + 1}</td>
                <td><input value={c.name} onChange={(e) => setCrit(c.id, { name: e.target.value })} /></td>
                <td><input type="number" min={0} step={0.25} value={c.max} onChange={(e) => setCrit(c.id, { max: Number(e.target.value) })} /></td>
                <td><textarea rows={2} value={c.desc} onChange={(e) => setCrit(c.id, { desc: e.target.value })} /></td>
                <td><button className="link danger" onClick={() => update((x) => ({ rubric: x.rubric.filter((y) => y.id !== c.id) }))}>Xóa</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td /><td><button className="link" onClick={() => update((x) => ({ rubric: [...x.rubric, { id: uid(), name: '', max: 1, desc: '' }] }))}>+ Thêm tiêu chí</button></td>
            <td className={total !== 10 && p.rubric.length ? 'warn-text' : ''}><b>{fmt(total)}</b></td><td>{total !== 10 && p.rubric.length > 0 && <span className="warn-text">Tổng điểm khác 10 — kiểm tra lại nếu thang điểm là 10.</span>}</td><td /></tr></tfoot>
        </table>
      </section>

      <TextbookSection p={p} update={update} />

      <section className="card">
        <h2>5. Yêu cầu chấm của bạn</h2>
        <p className="muted small">Mô tả cách bạn muốn chấm. AI sẽ ưu tiên những yêu cầu này hơn tiêu chí chung.</p>
        <textarea rows={5} value={p.instructions} onChange={(e) => update({ instructions: e.target.value })}
          placeholder={'VD:\n- Sai chính tả: trừ 0,25 mỗi lỗi, tối đa trừ 1 điểm ở tiêu chí nội dung.\n- Tiêu đề phải căn giữa, chữ đậm, cỡ 16 trở lên; thiếu một yêu cầu trừ 0,25.\n- Không trừ điểm phông chữ nếu HS dùng Arial thay Times New Roman.\n- Học sinh lớp 6, chấm nhẹ tay phần trình bày.'} />
        <div className="row">
          <label className="inline">Bước điểm
            <select value={p.scoreStep} onChange={(e) => update({ scoreStep: Number(e.target.value) })}>
              {[0.1, 0.25, 0.5, 1].map((s) => <option key={s} value={s}>{fmt(s)}</option>)}
            </select>
          </label>
          <label className="inline"><input type="checkbox" checked={p.noSubmissionZero} onChange={(e) => update({ noSubmissionZero: e.target.checked })} /> HS không nộp bài: để điểm 0 (vẫn cần bạn xác nhận)</label>
        </div>
      </section>

      <section className="card">
        <h2>6. Danh sách lớp</h2>
        {classes.length > 0 && (
          <div className="row">
            <label className="inline">Lấy từ sổ điểm lớp
              <select value={p.classId || ''} onChange={(e) => pickClassBook(e.target.value)}>
                <option value="">— chọn —</option>
                {classes.map((c) => <option key={c.id} value={c.id}>Lớp {c.name} ({c.students.length} HS)</option>)}
              </select>
            </label>
            <span className="muted small">hoặc nhập bảng điểm lớp:</span>
          </div>
        )}
        <div className="row">
          <label className="btn">Chọn file Excel / CSV<input hidden type="file" accept=".xlsx,.xlsm,.csv,.txt,.xls" onChange={(e) => e.target.files?.[0] && onRosterFile(e.target.files[0])} /></label>
          {busy === 'roster' && <span className="muted">Đang đọc…</span>}
          {msg.roster && <span className="muted">{msg.roster}</span>}
        </div>
        <details>
          <summary>Hoặc copy danh sách từ Excel rồi dán vào đây</summary>
          <textarea rows={5} value={pasteRoster} onChange={(e) => setPasteRoster(e.target.value)} placeholder={'STT\tHọ và tên\tMã HS\n1\tNguyễn Văn An\tHS001\n…'} />
          <button className="btn" onClick={onPasteRoster}>Nhận danh sách</button>
        </details>
        {rosterNotes.length > 0 && <ul className="note warn">{rosterNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        {p.students.length > 0 && (
          <div className="roster-preview">
            {p.students.slice(0, 60).map((s) => <span key={s.id} className="chip">{s.stt}. {s.name}{s.code ? ` · ${s.code}` : ''}</span>)}
            {p.students.length > 60 && <span className="muted">… và {p.students.length - 60} HS nữa</span>}
          </div>
        )}
      </section>

      <section className="card">
        <h2>7. Bài làm của học sinh</h2>
        <p className="muted small">Chọn thư mục chứa bài. Tên file hoặc tên thư mục con cần có họ tên (hoặc mã) học sinh, có dấu hay không dấu đều được. Hỗ trợ .docx, .pptx, .sb3, .pdf, ảnh, .xlsx, .py/.txt.</p>
        <div className="row">
          <button className="btn" onClick={() => folderRef.current?.click()}>Chọn thư mục bài làm</button>
          <label className="btn">Hoặc chọn nhiều file<input hidden type="file" multiple onChange={(e) => onFolder(e.target.files)} /></label>
          <input ref={folderRef} hidden type="file" {...({ webkitdirectory: '', directory: '' } as any)} multiple onChange={(e) => onFolder(e.target.files)} />
          {msg.files && <span className="muted">{msg.files}</span>}
        </div>
        {!files.length && Object.keys(p.submissions).length > 0 && <p className="muted small">Đã đọc bài của {Object.keys(p.submissions).length} HS ở lần trước — không cần chọn lại thư mục trừ khi muốn đọc lại.</p>}
      </section>

      <div className="actions">
        <button className="btn primary big" disabled={!ready} onClick={() => update({ step: 1 })}>Tiếp: kiểm tra & xác nhận →</button>
        {!ready && <span className="muted small">Cần có tiêu chí, danh sách lớp và bài làm.</span>}
      </div>
    </div>
  );
}


type Lesson = { name: string; text: string };
const loadLib = (): Lesson[] => { try { return JSON.parse(localStorage.getItem('cd:sgk') || '[]'); } catch { return []; } };
const saveLib = (l: Lesson[]) => { try { localStorage.setItem('cd:sgk', JSON.stringify(l)); } catch { alert('Không lưu được vào thư viện (bộ nhớ trình duyệt đầy?).'); } };

/** Phạm vi kiến thức: AI chỉ chấm theo chuẩn SGK của khối, không theo kiến thức chuyên sâu. */
function TextbookSection({ p, update }: { p: Project; update: Updater }) {
  const [lib, setLib] = useState<Lesson[]>(loadLib);
  const [books, setBooks] = useState<Textbook[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { listTextbooks().then(setBooks); }, []);
  const grade = p.grade || gradeOf(p.className);
  const subject = (p.curriculum || 'Tin học').split(/\s\d/)[0].trim() || 'Tin học';
  const book = books.find((b) => b.grade === grade && b.subject === subject) || books.find((b) => b.grade === grade);
  const query = [p.name, p.examText, p.rubric.map((c) => `${c.name} ${c.desc}`).join(' '), p.instructions].join(' ');
  const ranked = useMemo(() => (book ? rankLessons(book, query) : []), [book, query]);
  const auto = p.lessonsAuto !== false;
  const picked = useMemo(() => (!book ? [] : auto ? autoPick(book, query) : (p.lessonIds || []).filter((id) => book.lessons.some((l) => l.id === id))), [book, auto, query, p.lessonIds]);

  // giữ phần SGK sẽ gửi cho AI luôn khớp với lựa chọn
  useEffect(() => {
    const ctx = book ? contextFor(book, picked) : '';
    const titles = book ? picked.map((id) => book.lessons.find((l) => l.id === id)!.title) : [];
    if (ctx !== (p.sgkContext || '') || titles.join('|') !== (p.sgkTitles || []).join('|')) update({ sgkContext: ctx, sgkTitles: titles, grade });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, picked.join(',')]);

  const toggle = (id: string) => {
    const cur = new Set(picked);
    cur.has(id) ? cur.delete(id) : cur.add(id);
    update({ lessonsAuto: false, lessonIds: [...cur] });
  };

  async function uploadBook(files: FileList | null) {
    if (!files?.length || !grade) return;
    setBusy(true);
    try {
      const r = await readTextbookFiles(Array.from(files), grade, subject);
      if (book) r.book.id = book.id;
      await saveTextbook(r.book);
      setBooks(await listTextbooks());
      update({ lessonsAuto: true, lessonIds: [] });
      setMsg(`Đã đọc ${r.book.lessons.length} bài từ ${r.book.fileNames.join(', ')}. ${r.warnings.join(' ')}`);
    } catch (e: any) { setMsg('Lỗi: ' + e.message); }
    setBusy(false);
  }

  async function onFile(f: File) {
    try {
      const r = await readTeacherFile(f);
      update({ textbook: (p.textbook ? p.textbook + '\n\n' : '') + `### ${f.name.replace(/\.[^.]+$/, '')}\n${r.text}` });
      setMsg(r.text ? `Đã thêm nội dung ${f.name}.` : `Không đọc được chữ trong ${f.name} (bản scan?).`);
    } catch (e: any) { setMsg('Lỗi: ' + e.message); }
  }
  const sgkLen = (p.sgkContext || '').length;
  const len = (p.textbook || '').length;
  const shown = showAll ? ranked : ranked.filter((r, i) => i < 8 || picked.includes(r.lesson.id));

  return (
    <section className="card">
      <h2>4. Phạm vi kiến thức</h2>
      <p className="muted small">AI chấm theo chuẩn kiến thức của SGK và lứa tuổi này: trả lời đúng ý như SGK (kể cả diễn đạt đơn giản) là đủ điểm; không trừ điểm vì thiếu kiến thức chuyên sâu ngoài sách.</p>
      <div className="grid2">
        <label>Lớp / môn / bộ sách
          <input value={p.curriculum ?? DEFAULT_CURRICULUM} onChange={(e) => update({ curriculum: e.target.value })} />
        </label>
        <label>Khối
          <input value={grade} onChange={(e) => update({ grade: e.target.value.replace(/\D/g, '') })} placeholder="VD: 6" />
        </label>
      </div>

      <div className={`sgk-box ${book ? 'ok' : ''}`}>
        <div className="row between" style={{ margin: 0 }}>
          <b>{book ? `SGK ${book.name}: ${book.lessons.length} bài (${book.fileNames.join(', ')})` : grade ? `Chưa có SGK khối ${grade}` : 'Nhập tên lớp / khối để dùng SGK'}</b>
          {grade && <label className="btn">{busy ? 'Đang đọc sách…' : book ? 'Thay file SGK' : `Tải SGK khối ${grade}`}<input hidden type="file" multiple accept=".pdf,.docx,.txt" disabled={busy} onChange={(e) => { uploadBook(e.target.files); e.target.value = ''; }} /></label>}
        </div>
        {book && (
          <>
            <div className="row small" style={{ margin: '8px 0 0' }}>
              <label className="inline small"><input type="radio" checked={auto} onChange={() => update({ lessonsAuto: true })} /> Tự chọn bài liên quan tới đề & tiêu chí</label>
              <label className="inline small"><input type="radio" checked={!auto} onChange={() => update({ lessonsAuto: false, lessonIds: picked })} /> Tôi tự chọn</label>
            </div>
            {!query.trim() || !ranked.some((r) => r.score > 0) ? <p className="small warn-text">Nhập đề bài và tiêu chí để app tìm bài SGK liên quan (hoặc tự tích chọn).</p> : null}
            <div className="lesson-list">
              {shown.map(({ lesson, score }) => (
                <label key={lesson.id}><input type="checkbox" checked={picked.includes(lesson.id)} onChange={() => toggle(lesson.id)} />{lesson.title}<span className="rel">{score > 0 ? `liên quan ${Math.round(score)}` : ''}</span></label>
              ))}
              {!showAll && ranked.length > shown.length && <button className="link small" onClick={() => setShowAll(true)}>Xem tất cả {ranked.length} bài</button>}
            </div>
            <p className="small muted">Gửi cho AI: {picked.length ? `${p.sgkTitles?.join('; ')} (${sgkLen.toLocaleString('vi-VN')} ký tự)` : 'chưa chọn bài nào'}.</p>
          </>
        )}
        {msg && <p className="small">{msg}</p>}
      </div>

      <details>
        <summary>Ghi chú kiến thức thêm (dán đoạn SGK / giáo án riêng)</summary>
        <div className="row">
          <label className="btn">Tải file (Word, PDF, ảnh)<input hidden type="file" accept=".docx,.pdf,.txt,.pptx,image/*" onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.target.value = ''; }} /></label>
          {lib.length > 0 && (
            <select style={{ width: 'auto' }} value="" onChange={(e) => {
              const l = lib.find((x) => x.name === e.target.value);
              if (l) update({ textbook: (p.textbook ? p.textbook + '\n\n' : '') + `### ${l.name}\n${l.text}` });
            }}>
              <option value="">+ Thêm từ ghi chú đã lưu ({lib.length})</option>
              {lib.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
            </select>
          )}
        </div>
        <textarea rows={5} value={p.textbook || ''} onChange={(e) => update({ textbook: e.target.value })}
          placeholder={'VD: Bài 1. Thông tin và dữ liệu\n- (dán phần khái niệm, ghi nhớ của bài học vào đây)'} />
        <div className="row">
          <span className={`small ${sgkLen + len > 24000 ? 'warn-text' : 'muted'}`}>{len.toLocaleString('vi-VN')} ký tự{sgkLen + len > 24000 ? ' — tổng SGK + ghi chú quá dài, phần cuối sẽ bị cắt.' : ''}</span>
          {len > 0 && <>
            <input style={{ width: 260 }} placeholder="Tên để lưu, VD: Bài 1 – Thông tin và dữ liệu" value={p.textbookName || ''} onChange={(e) => update({ textbookName: e.target.value })} />
            <button className="btn" disabled={!p.textbookName?.trim()} onClick={() => {
              const name = p.textbookName!.trim();
              const next = [...lib.filter((l) => l.name !== name), { name, text: p.textbook! }].sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true }));
              saveLib(next); setLib(next); setMsg(`Đã lưu "${name}".`);
            }}>Lưu ghi chú</button>
          </>}
        </div>
      </details>
    </section>
  );
}
