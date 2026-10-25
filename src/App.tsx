import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from './types';
import { deleteProject, listProjects, saveProject, getSetting, setSetting } from './lib/store';
import { uid } from './lib/util';
import { api } from './lib/api';
import Setup from './components/Setup';
import Confirm from './components/Confirm';
import Grading from './components/Grading';
import Review from './components/Review';
import ExportPanel from './components/ExportPanel';
import ClassBooks from './components/ClassBooks';
import SystemExport from './components/SystemExport';
import Compare from './components/Compare';
import { exportBackup, importBackup } from './lib/store';
import { download } from './lib/util';

export type View = 'projects' | 'classes' | 'systems' | 'compare';
const VIEWS: [View, string][] = [['projects', 'Chấm bài'], ['classes', 'Sổ điểm lớp & điểm TX'], ['systems', 'Xuất FSP / CSDL'], ['compare', 'Đối chiếu FSP ↔ CSDL']];

const STEPS = ['Nhập liệu', 'Xác nhận', 'Chấm bài', 'Duyệt điểm', 'Xuất file'];

export function newProject(): Project {
  const now = Date.now();
  return {
    id: uid(), name: 'Bài kiểm tra mới', className: '', school: getSetting('school') || 'TH, THCS FPT Đà Nẵng', teacher: getSetting('teacher'),
    examText: '', examFileName: '', examImages: [], rubric: [], instructions: '', scoreStep: 0.25, noSubmissionZero: true,
    students: [], rosterFileName: '', fileMap: {}, unmatchedFiles: [], submissions: {}, results: {},
    finalized: false, step: 0, createdAt: now, updatedAt: now,
    term: (getSetting('term') as any) || 'HK1', column: 'GK',
  };
}

export type Updater = (patch: Partial<Project> | ((p: Project) => Partial<Project>)) => void;

export default function App() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [p, setP] = useState<Project | null>(null);
  const [files, setFiles] = useState<File[]>([]); // student files picked this session (not persisted)
  const [view, setView] = useState<View>('projects');
  const [server, setServer] = useState<{ provider?: string; model?: string; error?: string; needPassword?: boolean }>({});
  const saveTimer = useRef<number>();

  const ping = useCallback(async () => {
    try {
      const r = await api('ping', {});
      setServer({ provider: r.provider, model: r.model });
    } catch (e: any) {
      setServer(e.status === 401 ? { needPassword: true } : { error: e.message });
    }
  }, []);

  useEffect(() => {
    listProjects().then(setProjects);
    ping();
  }, [ping]);

  const update: Updater = useCallback((patch) => {
    setP((prev) => {
      if (!prev) return prev;
      const delta = typeof patch === 'function' ? patch(prev) : patch;
      return { ...prev, ...delta, updatedAt: Date.now() };
    });
  }, []);

  useEffect(() => {
    if (!p) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveProject(p).catch((e) => console.error('save failed', e)), 800);
  }, [p]);

  const openProject = (x: Project) => { setFiles([]); setP(x); };
  const backHome = async () => {
    if (p) await saveProject(p);
    setP(null);
    setProjects(await listProjects());
  };
  const go = async (v: View) => { if (p) await backHome(); setView(v); };

  if (server.needPassword) return <PasswordGate onDone={ping} />;

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={backHome} title="Danh sách bài chấm">
          <span className="logo">✓</span> Chấm Điểm AI
        </button>
        {p ? <span className="crumb">{p.name}{p.className ? ` · ${p.className}` : ''}</span> : (
          <nav className="views">{VIEWS.map(([v, l]) => <button key={v} className={`view ${view === v ? 'on' : ''}`} onClick={() => go(v)}>{l}</button>)}</nav>
        )}
        <span className="spacer" />
        <span className={`badge ${server.error ? 'bad' : server.provider === 'mock' ? 'warn' : ''}`} title={server.error || ''}>
          {server.error ? 'Không kết nối được máy chủ' : server.provider === 'mock' ? 'Chế độ mô phỏng (không gọi AI)' : server.provider === 'none' ? 'Chưa cấu hình API key' : server.provider ? `AI: ${server.model}` : '…'}
        </span>
      </header>

      {!p && view === 'classes' ? <ClassBooks /> : !p && view === 'systems' ? <SystemExport /> : !p && view === 'compare' ? <Compare /> : !p ? (
        <Home projects={projects} onOpen={openProject} onNew={() => openProject(newProject())}
          onDelete={async (id) => { await deleteProject(id); setProjects(await listProjects()); }}
          onRestored={async () => setProjects(await listProjects())} />
      ) : (
        <>
          <nav className="steps">
            {STEPS.map((s, i) => (
              <button key={s} className={`step ${p.step === i ? 'on' : ''} ${i < p.step ? 'past' : ''}`} onClick={() => update({ step: i })}>
                <span className="num">{i + 1}</span>{s}
              </button>
            ))}
          </nav>
          <main className="main">
            {p.step === 0 && <Setup p={p} update={update} files={files} setFiles={setFiles} />}
            {p.step === 1 && <Confirm p={p} update={update} files={files} />}
            {p.step === 2 && <Grading p={p} update={update} />}
            {p.step === 3 && <Review p={p} update={update} />}
            {p.step === 4 && <ExportPanel p={p} update={update} goSystems={() => go('systems')} />}
          </main>
        </>
      )}
    </div>
  );
}

function Home({ projects, onOpen, onNew, onDelete, onRestored }: { projects: Project[] | null; onOpen: (p: Project) => void; onNew: () => void; onDelete: (id: string) => void; onRestored: () => void }) {
  return (
    <main className="main home">
      <div className="home-head">
        <div>
          <h1>Các bài chấm</h1>
          <p className="muted">Mỗi bài chấm là một đề + một lớp. Dữ liệu chỉ lưu trong trình duyệt trên máy này.</p>
        </div>
        <div className="row">
          <button className="btn" title="Lưu toàn bộ bài chấm và sổ điểm ra một file để chép sang máy khác" onClick={async () => download(await exportBackup(), `Sao luu Cham Diem AI ${new Date().toISOString().slice(0, 10)}.json`)}>Sao lưu</button>
          <label className="btn" title="Khôi phục từ file sao lưu">Khôi phục<input hidden type="file" accept=".json" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try { const r = await importBackup(f); alert(`Đã khôi phục ${r.projects} bài chấm và ${r.classes} sổ điểm lớp.`); onRestored(); } catch (x: any) { alert(x.message); }
          }} /></label>
          <button className="btn primary" onClick={onNew}>+ Tạo bài chấm mới</button>
        </div>
      </div>
      {projects === null ? <p className="muted">Đang tải…</p> : projects.length === 0 ? (
        <div className="empty">Chưa có bài chấm nào. Bấm “Tạo bài chấm mới” để bắt đầu.</div>
      ) : (
        <div className="cards">
          {projects.map((x) => {
            const done = Object.values(x.results).filter((r) => r.status === 'done').length;
            const checked = Object.values(x.results).filter((r) => r.checked).length;
            return (
              <div key={x.id} className="card proj" onClick={() => onOpen(x)}>
                <div className="proj-title">{x.name}</div>
                <div className="muted small">{x.className || 'Chưa có lớp'} · {x.students.length} HS · {new Date(x.updatedAt).toLocaleString('vi-VN')}</div>
                <div className="proj-stats">
                  <span>Đã chấm {done}/{x.students.length}</span><span>Đã duyệt {checked}</span>
                  {x.finalized && <span className="chip ok">Đã chốt</span>}
                  {x.postedAt && <span className="chip ok">Đã vào sổ {x.term} {x.column}</span>}
                </div>
                <button className="link danger" onClick={(e) => { e.stopPropagation(); if (confirm(`Xóa "${x.name}"?`)) onDelete(x.id); }}>Xóa</button>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function PasswordGate({ onDone }: { onDone: () => void }) {
  const [v, setV] = useState('');
  return (
    <div className="gate">
      <form className="card" onSubmit={(e) => { e.preventDefault(); setSetting('password', v); onDone(); }}>
        <h2>Chấm Điểm AI</h2>
        <p className="muted">Nhập mật khẩu ứng dụng (APP_PASSWORD đã đặt trên Vercel).</p>
        <input type="password" autoFocus value={v} onChange={(e) => setV(e.target.value)} />
        <button className="btn primary">Vào</button>
      </form>
    </div>
  );
}
