import { useEffect, useRef, useState } from 'react';
import type { Project, Result } from '../types';
import type { Updater } from '../App';
import { applyHighlights } from '../lib/highlight';
import { effective, isEdited, maxTotal, totalOf } from '../lib/grading';
import { fmt } from '../lib/util';
import { finalScore } from '../lib/gradebook';
import { useGrader } from './Grading';

type Props = { p: Project; update: Updater; studentId: string; onClose: () => void; onNav: (d: number) => void; onConfirmNext: () => void };

export default function Viewer({ p, update, studentId, onClose, onNav, onConfirmNext }: Props) {
  const st = p.students.find((s) => s.id === studentId)!;
  const r = p.results[studentId];
  const sub = p.submissions[studentId];
  const docRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [located, setLocated] = useState<Set<number>>(new Set());
  const [note, setNote] = useState('');
  const { running, run } = useGrader(p, update);
  const locked = p.finalized;

  useEffect(() => {
    const el = docRef.current;
    if (!el) return;
    el.innerHTML = sub?.html || '<p class="muted">(Không có nội dung để hiển thị)</p>';
    const found = applyHighlights(el, (r?.errors || []).map((e, i) => ({ idx: i, quote: e.quote, active: i === active })));
    setLocated(found);
  }, [sub?.html, r?.errors, active]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onNav(1);
      if (e.key === 'ArrowLeft') onNav(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onNav]);

  const focusError = (i: number) => {
    setActive(i);
    setTimeout(() => docRef.current?.querySelector(`mark[data-err="${i}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 30);
  };
  const onDocClick = (e: React.MouseEvent) => {
    const m = (e.target as HTMLElement).closest('mark.err') as HTMLElement | null;
    if (m) {
      const i = Number(m.dataset.err);
      setActive(i);
      document.getElementById(`err-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const setRes = (patch: Partial<Result>) => update((x) => ({ results: { ...x.results, [studentId]: { ...x.results[studentId], ...patch } } }));
  const setScore = (cid: string, raw: string) => {
    if (locked) return;
    const c = p.rubric.find((x) => x.id === cid)!;
    const v = raw === '' ? null : Math.min(c.max, Math.max(0, Number(raw.replace(',', '.'))));
    setRes({ scores: r.scores.map((s) => (s.criterionId === cid ? { ...s, teacher: v != null && !Number.isNaN(v) ? v : null } : s)) });
  };
  const removeError = (i: number) => !locked && setRes({ errors: r.errors.filter((_, j) => j !== i) });

  if (!r) return null;
  const max = maxTotal(p.rubric);
  const total = totalOf(r);
  const orphan = r.errors.map((e, i) => ({ e, i })).filter(({ e }) => !e.criterionId);

  return (
    <div className="modal-bg">
      <div className="viewer">
        <header className="viewer-head">
          <button className="btn" onClick={() => onNav(-1)} title="Bài trước (←)">←</button>
          <div className="who">
            <div className="who-name">{st.stt}. {st.name}</div>
            <div className="muted small">{sub?.fileNames.join(', ') || 'Không có file'}</div>
          </div>
          <div className={`big-total ${r.scores.some(isEdited) ? 'edited' : ''}`}>{fmt(total)}<span>/{fmt(max)}</span>{max !== 10 && <span className="small"> → {fmt(finalScore(p, r))}/10</span>}</div>
          <button className="btn" onClick={() => onNav(1)} title="Bài sau (→)">→</button>
          <span className="spacer" />
          {!locked && <button className="btn primary" onClick={onConfirmNext}>✓ Đã xem — bài tiếp chưa xem</button>}
          <button className="btn" onClick={onClose}>Đóng</button>
        </header>
        <div className="viewer-body">
          <div className="doc-pane">
            <div className="doc" ref={docRef} onClick={onDocClick} />
            {sub && sub.images.length > 0 && !sub.html.includes('<img') && (
              <div className="imgs">{sub.images.map((u, i) => <img key={i} src={u} alt="" />)}</div>
            )}
          </div>
          <aside className="grade-pane">
            {r.flags.length > 0 && <ul className="note warn small">{r.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>}
            {r.reviewNote && <p className="note small">Rà soát: {r.reviewNote}</p>}
            {p.rubric.map((c, ci) => {
              const s = r.scores.find((x) => x.criterionId === c.id)!;
              const errs = r.errors.map((e, i) => ({ e, i })).filter(({ e }) => e.criterionId === c.id);
              const ed = s && isEdited(s);
              return (
                <div key={c.id} className={`crit ${s && effective(s) < c.max ? 'lost' : 'full'}`}>
                  <div className="crit-head">
                    <div><b>TC{ci + 1}. {c.name}</b><div className="muted small">Tối đa {fmt(c.max)}đ</div></div>
                    <div className="crit-score">
                      <span className="muted small">Máy chấm: {fmt(s?.ai)}</span>
                      <input type="number" className={ed ? 'edited' : ''} min={0} max={c.max} step={p.scoreStep} disabled={locked}
                        value={s?.teacher ?? s?.ai ?? ''} onChange={(e) => setScore(c.id, e.target.value)} />
                      {ed && !locked && <button className="link small" onClick={() => setScore(c.id, '')}>về điểm ban đầu</button>}
                    </div>
                  </div>
                  {s?.reason && <p className="small">{s.reason}{s.confidence && <span className="muted"> · độ chắc chắn: {s.confidence}</span>}</p>}
                  {errs.map(({ e, i }) => (
                    <div key={i} id={`err-${i}`} className={`err-item ${active === i ? 'active' : ''}`} onClick={() => focusError(i)}>
                      {e.quote ? <q className={located.has(i) ? '' : 'nf'}>{e.quote}</q> : <span className="muted small">(lỗi không gắn với một đoạn cụ thể)</span>}
                      <div className="small">{e.note}</div>
                      {e.quote && !located.has(i) && <div className="small warn-text">Không tìm thấy đoạn này trong bài — có thể trích sai.</div>}
                      {!locked && <button className="link small danger" onClick={(ev) => { ev.stopPropagation(); removeError(i); }}>Bỏ lỗi này</button>}
                    </div>
                  ))}
                </div>
              );
            })}
            {orphan.length > 0 && <div className="crit">{orphan.map(({ e, i }) => <div key={i} className="err-item" onClick={() => focusError(i)}>{e.quote && <q>{e.quote}</q>}<div className="small">{e.note}</div></div>)}</div>}
            <label className="small">Nhận xét
              <textarea rows={3} disabled={locked} value={r.comment} onChange={(e) => setRes({ comment: e.target.value })} />
            </label>
            {!locked && (
              <details className="regrade">
                <summary>Chấm lại bài này</summary>
                <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Bài này HS chèn ảnh đúng nhưng ảnh nằm trong bảng, đừng trừ điểm tiêu chí chèn ảnh." />
                <button className="btn" disabled={running} onClick={() => confirm('Chấm lại sẽ thay điểm hiện tại của bài này. Tiếp tục?') && run([st], note)}>{running ? 'Đang chấm…' : 'Chấm lại'}</button>
              </details>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
