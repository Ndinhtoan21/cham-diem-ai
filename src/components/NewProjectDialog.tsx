import { useEffect, useState } from 'react';
import type { ClassBook, Project, ScoreCol, Term } from '../types';
import { COLS, TERMS, TERM_LABEL } from '../types';
import { listClasses, listTextbooks, saveTextbook, setSetting } from '../lib/store';
import { findClassFor } from '../lib/gradebook';
import { gradeOf, readTextbookFiles, type Textbook } from '../lib/textbook';
import { newProject } from '../App';

/** Bước đầu tiên khi tạo phiên chấm: lớp nào → khối nào → SGK của khối đó. */
export default function NewProjectDialog({ onCancel, onCreate }: { onCancel: () => void; onCreate: (p: Project) => void }) {
  const base = newProject();
  const [className, setClassName] = useState('');
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('Tin học');
  const [term, setTerm] = useState<Term>(base.term || 'HK1');
  const [column, setColumn] = useState<ScoreCol>('GK');
  const [classes, setClasses] = useState<ClassBook[]>([]);
  const [books, setBooks] = useState<Textbook[]>([]);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState('');
  const [msg, setMsg] = useState<string[]>([]);
  useEffect(() => { listClasses().then(setClasses); listTextbooks().then(setBooks); }, []);

  const grade = gradeOf(className);
  const cb = className.trim() ? findClassFor(className, classes) : undefined;
  const book = books.find((b) => b.grade === grade && b.subject === subject);

  async function upload(files: FileList | null) {
    if (!files?.length || !grade) return;
    setBusy(true); setMsg([]);
    try {
      const r = await readTextbookFiles(Array.from(files), grade, subject, (m) => setProg(m));
      if (book) r.book.id = book.id; // thay sách cũ của khối
      await saveTextbook(r.book);
      setBooks(await listTextbooks());
      setMsg([`Đã đọc ${r.book.fileNames.join(', ')}: ${r.book.lessons.length} bài, ${r.book.chars.toLocaleString('vi-VN')} ký tự.`, ...r.warnings]);
    } catch (e: any) { setMsg(['Lỗi: ' + e.message]); }
    setBusy(false);
  }

  function create() {
    setSetting('term', term);
    onCreate({
      ...base,
      name: name.trim() || `Bài chấm ${className.trim()}`,
      className: cb?.name || className.trim().toUpperCase(),
      grade,
      curriculum: `${subject} ${grade} – bộ sách Kết nối tri thức với cuộc sống (học sinh lớp ${grade})`,
      term, column,
      ...(cb ? { classId: cb.id, students: cb.students.map((s) => ({ ...s })), rosterFileName: `Sổ điểm lớp ${cb.name}` } : {}),
      lessonsAuto: true,
    });
  }

  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="card modal-md" onClick={(e) => e.stopPropagation()}>
        <h2>Tạo phiên chấm mới</h2>
        <div className="grid2">
          <label>Lớp cần chấm *
            <input autoFocus list="dlg-classes" value={className} onChange={(e) => setClassName(e.target.value)} placeholder="VD: 6A1" />
            <datalist id="dlg-classes">{classes.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          </label>
          <label>Tên bài kiểm tra
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Thực hành Word – Giữa kì I" />
          </label>
          <label>Môn<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <div className="grid2" style={{ gap: 8 }}>
            <label>Học kì
              <select value={term} onChange={(e) => setTerm(e.target.value as Term)}>{TERMS.map((t) => <option key={t} value={t}>{TERM_LABEL[t]}</option>)}</select>
            </label>
            <label>Cột điểm
              <select value={column} onChange={(e) => setColumn(e.target.value as ScoreCol)}>{COLS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
            </label>
          </div>
        </div>

        {className.trim() && (
          <div className="note">
            {grade ? <>Khối <b>{grade}</b>. </> : <span className="warn-text">Không đọc được khối từ tên lớp (cần có số, VD 6A1). </span>}
            {cb ? <>Đã có sổ điểm lớp <b>{cb.name}</b> ({cb.students.length} HS) — danh sách sẽ được lấy tự động.</> : <span className="muted">Chưa có sổ điểm lớp này — bạn nhập danh sách ở bước sau.</span>}
          </div>
        )}

        {grade && (
          <section className={`sgk-box ${book ? 'ok' : ''}`}>
            <h3 style={{ marginTop: 0 }}>SGK {subject} {grade}</h3>
            {book ? (
              <p className="small">✓ Đã có: {book.fileNames.join(', ')} · {book.lessons.length} bài. Khi chấm, app tự chọn các bài liên quan tới đề để đối chiếu.</p>
            ) : (
              <p className="small">Chưa có SGK của khối {grade}. Tải file sách PDF (kể cả bản scan) hoặc Word để hệ thống hiểu nội dung đã dạy và chấm sát với chuẩn của lớp. Chỉ cần tải một lần cho cả khối.</p>
            )}
            <label className="btn">{busy ? 'Đang đọc sách…' : book ? 'Thay file SGK' : `Tải SGK ${subject} ${grade}`}
              <input hidden type="file" multiple disabled={busy} accept=".pdf,.docx,.txt" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
            </label>
            {busy && prog && <p className="small muted">{prog}</p>}
            {msg.length > 0 && <ul className="small">{msg.map((m, i) => <li key={i} className={i ? 'warn-text' : ''}>{m}</li>)}</ul>}
          </section>
        )}

        <div className="row end">
          <button className="btn" onClick={onCancel}>Hủy</button>
          <button className="btn primary" disabled={!className.trim() || busy} onClick={create}>{book || !grade ? 'Tạo phiên chấm' : 'Tạo (chưa có SGK)'}</button>
        </div>
      </div>
    </div>
  );
}
