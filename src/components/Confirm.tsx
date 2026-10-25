import { useMemo, useState } from 'react';
import type { Project, Submission } from '../types';
import type { Updater } from '../App';
import { matchFiles } from '../lib/match';
import { buildSubmission } from '../lib/extract';
import { maxTotal } from '../lib/grading';
import { fmt, pool } from '../lib/util';
import { setSetting } from '../lib/store';

const pathOf = (f: File) => (f as any).webkitRelativePath || f.name;
const short = (path: string) => path.split('/').slice(-2).join('/');

export default function Confirm({ p, update, files }: { p: Project; update: Updater; files: File[] }) {
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const fuzzy = useMemo(() => (files.length ? matchFiles(p.students, files) : null), [files, p.students]);
  const byPath = useMemo(() => new Map(files.map((f) => [pathOf(f), f])), [files]);

  const noFile = p.students.filter((s) => !p.fileMap[s.id]?.length);
  const multi = p.students.filter((s) => (p.fileMap[s.id]?.length || 0) > 1);
  const fuzzyList = fuzzy ? Object.entries(fuzzy.fuzzy).filter(([path]) => Object.values(p.fileMap).some((l) => l.includes(path))) : [];
  const total = maxTotal(p.rubric);
  const readCount = Object.keys(p.submissions).length;
  const warnStudents = p.students.filter((s) => p.submissions[s.id]?.warnings.length);

  const assign = (path: string, studentId: string) =>
    update((x) => ({ fileMap: { ...x.fileMap, [studentId]: [...(x.fileMap[studentId] || []), path] }, unmatchedFiles: x.unmatchedFiles.filter((f) => f !== path) }));
  const unassign = (path: string, studentId: string) =>
    update((x) => ({ fileMap: { ...x.fileMap, [studentId]: (x.fileMap[studentId] || []).filter((f) => f !== path) }, unmatchedFiles: [...x.unmatchedFiles, path] }));

  async function readAll() {
    const todo = p.students.filter((s) => p.fileMap[s.id]?.length);
    const missing = todo.filter((s) => p.fileMap[s.id].some((path) => !byPath.has(path)));
    if (missing.length && !files.length) return alert('Trang đã được tải lại nên cần chọn lại thư mục bài làm ở bước 1.');
    setReading({ done: 0, total: todo.length });
    const subs: Record<string, Submission> = {};
    let done = 0;
    await pool(todo, 3, async (s) => {
      const fs = p.fileMap[s.id].map((path) => byPath.get(path)).filter(Boolean) as File[];
      subs[s.id] = await buildSubmission(fs);
      setReading({ done: ++done, total: todo.length });
    });
    update({ submissions: subs, results: {} });
    setReading(null);
  }

  const start = (mode: 'trial' | 'all') => { setSetting('autostart', mode); update({ step: 2 }); };

  const issues: string[] = [];
  if (!p.examText.trim() && !p.examImages.length) issues.push('Chưa có nội dung đề bài — AI sẽ chỉ chấm theo tiêu chí.');
  if (total !== 10) issues.push(`Tổng điểm tiêu chí là ${fmt(total)} (không phải 10).`);
  p.rubric.forEach((c, i) => { if (!c.name.trim()) issues.push(`TC${i + 1} chưa có tên.`); if (!(c.max > 0)) issues.push(`TC${i + 1} có điểm tối đa bằng 0.`); });
  if (noFile.length) issues.push(`${noFile.length} HS chưa có bài nộp.`);
  if (p.unmatchedFiles.length) issues.push(`${p.unmatchedFiles.length} file chưa ghép được với HS nào.`);
  if (fuzzyList.length) issues.push(`${fuzzyList.length} file được ghép gần đúng — cần bạn xem lại.`);
  if (warnStudents.length) issues.push(`${warnStudents.length} HS có file đọc bị lỗi hoặc cần chú ý.`);

  return (
    <div className="confirm">
      <section className="card">
        <h2>Những gì tôi đã nhận</h2>
        <table className="tbl kv">
          <tbody>
            <tr><th>Bài chấm</th><td>{p.name}{p.className && ` — lớp ${p.className}`}</td></tr>
            <tr><th>Đề bài</th><td>{p.examFileName || 'Gõ trực tiếp'} · {p.examText.length} ký tự{p.examImages.length ? ` · ${p.examImages.length} hình` : ''}<div className="preview">{p.examText.slice(0, 400)}{p.examText.length > 400 && '…'}</div></td></tr>
            <tr><th>Tiêu chí</th><td>{p.rubric.length} tiêu chí, tổng {fmt(total)} điểm, bước điểm {fmt(p.scoreStep)}
              <ol className="small">{p.rubric.map((c) => <li key={c.id}>{c.name} — <b>{fmt(c.max)}đ</b>{c.desc && <span className="muted"> · {c.desc.slice(0, 140)}</span>}</li>)}</ol></td></tr>
            <tr><th>Phạm vi kiến thức</th><td>{p.curriculum || 'Tin học 6 – Kết nối tri thức'}{p.textbook ? ` · có ${p.textbook.length.toLocaleString('vi-VN')} ký tự nội dung SGK làm chuẩn` : <span className="warn-text"> · chưa có nội dung SGK — AI chấm theo hiểu biết chung về sách, nên thêm bài học liên quan</span>}</td></tr>
            <tr><th>Yêu cầu chấm</th><td className="pre">{p.instructions || <span className="muted">(không có — AI chấm theo tiêu chí)</span>}</td></tr>
            <tr><th>Danh sách lớp</th><td>{p.students.length} học sinh ({p.rosterFileName})</td></tr>
            <tr><th>Bài làm</th><td>{p.students.length - noFile.length}/{p.students.length} HS đã có file{multi.length ? ` · ${multi.length} HS có nhiều file (sẽ chấm gộp)` : ''}</td></tr>
          </tbody>
        </table>
      </section>

      <section className={`card ${issues.length ? 'warnbox' : 'okbox'}`}>
        <h2>{issues.length ? `Bất thường cần xem (${issues.length})` : 'Không thấy bất thường'}</h2>
        {issues.length > 0 && <ul>{issues.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      </section>

      {(p.unmatchedFiles.length > 0 || fuzzyList.length > 0 || noFile.length > 0) && (
        <section className="card">
          <h2>Ghép bài với học sinh</h2>
          {fuzzyList.length > 0 && <>
            <h3>Ghép gần đúng — kiểm tra lại</h3>
            <ul className="list">{fuzzyList.map(([path, note]) => {
              const sid = Object.keys(p.fileMap).find((k) => p.fileMap[k].includes(path))!;
              return <li key={path}><code>{short(path)}</code> → {note} <button className="link danger" onClick={() => unassign(path, sid)}>Bỏ ghép</button></li>;
            })}</ul>
          </>}
          {p.unmatchedFiles.length > 0 && <>
            <h3>File chưa ghép</h3>
            <ul className="list">{p.unmatchedFiles.map((path) => (
              <li key={path}><code>{short(path)}</code>
                {fuzzy?.ambiguous[path] && <span className="muted small"> (có thể là: {fuzzy.ambiguous[path].join(', ')})</span>}
                <select value="" onChange={(e) => e.target.value && assign(path, e.target.value)}>
                  <option value="">— chọn học sinh —</option>
                  {p.students.map((s) => <option key={s.id} value={s.id}>{s.stt}. {s.name}{p.fileMap[s.id]?.length ? ' (đã có bài)' : ''}</option>)}
                </select>
              </li>
            ))}</ul>
          </>}
          {noFile.length > 0 && <>
            <h3>Học sinh chưa có bài ({noFile.length})</h3>
            <div className="roster-preview">{noFile.map((s) => <span key={s.id} className="chip">{s.stt}. {s.name}</span>)}</div>
            <p className="muted small">{p.noSubmissionZero ? 'Những HS này sẽ được để 0 điểm và đánh dấu để bạn xác nhận.' : 'Những HS này sẽ để trống điểm.'}</p>
          </>}
        </section>
      )}

      <section className="card">
        <h2>Đọc bài làm</h2>
        <p className="muted small">Hệ thống mở từng file, trích nội dung và định dạng (cỡ chữ, căn lề, hiệu ứng, khối lệnh Scratch…) để AI chấm và để bôi đỏ lỗi khi bạn duyệt.</p>
        <div className="row">
          <button className="btn" disabled={!!reading} onClick={readAll}>{readCount ? 'Đọc lại toàn bộ bài' : 'Đọc bài làm'}</button>
          {reading && <span className="muted">Đang đọc {reading.done}/{reading.total}…</span>}
          {!reading && readCount > 0 && <span className="ok-text">Đã đọc bài của {readCount} HS.</span>}
        </div>
        {warnStudents.length > 0 && (
          <ul className="note warn">{warnStudents.map((s) => <li key={s.id}><b>{s.name}:</b> {p.submissions[s.id].warnings.join(' ')}</li>)}</ul>
        )}
      </section>

      <div className="actions">
        <button className="btn" onClick={() => update({ step: 0 })}>← Sửa nhập liệu</button>
        <button className="btn" disabled={!readCount} onClick={() => start('trial')} title="Chấm 2 bài đầu để bạn xem cách AI chấm trước">Chấm thử 2 bài</button>
        <button className="btn primary big" disabled={!readCount} onClick={() => start('all')}>Xác nhận & chấm cả lớp →</button>
      </div>
    </div>
  );
}
