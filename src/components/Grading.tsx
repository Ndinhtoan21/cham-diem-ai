import { useEffect, useRef, useState } from 'react';
import type { Updater as U } from '../App';
import type { Project, Result, Student, Submission } from '../types';
import { buildSubmission } from '../lib/extract';
import type { Updater } from '../App';
import { classChecks, gradeOne, maxTotal, totalOf } from '../lib/grading';
import { fmt, pool } from '../lib/util';
import { getSetting, setSetting } from '../lib/store';

const STATUS: Record<string, string> = { idle: 'Chưa chấm', grading: 'Đang chấm…', reviewing: 'Đang tự rà soát…', done: 'Xong', error: 'Lỗi' };

export function useGrader(p: Project, update: Updater) {
  const [running, setRunning] = useState(false);
  const stop = useRef(false);
  const setResult = (id: string, r: Partial<Result>) =>
    update((x) => ({ results: { ...x.results, [id]: { ...(x.results[id] || { scores: [], errors: [], comment: '', flags: [], checked: false, status: 'idle' }), ...r } as Result } }));

  const spentRef = useRef(0);
  const [budgetHit, setBudgetHit] = useState('');

  async function run(list: Student[], extraNote?: string, opts: { project?: Project; flag?: string; mark?: Partial<Result> } = {}) {
    const proj = opts.project || p;
    if (!list.length) return;
    stop.current = false;
    setBudgetHit('');
    spentRef.current = p.spent?.cost || 0;
    const budget = p.budget ?? (Number(getSetting('budget')) || 10);
    setRunning(true);
    await pool(list, 3, async (s) => {
      if (spentRef.current >= budget) {
        stop.current = true;
        setBudgetHit(`Đã chạm hạn mức chi phí $${budget} — dừng chấm. Tăng hạn mức nếu muốn chấm tiếp.`);
        return;
      }
      try {
        const r = await gradeOne(proj, s, (phase) => setResult(s.id, { status: phase }), extraNote);
        setResult(s.id, { ...r, ...(opts.mark || {}), flags: opts.flag ? [opts.flag, ...r.flags] : r.flags });
        if (r.usage) {
          spentRef.current += r.usage.cost;
          const u = r.usage;
          update((x) => ({ spent: { input: (x.spent?.input || 0) + u.input, output: (x.spent?.output || 0) + u.output, cost: (x.spent?.cost || 0) + u.cost, calls: (x.spent?.calls || 0) + 1 } }));
        }
      } catch (e: any) {
        setResult(s.id, { status: 'error', errorMsg: e.message });
        if (e.status === 401) stop.current = true;
      }
    }, () => stop.current);
    setRunning(false);
  }
  return { running, run, stop: () => (stop.current = true), budgetHit };
}

/**
 * Nộp bài bổ sung cho một học sinh (nộp muộn / làm thêm): đọc file mới, thay hoặc gộp với bài cũ,
 * rồi chấm lại riêng em đó. Nếu điểm đã chốt thì mở khoá để thầy/cô duyệt và chốt lại.
 */
export function useSupplement(p: Project, update: Updater) {
  const { run, running } = useGrader(p, update);
  const [busy, setBusy] = useState('');
  async function submit(st: Student, files: File[], mode: 'replace' | 'merge') {
    if (!files.length) return;
    setBusy(st.id);
    try {
      const fresh = await buildSubmission(files);
      const old = p.submissions[st.id];
      const sub = mode === 'merge' && old ? mergeSubmissions(old, fresh) : fresh;
      const names = files.map((f) => f.name);
      const fileMap = { ...p.fileMap, [st.id]: mode === 'merge' ? [...(p.fileMap[st.id] || []), ...names] : names };
      const wasFinal = p.finalized;
      update((x) => ({ submissions: { ...x.submissions, [st.id]: sub }, fileMap: { ...x.fileMap, [st.id]: fileMap[st.id] }, ...(wasFinal ? { finalized: false, finalizedAt: undefined } : {}) }));
      const p2: Project = { ...p, submissions: { ...p.submissions, [st.id]: sub }, fileMap };
      const when = new Date().toLocaleString('vi-VN');
      await run([st], undefined, {
        project: p2,
        mark: { supplementedAt: Date.now(), checked: false, noSubmission: false },
        flag: `Bài nộp bổ sung lúc ${when} (${!old || p.results[st.id]?.noSubmission ? 'nộp mới' : mode === 'merge' ? 'gộp với bài cũ' : 'thay bài cũ'}: ${names.join(', ')}).${wasFinal ? ' Điểm lớp đã được mở khoá — duyệt bài này rồi chốt lại để cập nhật sổ điểm.' : ''}`,
      });
    } finally { setBusy(''); }
  }
  return { submit, busy, running };
}

function mergeSubmissions(a: Submission, b: Submission): Submission {
  return {
    fileNames: [...a.fileNames, ...b.fileNames],
    kinds: [...a.kinds, ...b.kinds],
    text: [a.text, b.text].filter(Boolean).join('\n\n##### BÀI NỘP BỔ SUNG #####\n'),
    analysis: [a.analysis, b.analysis].filter(Boolean).join('\n\n'),
    html: a.html + '<div class="file-head">Bài nộp bổ sung</div>' + b.html,
    images: [...a.images, ...b.images].slice(-6),
    warnings: [...a.warnings, ...b.warnings],
  };
}

/** Nút "Nộp bổ sung" dùng ở bảng duyệt điểm và màn hình xem bài. */
export function SupplementButton({ p, update, student, label = 'Nộp bổ sung', className = 'link small' }: { p: Project; update: Updater; student: Student; label?: string; className?: string }) {
  const { submit, busy, running } = useSupplement(p, update);
  const [files, setFiles] = useState<File[] | null>(null);
  const hasOld = !!p.submissions[student.id] && !p.results[student.id]?.noSubmission;
  const inp = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className={className} disabled={!!busy || running} title="Thêm hoặc thay file bài làm của học sinh này rồi chấm lại riêng bài này" onClick={(e) => { e.stopPropagation(); inp.current?.click(); }}>
        {busy === student.id || running ? 'Đang chấm bổ sung…' : label}
      </button>
      <input ref={inp} hidden type="file" multiple onChange={(e) => {
        const fs = Array.from(e.target.files || []);
        e.target.value = '';
        if (!fs.length) return;
        if (hasOld) setFiles(fs); else submit(student, fs, 'replace');
      }} />
      {files && (
        <div className="modal-bg" onClick={() => setFiles(null)}>
          <div className="card modal-sm" onClick={(e) => e.stopPropagation()}>
            <h2>Nộp bổ sung — {student.name}</h2>
            <p className="small">File mới: {files.map((f) => f.name).join(', ')}</p>
            <p className="small muted">Bài cũ: {p.submissions[student.id]?.fileNames.join(', ')}</p>
            <div className="row end">
              <button className="btn" onClick={() => setFiles(null)}>Hủy</button>
              <button className="btn" onClick={() => { const f = files; setFiles(null); submit(student, f, 'merge'); }} title="Bài mới là phần làm thêm — chấm cả bài cũ và bài mới">Gộp với bài cũ</button>
              <button className="btn primary" onClick={() => { const f = files; setFiles(null); submit(student, f, 'replace'); }} title="Bài mới là bản hoàn chỉnh — bỏ bài cũ">Thay bài cũ</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function Grading({ p, update }: { p: Project; update: Updater }) {
  const { running, run, stop, budgetHit } = useGrader(p, update);
  const started = useRef(false);

  const pending = p.students.filter((s) => !p.results[s.id] || ['idle', 'error'].includes(p.results[s.id].status));
  const errors = p.students.filter((s) => p.results[s.id]?.status === 'error');
  const done = p.students.filter((s) => p.results[s.id]?.status === 'done');

  useEffect(() => {
    if (started.current) return;
    const mode = getSetting('autostart');
    if (!mode) return;
    started.current = true;
    setSetting('autostart', '');
    run(mode === 'trial' ? pending.slice(0, 2) : pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = p.students.length ? Math.round((done.length / p.students.length) * 100) : 0;
  const checks = !running && done.length ? classChecks(p) : [];
  const flagged = done.filter((s) => p.results[s.id].flags.length).length;
  const max = maxTotal(p.rubric);

  return (
    <div className="grading">
      <section className="card">
        <div className="row between">
          <h2>Chấm bài — {done.length}/{p.students.length}</h2>
          <div className="row">
            {running ? <button className="btn" onClick={stop}>Dừng</button> : <>
              {pending.length > 0 && <button className="btn primary" onClick={() => run(pending)}>Chấm {pending.length} bài chưa chấm</button>}
              {pending.length > 2 && <button className="btn" onClick={() => run(pending.slice(0, 2))}>Chấm thử 2 bài</button>}
              {errors.length > 0 && <button className="btn" onClick={() => run(errors)}>Chấm lại {errors.length} bài lỗi</button>}
              {done.length > 0 && <button className="btn" onClick={() => confirm('Chấm lại tất cả? Điểm bạn đã sửa sẽ bị xóa.') && run(p.students)}>Chấm lại tất cả</button>}
            </>}
          </div>
        </div>
        <div className="progress"><div style={{ width: pct + '%' }} /></div>
        <CostBar p={p} update={update} pending={pending.length} />
        {budgetHit && <p className="danger-text">{budgetHit}</p>}
        <p className="muted small">Mỗi bài được chấm 2 lượt: chấm theo tiêu chí, rồi tự rà soát lại; sau đó hệ thống kiểm tra tự động (điểm vượt tối đa, trích dẫn lỗi có thật trong bài không, trừ điểm có lý do không…).</p>
      </section>

      {!running && done.length > 0 && (
        <section className={`card ${checks.length || flagged ? 'warnbox' : 'okbox'}`}>
          <h2>Kết quả tự rà soát</h2>
          <p>Đã chấm {done.length} bài · {flagged} bài có cảnh báo cần xem kĩ · điểm trung bình {fmt(done.reduce((a, s) => a + totalOf(p.results[s.id]), 0) / done.length)}/{fmt(max)}</p>
          {checks.map((c) => <div key={c.title}><b>{c.title}</b><ul>{c.items.map((i) => <li key={i}>{i}</li>)}</ul></div>)}
          <button className="btn primary" onClick={() => update({ step: 3 })}>Sang duyệt điểm →</button>
        </section>
      )}

      <section className="card">
        <table className="tbl">
          <thead><tr><th>STT</th><th>Họ và tên</th><th>Trạng thái</th><th>Tổng</th><th>Cảnh báo</th></tr></thead>
          <tbody>
            {p.students.map((s) => {
              const r = p.results[s.id];
              const st = r?.status || 'idle';
              return (
                <tr key={s.id}>
                  <td>{s.stt}</td><td>{s.name}{(r?.noSubmission || st === 'error') && <> <SupplementButton p={p} update={update} student={s} label={r?.noSubmission ? '+ Nộp bài' : '+ Nộp lại file'} /></>}</td>
                  <td><span className={`chip st-${st}`}>{STATUS[st]}</span>{r?.errorMsg && <div className="small danger-text">{r.errorMsg}</div>}</td>
                  <td>{st === 'done' ? fmt(totalOf(r)) : ''}</td>
                  <td className="small">{r?.flags.length ? `⚠ ${r.flags.length}` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

/** Chi phí AI đã dùng, ước tính phần còn lại và hạn mức (ràng buộc chi phí). */
function CostBar({ p, update, pending }: { p: Project; update: U; pending: number }) {
  const s = p.spent;
  const budget = p.budget ?? (Number(getSetting('budget')) || 10);
  const per = s && s.calls ? s.cost / s.calls : 0;
  return (
    <div className="costbar small">
      <span>Chi phí: <b>{usd(s?.cost || 0)}</b>{s?.calls ? ` cho ${s.calls} bài (TB ${usd(per)}/bài, ${Math.round(s.input / s.calls / 1000)}k token vào · ${Math.round(s.output / s.calls / 1000)}k token ra)` : ''}</span>
      {per > 0 && pending > 0 && <span className="muted">Ước tính {pending} bài còn lại: ~{usd(per * pending)}</span>}
      <label className="inline small">Hạn mức cho bài chấm này ($)
        <input type="number" min={0} step={1} style={{ width: 80 }} value={budget}
          onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0); update({ budget: v }); setSetting('budget', String(v)); }} />
      </label>
    </div>
  );
}
