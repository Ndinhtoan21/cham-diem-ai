import { useEffect, useMemo, useState } from 'react';
import type { Project, Result, Score } from '../types';
import type { Updater } from '../App';
import { effective, isEdited, maxTotal, totalOf } from '../lib/grading';
import { fmt } from '../lib/util';
import { finalScore, findClassFor, postToBook } from '../lib/gradebook';
import { listClasses, saveClass } from '../lib/store';
import { TERM_LABEL, type ClassBook } from '../types';
import Viewer from './Viewer';

type Filter = 'all' | 'unchecked' | 'flagged' | 'edited';

export default function Review({ p, update }: { p: Project; update: Updater }) {
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [confirming, setConfirming] = useState(false);
  const [post, setPost] = useState(true);
  const [postMsg, setPostMsg] = useState<string[]>([]);
  const [classes, setClasses] = useState<ClassBook[]>([]);
  useEffect(() => { listClasses().then(setClasses); }, [confirming]);
  const target = classes.find((c) => c.id === p.classId) || findClassFor(p.className, classes);
  const term = p.term || 'HK1';
  const column = p.column || 'GK';

  async function finalize() {
    const msgs: string[] = [];
    let patch: Partial<typeof p> = { finalized: true, finalizedAt: Date.now() };
    if (post) {
      const r = postToBook(p, target, term, column);
      await saveClass(r.book);
      patch = { ...patch, classId: r.book.id, postedAt: Date.now() };
      msgs.push(`Đã ghi ${r.written} điểm vào cột ${column} – ${TERM_LABEL[term]} của sổ điểm lớp ${r.book.name}${r.created ? ' (sổ mới tạo)' : ''}.`);
      if (r.overwritten.length) msgs.push(`Thay ${r.overwritten.length} điểm cũ: ${r.overwritten.slice(0, 5).join('; ')}${r.overwritten.length > 5 ? '…' : ''}`);
      if (r.unmatched.length) msgs.push(`Không tìm thấy trong sổ điểm (chưa ghi): ${r.unmatched.join(', ')}.`);
      if (r.notInProject.length) msgs.push(`HS trong sổ nhưng không có trong bài chấm này: ${r.notInProject.join(', ')}.`);
    }
    update(patch);
    setPostMsg(msgs);
    setConfirming(false);
  }

  const graded = p.students.filter((s) => p.results[s.id]?.status === 'done');
  const checked = graded.filter((s) => p.results[s.id].checked);
  const edited = graded.filter((s) => p.results[s.id].scores.some(isEdited));
  const ungraded = p.students.length - graded.length;
  const allChecked = graded.length === p.students.length && checked.length === graded.length;

  const rows = useMemo(() => p.students.filter((s) => {
    const r = p.results[s.id];
    if (filter === 'unchecked') return r?.status === 'done' && !r.checked;
    if (filter === 'flagged') return r?.flags.length;
    if (filter === 'edited') return r?.scores.some(isEdited);
    return true;
  }), [p.students, p.results, filter]);

  const setResult = (id: string, patch: Partial<Result>) => update((x) => ({ results: { ...x.results, [id]: { ...x.results[id], ...patch } } }));
  const toggle = (id: string) => !p.finalized && setResult(id, { checked: !p.results[id].checked });
  const checkAllNoFlags = () => update((x) => {
    const res = { ...x.results };
    x.students.forEach((s) => { const r = res[s.id]; if (r?.status === 'done' && !r.flags.length) res[s.id] = { ...r, checked: true }; });
    return { results: res };
  });

  const idx = open ? p.students.findIndex((s) => s.id === open) : -1;
  const max = maxTotal(p.rubric);

  return (
    <div className="review">
      {p.finalized ? (
        <div className="banner ok">
          ✓ Đã chốt điểm lúc {new Date(p.finalizedAt!).toLocaleString('vi-VN')}. Điểm bị khóa.
          <button className="btn" onClick={() => confirm('Mở khóa để sửa điểm?') && update({ finalized: false, finalizedAt: undefined })}>Mở khóa</button>
          <button className="btn primary" onClick={() => update({ step: 4 })}>Xuất file →</button>
          {postMsg.length > 0 && <ul className="small" style={{ width: '100%', margin: '6px 0 0' }}>{postMsg.map((m, i) => <li key={i}>{m}</li>)}</ul>}
        </div>
      ) : (
        <div className="banner draft">
          <span><b>Bản nháp.</b> Bấm vào điểm của học sinh để xem bài và các lỗi được bôi đỏ, chấm lại nếu cần, rồi tích ô “Đã xem”.</span>
        </div>
      )}

      <section className="card">
        <div className="row between wrap">
          <div className="row wrap">
            {([['all', `Tất cả (${p.students.length})`], ['unchecked', `Chưa xem (${graded.length - checked.length})`], ['flagged', `Có cảnh báo (${graded.filter((s) => p.results[s.id].flags.length).length})`], ['edited', `Đã sửa (${edited.length})`]] as [Filter, string][]).map(([k, l]) => (
              <button key={k} className={`tab ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          <div className="row">
            <span className="muted">Đã xem {checked.length}/{p.students.length}</span>
            {!p.finalized && <button className="btn" onClick={checkAllNoFlags} title="Chỉ tích các bài không có cảnh báo nào">Tích các bài không cảnh báo</button>}
            {!p.finalized && <button className="btn primary" disabled={!allChecked} title={allChecked ? '' : ungraded ? `Còn ${ungraded} HS chưa chấm` : 'Cần xem hết danh sách trước'} onClick={() => setConfirming(true)}>Chốt điểm</button>}
          </div>
        </div>
        <div className="legend small">
          <span><i className="sw ai" /> Điểm hệ thống chấm</span><span><i className="sw edited" /> Điểm bạn đã sửa</span><span><i className="sw flag" /> Có cảnh báo</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl scores">
            <thead>
              <tr>
                <th>STT</th><th className="left">Họ và tên</th>
                {p.rubric.map((c, i) => <th key={c.id} title={c.name}>TC{i + 1}<div className="muted small">{fmt(c.max)}đ</div></th>)}
                <th>Tổng<div className="muted small">{fmt(max)}đ</div></th>{max !== 10 && <th>Thang 10</th>}<th>Đã xem</th><th className="left">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const r = p.results[s.id];
                const done = r?.status === 'done';
                const anyEdited = r?.scores.some(isEdited);
                return (
                  <tr key={s.id} className={r?.checked ? 'row-checked' : ''}>
                    <td>{s.stt}</td>
                    <td className="left"><button className="link name" onClick={() => done && setOpen(s.id)}>{s.name}</button></td>
                    {p.rubric.map((c) => {
                      const sc = r?.scores.find((x) => x.criterionId === c.id);
                      return <ScoreCell key={c.id} sc={sc} max={c.max} onClick={() => done && setOpen(s.id)} />;
                    })}
                    <td className={`total ${anyEdited ? 'edited' : ''}`} onClick={() => done && setOpen(s.id)} title={done ? `Tổng điểm các tiêu chí: ${fmt(totalOf(r))}` : ''}>{done ? (max === 10 ? fmt(finalScore(p, r)) : fmt(totalOf(r))) : <span className="muted small">chưa chấm</span>}</td>
                    {max !== 10 && <td className="total">{done ? fmt(finalScore(p, r)) : ''}</td>}
                    <td><input type="checkbox" disabled={!done || p.finalized} checked={!!r?.checked} onChange={() => toggle(s.id)} /></td>
                    <td className="left small">{r?.flags.length ? <span className="flag" title={r.flags.join('\n')}>⚠ {r.flags[0].slice(0, 60)}{r.flags.length > 1 ? ` (+${r.flags.length - 1})` : ''}</span> : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {open && idx >= 0 && (
        <Viewer p={p} update={update} studentId={open} onClose={() => setOpen(null)}
          onNav={(d) => {
            const list = p.students.filter((s) => p.results[s.id]?.status === 'done');
            const i = list.findIndex((s) => s.id === open);
            const next = list[i + d];
            if (next) setOpen(next.id);
          }}
          onConfirmNext={() => {
            setResult(open, { checked: true });
            const after = p.students.slice(idx + 1).concat(p.students.slice(0, idx)).find((s) => p.results[s.id]?.status === 'done' && !p.results[s.id].checked && s.id !== open);
            setOpen(after ? after.id : null);
          }} />
      )}

      {confirming && (
        <div className="modal-bg" onClick={() => setConfirming(false)}>
          <div className="card modal-sm" onClick={(e) => e.stopPropagation()}>
            <h2>Chốt điểm?</h2>
            <p>{p.students.length} học sinh · {edited.length} bài bạn đã sửa điểm · điểm trung bình {fmt(Math.round(graded.reduce((a, s) => a + (finalScore(p, p.results[s.id]) || 0), 0) / Math.max(1, graded.length) * 10) / 10)}/10.</p>
            <label className="inline small"><input type="checkbox" checked={post} onChange={(e) => setPost(e.target.checked)} />
              Ghi điểm (thang 10, 1 chữ số thập phân) vào cột <b>{column}</b> – {TERM_LABEL[term]} của sổ điểm lớp <b>{target?.name || p.className || '(mới)'}</b>{!target && ' — sổ sẽ được tạo mới'}</label>
            <p className="muted small">Sau khi chốt, điểm bị khóa và file xuất ra không còn chữ “Bản nháp”. Bạn vẫn có thể mở khóa sau (chốt lại sẽ ghi đè điểm trong sổ).</p>
            <div className="row end">
              <button className="btn" onClick={() => setConfirming(false)}>Hủy</button>
              <button className="btn primary" onClick={finalize}>Chốt điểm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreCell({ sc, max, onClick }: { sc?: Score; max: number; onClick: () => void }) {
  if (!sc) return <td />;
  const ed = isEdited(sc);
  const v = effective(sc);
  return (
    <td className={`sc ${ed ? 'edited' : 'ai'} ${v < max ? 'lost' : ''}`} onClick={onClick} title={ed ? `Hệ thống chấm ${fmt(sc.ai)} · bạn sửa thành ${fmt(sc.teacher)}` : sc.reason}>
      {fmt(v)}{ed && <s className="ai-old">{fmt(sc.ai)}</s>}
    </td>
  );
}
