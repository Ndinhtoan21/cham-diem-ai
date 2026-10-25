import { normKey, normWords } from './util';
import type { Student } from '../types';

export type MatchReport = {
  map: Record<string, string[]>; // studentId -> file paths
  unmatched: string[];
  fuzzy: Record<string, string>; // path -> note (needs confirmation)
  ambiguous: Record<string, string[]>; // path -> candidate student names
};

const pathOf = (f: File) => (f as any).webkitRelativePath || f.name;

/**
 * Ghép file với học sinh theo tên (bỏ dấu, bỏ khoảng trắng) hoặc mã HS xuất hiện trong đường dẫn.
 * Folder con mang tên HS cũng được (tất cả file trong đó thuộc về HS đó).
 */
export function matchFiles(students: Student[], files: File[]): MatchReport {
  const map: Record<string, string[]> = {};
  const unmatched: string[] = [];
  const fuzzy: Record<string, string> = {};
  const ambiguous: Record<string, string[]> = {};
  const keys = students.map((s) => ({ s, full: normKey(s.name), code: s.code ? normKey(s.code) : '', words: normWords(s.name) }));
  const dupNames = new Set(keys.filter((k, i) => keys.findIndex((o) => o.full === k.full) !== i).map((k) => k.full));

  for (const f of files) {
    const p = pathOf(f);
    // drop the top folder name (the folder the teacher picked) so a class folder like "6A1" doesn't interfere
    const parts = p.split('/');
    const rel = parts.length > 1 ? parts.slice(1).join('/') : p;
    const nk = normKey(rel.replace(/\.[^.]+$/, ''));
    let hits = keys.filter((k) => (k.code && k.code.length >= 3 && nk.includes(k.code)) );
    if (!hits.length) hits = keys.filter((k) => k.full && nk.includes(k.full));
    if (hits.length > 1) {
      const longest = Math.max(...hits.map((h) => h.full.length));
      hits = hits.filter((h) => h.full.length === longest);
    }
    if (hits.length === 1 && !dupNames.has(hits[0].full)) {
      (map[hits[0].s.id] ||= []).push(p);
      continue;
    }
    if (hits.length >= 1) {
      ambiguous[p] = hits.map((h) => h.s.name);
      unmatched.push(p);
      continue;
    }
    // fuzzy: given name + middle name (last two words), or reversed order like "An Nguyen Van"
    const fileWords = new Set(normWords(rel.replace(/\.[^.]+$/, '')));
    const fz = keys.filter((k) => k.words.length >= 2 && k.words.every((w) => fileWords.has(w)));
    const fz2 = fz.length ? fz : keys.filter((k) => k.words.length >= 2 && nk.includes(k.words.slice(-2).join('')));
    if (fz2.length === 1) {
      (map[fz2[0].s.id] ||= []).push(p);
      fuzzy[p] = `ghép gần đúng với "${fz2[0].s.name}"`;
    } else {
      if (fz2.length > 1) ambiguous[p] = fz2.map((h) => h.s.name);
      unmatched.push(p);
    }
  }
  return { map, unmatched, fuzzy, ambiguous };
}
