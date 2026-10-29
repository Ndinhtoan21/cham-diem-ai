import type { ClassBook, Project } from '../types';
import type { Textbook } from './textbook';

// Tiny IndexedDB key-value store. Everything stays in this browser on this computer.
const DB = 'cham-diem-ai';
const STORE = 'projects';

const CLASSES = 'classes';
const BOOKS = 'textbooks';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(CLASSES)) db.createObjectStore(CLASSES);
      if (!db.objectStoreNames.contains(BOOKS)) db.createObjectStore(BOOKS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, store = STORE): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const saveProject = (p: Project) => tx('readwrite', (s) => s.put(p, p.id));
export const loadProject = (id: string) => tx<Project | undefined>('readonly', (s) => s.get(id));
export const deleteProject = (id: string) => tx('readwrite', (s) => s.delete(id));
export async function listProjects(): Promise<Project[]> {
  const all = await tx<Project[]>('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

// ---- Sổ điểm lớp ----
export const saveClass = (c: ClassBook) => tx('readwrite', (s) => s.put({ ...c, updatedAt: Date.now() }, c.id), CLASSES);
export const deleteClass = (id: string) => tx('readwrite', (s) => s.delete(id), CLASSES);
export async function listClasses(): Promise<ClassBook[]> {
  const all = await tx<ClassBook[]>('readonly', (s) => s.getAll(), CLASSES);
  return all.sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true }));
}

// ---- SGK theo khối ----
export const saveTextbook = (b: Textbook) => tx('readwrite', (s) => s.put(b, b.id), BOOKS);
export const deleteTextbook = (id: string) => tx('readwrite', (s) => s.delete(id), BOOKS);
export const listTextbooks = () => tx<Textbook[]>('readonly', (s) => s.getAll(), BOOKS);

/** Full backup of everything in this browser (projects + class books). */
export async function exportBackup(): Promise<Blob> {
  const projects = await tx<Project[]>('readonly', (s) => s.getAll());
  const classes = await tx<ClassBook[]>('readonly', (s) => s.getAll(), CLASSES);
  const textbooks = await listTextbooks();
  return new Blob([JSON.stringify({ app: 'cham-diem-ai', version: 3, savedAt: new Date().toISOString(), projects, classes, textbooks })], { type: 'application/json' });
}
export async function importBackup(file: File): Promise<{ projects: number; classes: number }> {
  const data = JSON.parse(await file.text());
  if (data.app !== 'cham-diem-ai') throw new Error('Không phải file sao lưu của Chấm Điểm.');
  for (const p of data.projects || []) await tx('readwrite', (s) => s.put(p, p.id));
  for (const c of data.classes || []) await tx('readwrite', (s) => s.put(c, c.id), CLASSES);
  for (const b of data.textbooks || []) await saveTextbook(b);
  return { projects: (data.projects || []).length, classes: (data.classes || []).length };
}

export function getSetting(key: string): string {
  try {
    return localStorage.getItem('cd:' + key) || '';
  } catch {
    return '';
  }
}
export function setSetting(key: string, val: string) {
  try {
    localStorage.setItem('cd:' + key, val);
  } catch {
    /* ignore */
  }
}
