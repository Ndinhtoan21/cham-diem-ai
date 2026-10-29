import { useEffect, useRef, useState } from 'react';
import type { Updater as U } from '../App';
import type { Project, Result, Student } from '../types';
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

  async function run(list: Student[], extraNote?: string) {
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
        const r = await gradeOne(p, s, (phase) => setResult(s.id, { status: phase }), extraNote);
        setResult(s.id, r);
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
                  <td>{s.stt}</td><td>{s.name}</td>
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
