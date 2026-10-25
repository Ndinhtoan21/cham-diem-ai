import { useState } from 'react';
import type { Project } from '../types';
import type { Updater } from '../App';
import { exportWord } from '../lib/exportWord';
import { download, safeFileName } from '../lib/util';

export default function ExportPanel({ p, update, goSystems }: { p: Project; update: Updater; goSystems: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const graded = p.students.filter((s) => p.results[s.id]?.status === 'done').length;

  async function word() {
    setBusy(true);
    setErr('');
    try {
      const blob = await exportWord(p);
      download(blob, safeFileName(`Bang diem ${p.className || ''} ${p.name}${p.finalized ? '' : ' (nhap)'}.docx`));
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  }

  return (
    <div className="export">
      {!p.finalized && (
        <div className="banner draft">
          Điểm chưa chốt — file Word sẽ có dòng “BẢN NHÁP”.
          <button className="btn" onClick={() => update({ step: 3 })}>Quay lại duyệt & chốt</button>
        </div>
      )}
      <div className="cards">
        <section className="card export-card">
          <h2>1. File Word bảng điểm</h2>
          <p className="muted">Trang 1: tiêu chí chấm. Trang 2: danh sách học sinh, điểm từng tiêu chí và tổng điểm, có chỗ ký của giáo viên.</p>
          <p className="small">{graded}/{p.students.length} HS đã có điểm.</p>
          <button className="btn primary" disabled={busy || !graded} onClick={word}>{busy ? 'Đang tạo…' : 'Tải file Word'}</button>
          {err && <p className="danger-text small">{err}</p>}
        </section>
        <section className="card export-card">
          <h2>2. Mẫu nhập điểm FSP</h2>
          <p className="muted">Điền điểm vào file mẫu FSP của trường — một lớp, hoặc cả khối (mỗi lớp một sheet trong cùng file).</p>
          <p className="small">{p.postedAt ? <span className="ok-text">✓ Điểm bài này đã vào sổ điểm lớp {p.className} ({p.term} · cột {p.column}).</span> : <span className="warn-text">Cần chốt điểm để điểm vào sổ điểm lớp trước.</span>}</p>
          <button className="btn primary" disabled={!p.postedAt} onClick={goSystems}>Mở trang xuất FSP / CSDL</button>
        </section>
        <section className="card export-card">
          <h2>3. Mẫu nhập điểm CSDL</h2>
          <p className="muted">Điền điểm vào bảng điểm CSDL của Sở mà bạn tải lên cho lớp. Trước khi xuất, hệ thống báo những gì đã nhận và các bất thường.</p>
          <p className="small muted">Giai đoạn giữa kì sẽ nhập TX1 + GK; cuối kì nhập TX2 + CK. Điểm TX nhập ở “Sổ điểm lớp”.</p>
          <button className="btn primary" disabled={!p.postedAt} onClick={goSystems}>Mở trang xuất FSP / CSDL</button>
        </section>
      </div>
    </div>
  );
}
