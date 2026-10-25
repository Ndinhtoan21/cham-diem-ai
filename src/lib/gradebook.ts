import type { ClassBook, Project, Result, ScoreCol, ScoreMap, Student, Term } from '../types';
import { COLS, TERMS } from '../types';
import { maxTotal, totalOf } from './grading';
import { matchPeople, parseScore, round1, classKeyOf } from './sheetMap';
import { normKey, uid } from './util';

export function emptyScores(): ClassBook['scores'] {
  const o = {} as ClassBook['scores'];
  TERMS.forEach((t) => {
    o[t] = {} as Record<ScoreCol, ScoreMap>;
    COLS.forEach((c) => (o[t][c] = {}));
  });
  return o;
}

export function newClassBook(name: string, students: Student[]): ClassBook {
  const now = Date.now();
  return { id: uid(), name: name.trim(), students: students.map((s, i) => ({ ...s, stt: s.stt || i + 1 })), scores: emptyScores(), createdAt: now, updatedAt: now };
}

/** Điểm cuối cùng của một bài: quy về thang 10, giữ 1 chữ số thập phân. */
export function finalScore(p: Project, r?: Result): number | null {
  if (!r || r.status !== 'done') return null;
  const max = maxTotal(p.rubric) || 10;
  return round1((totalOf(r) * 10) / max);
}

export const findClassFor = (name: string, classes: ClassBook[]) => {
  const key = classKeyOf(name) || normKey(name);
  return classes.find((c) => (classKeyOf(c.name) || normKey(c.name)) === key);
};

/**
 * Ghi điểm đã chốt của một bài chấm vào sổ điểm lớp (tạo sổ mới nếu chưa có).
 * Học sinh được ghép theo mã HS / họ tên.
 */
export function postToBook(p: Project, book: ClassBook | undefined, term: Term, col: ScoreCol) {
  const target: ClassBook = book ? structuredClone(book) : newClassBook(p.className || 'Lớp mới', p.students.map((s) => ({ ...s })));
  const m = matchPeople(p.students, target.students);
  let written = 0;
  const overwritten: string[] = [];
  for (const { row, person } of m.pairs) {
    const v = finalScore(p, p.results[row.id]);
    const old = target.scores[term][col][person.id];
    if (old != null && v != null && Math.abs(old - v) > 0.001) overwritten.push(`${person.name}: ${old} → ${v}`);
    target.scores[term][col][person.id] = v;
    if (v != null) written++;
  }
  return { book: target, written, unmatched: m.unmatchedRows.map((s) => s.name), notInProject: m.missing.map((s) => s.name), overwritten, created: !book };
}

// ---------- dán điểm từ Excel ----------
export type PasteLine = { line: number; raw: string; name: string; code: string; score: number | null; studentId?: string; problem?: string };

/**
 * Hiểu khối dán từ Excel. Chấp nhận:
 *  - một cột điểm (theo đúng thứ tự danh sách lớp), hoặc
 *  - nhiều cột trong đó có họ tên và/hoặc mã HS và một cột điểm (cột số cuối cùng).
 */
export function parsePastedScores(text: string, students: Student[]): { lines: PasteLine[]; mode: 'order' | 'name'; notes: string[] } {
  const notes: string[] = [];
  let rows = text.replace(/\r/g, '').split('\n').map((l) => l.split('\t'));
  while (rows.length && rows[rows.length - 1].every((c) => !c.trim())) rows.pop();
  // bỏ dòng tiêu đề
  const numeric = (c: string) => { const v = parseScore(c); return v != null && !Number.isNaN(v); };
  if (rows.length > 1 && rows[0].some((c) => /họ|tên|điểm|mã|stt|tx|gk|ck/i.test(c)) && !rows[0].some(numeric)) {
    notes.push(`Đã bỏ qua dòng tiêu đề: "${rows[0].join(' | ').slice(0, 80)}".`);
    rows = rows.slice(1);
  }
  const hasText = rows.some((r) => r.some((c) => /\p{L}{2,}/u.test(c)));
  if (!hasText) {
    // chỉ có số — theo thứ tự danh sách
    const vals = rows.map((r) => r.map((c) => c.trim()).filter((c) => c !== '').pop() ?? '');
    const lines: PasteLine[] = vals.map((v, i) => {
      const sc = parseScore(v);
      const st = students[i];
      return { line: i + 1, raw: v, name: st?.name || '', code: st?.code || '', score: sc != null && Number.isNaN(sc) ? null : sc, studentId: st?.id, problem: !st ? 'Thừa dòng — lớp không có học sinh thứ ' + (i + 1) : sc != null && Number.isNaN(sc) ? `"${v}" không phải số` : sc != null && (sc < 0 || sc > 10) ? 'Điểm ngoài thang 0–10' : undefined };
    });
    if (vals.length !== students.length) notes.push(`Số dòng dán (${vals.length}) khác sĩ số lớp (${students.length}) — kiểm tra lại thứ tự.`);
    return { lines, mode: 'order', notes };
  }
  // có chữ: tìm cột tên, cột mã, cột điểm
  const width = Math.max(...rows.map((r) => r.length));
  let nameCol = -1, best = 0;
  for (let c = 0; c < width; c++) {
    const n = rows.filter((r) => /\p{L}{2,}/u.test(r[c] || '') && (r[c] || '').trim().split(/\s+/).length >= 2).length;
    if (n > best) { best = n; nameCol = c; }
  }
  const codes = new Set(students.map((s) => normKey(s.code || '')).filter(Boolean));
  let codeCol = -1;
  for (let c = 0; c < width; c++) if (c !== nameCol && rows.filter((r) => codes.has(normKey(r[c] || ''))).length > rows.length / 2) { codeCol = c; break; }
  let scoreCol = -1;
  for (let c = width - 1; c >= 0; c--) {
    if (c === nameCol || c === codeCol) continue;
    const nums = rows.filter((r) => { const v = parseScore(r[c]); return v != null && !Number.isNaN(v) && v >= 0 && v <= 10; }).length;
    if (nums >= Math.max(1, rows.length * 0.4)) { scoreCol = c; break; }
  }
  if (scoreCol < 0) notes.push('Không tìm thấy cột điểm (cột có số từ 0 đến 10).');
  const items = rows.map((r, i) => ({ i, name: (nameCol >= 0 ? r[nameCol] : '').replace(/\s+/g, ' ').trim(), code: codeCol >= 0 ? (r[codeCol] || '').trim() : '', raw: scoreCol >= 0 ? (r[scoreCol] || '').trim() : '' }));
  const m = matchPeople(items, students);
  const byItem = new Map(m.pairs.map((p) => [p.row, p.person]));
  const lines: PasteLine[] = items.map((it) => {
    const st = byItem.get(it);
    const sc = parseScore(it.raw);
    let problem: string | undefined;
    if (!st) problem = 'Không có học sinh này trong danh sách lớp';
    else if (sc != null && Number.isNaN(sc)) problem = `"${it.raw}" không phải số`;
    else if (sc != null && (sc < 0 || sc > 10)) problem = 'Điểm ngoài thang 0–10';
    return { line: it.i + 1, raw: it.raw, name: it.name || st?.name || '', code: it.code, score: sc != null && Number.isNaN(sc) ? null : sc, studentId: st?.id, problem };
  });
  const dup = new Map<string, number>();
  lines.forEach((l) => l.studentId && dup.set(l.studentId, (dup.get(l.studentId) || 0) + 1));
  lines.forEach((l) => { if (l.studentId && dup.get(l.studentId)! > 1) l.problem = 'Học sinh xuất hiện nhiều lần trong khối dán'; });
  if (m.missing.length) notes.push(`${m.missing.length} học sinh trong lớp không có trong khối dán: ${m.missing.slice(0, 8).map((s) => s.name).join(', ')}${m.missing.length > 8 ? '…' : ''}.`);
  return { lines, mode: 'name', notes };
}
