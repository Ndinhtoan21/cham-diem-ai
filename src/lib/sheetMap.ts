import type { BookSheet } from './xlsxBook';
import { colLetter } from './xlsxBook';
import { normKey, normWords } from './util';
import type { ClassBook, ScoreCol, Student, Term } from '../types';
import { COLS } from '../types';

/** Which column holds what, on one sheet of a FSP / CSDL file. -1 = không có. */
export type Mapping = {
  headerRow: number;
  firstDataRow: number;
  lastDataRow: number;
  name: number; // "Họ và tên" (hoặc cột Họ đệm khi tách 2 cột)
  given: number; // cột "Tên" khi họ tên tách 2 cột
  code: number;
  dob: number;
  cols: Record<ScoreCol, number>;
};

export type SheetRow = { r: number; name: string; code: string; dob: string; values: Partial<Record<ScoreCol, string>> };

export type Layout = {
  sheet: BookSheet;
  mapping: Mapping;
  labels: string[]; // nhãn cột (gộp các dòng tiêu đề)
  term?: Term; // học kì đọc được trên trang (nếu có)
  className: string; // lớp đoán được
  termCols: Partial<Record<Term, Record<ScoreCol, number>>>; // khi một trang có cả HK1 và HK2
  notes: string[];
};

const words = (s: string) => normWords(s).join(' ');
const NAME_RE = /^(ho va ten|ho ten|hoten|hovaten|ten hoc sinh|ho va ten hoc sinh|ho ten hoc sinh|ho va ten hs|ho ten hs|hs)$/;
const isNameHead = (s: string) => NAME_RE.test(words(s)) || /^ho va ten/.test(words(s));
const isLastHead = (s: string) => /^(ho|ho dem|ho lot|ho va ten dem)$/.test(words(s));
const isGivenHead = (s: string) => /^ten$/.test(words(s));
const isCodeHead = (s: string) => /^(ma|ma hs|ma hoc sinh|ma dinh danh|ma dinh danh hoc sinh|ma so|ma so hs|ma so hoc sinh|mshs|id|ma hoc sinh bo gd|ma moet|ma csdl)$/.test(words(s)) || /^ma (hoc sinh|dinh danh|hs)/.test(words(s));
const isDobHead = (s: string) => /^ngay (thang nam )?sinh/.test(words(s));

/** Recognise which score column a header label is about. */
export function scoreColOf(label: string): ScoreCol | null {
  const w = normWords(label);
  const j = w.join('');
  if (/(^|[^a-z])(tx|ddgtx|dgtx|thuongxuyen|diemthuongxuyen|kttx|ktthuongxuyen|mieng|15p)[^a-z0-9]*1($|[^0-9])/.test(w.join(' ')) || /(ddgtx|dgtx|thuongxuyen|^tx|kttx)1(?!\d)/.test(j)) return 'TX1';
  if (/(^|[^a-z])(tx|ddgtx|dgtx|thuongxuyen|diemthuongxuyen|kttx|ktthuongxuyen)[^a-z0-9]*2($|[^0-9])/.test(w.join(' ')) || /(ddgtx|dgtx|thuongxuyen|^tx|kttx)2(?!\d)/.test(j)) return 'TX2';
  if (/(ddggk|dggk|diemgk|^gk|giuak[iy]|giuahock[iy]|ktgk|kiemtragiuak)/.test(j) || w.includes('gk')) return 'GK';
  if (/(ddgck|dgck|diemck|^ck|cuoik[iy]|cuoihock[iy]|ktck|kiemtracuoik)/.test(j) || w.includes('ck')) return 'CK';
  return null;
}
export function termOf(label: string): Term | null {
  const j = normWords(label).join('');
  if (/(hk1|hki(?!i)|hocky1|hocki1|hockyi(?!i)|hockii(?!i)|kyi(?!i)|ky1)/.test(j)) return 'HK1';
  if (/(hk2|hkii|hocky2|hocki2|hockyii|hockiii|kyii|ky2)/.test(j)) return 'HK2';
  return null;
}

/** "Lớp 6A1", sheet "6A1", "Lop_6a1" → "6A1" */
export function classKeyOf(s: string): string {
  const m = /(?:^|[^0-9a-z])(\d{1,2}\s*[a-z]{1,2}\s*\d{0,2})(?![a-z0-9])/i.exec(String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_.-]/g, ' '));
  return m ? m[1].replace(/\s+/g, '').toUpperCase() : '';
}

const looksLikeName = (s: string) => /\p{L}/u.test(s) && !/\d/.test(s) && s.trim().split(/\s+/).length >= 2 && s.length < 60;

export function detectLayout(sheet: BookSheet, fileName = ''): Layout {
  const notes: string[] = [];
  const maxScan = Math.min(sheet.rowCount, 40);
  const width = sheet.colCount;
  let headerRow = -1;
  const m: Mapping = { headerRow: -1, firstDataRow: -1, lastDataRow: -1, name: -1, given: -1, code: -1, dob: -1, cols: { TX1: -1, TX2: -1, GK: -1, CK: -1 } };
  for (let r = 0; r < maxScan && headerRow < 0; r++) {
    for (let c = 0; c < width; c++) {
      const v = sheet.get(r, c);
      if (!v) continue;
      if (isNameHead(v)) { m.name = c; headerRow = r; }
      else if (isLastHead(v)) { m.name = c; headerRow = r; }
    }
  }
  if (headerRow < 0) {
    // không có tiêu đề: chọn cột nhiều "họ tên" nhất
    let best = -1, bestN = 0;
    for (let c = 0; c < width; c++) {
      let n = 0;
      for (let r = 0; r < sheet.rowCount; r++) if (looksLikeName(sheet.get(r, c))) n++;
      if (n > bestN) { bestN = n; best = c; }
    }
    m.name = best;
    notes.push('Không thấy dòng tiêu đề "Họ và tên" — đã tự chọn cột trông giống họ tên nhất.');
  }
  // first data row = first row after header whose name cell looks like a name
  let first = -1;
  for (let r = Math.max(0, headerRow + 1); r < sheet.rowCount; r++) {
    if (m.name >= 0 && looksLikeName(sheet.get(r, m.name))) { first = r; break; }
    // họ đệm + tên tách 2 cột: "Nguyễn Văn" + "An"
    if (m.name >= 0 && /\p{L}/u.test(sheet.get(r, m.name)) && !/\d/.test(sheet.get(r, m.name)) && sheet.get(r, m.name + 1) && /^\p{L}+$/u.test(sheet.get(r, m.name + 1)) && r > headerRow) { first = r; break; }
  }
  m.headerRow = headerRow;
  m.firstDataRow = first;
  const headerEnd = first > 0 ? first - 1 : headerRow;
  const labelTop = headerRow >= 0 ? headerRow : Math.max(0, first - 1);
  // gom nhãn từ các dòng tiêu đề (tính cả ô gộp) — VD "ĐĐGtx" ở trên, "1" ở dưới → "ĐĐGtx 1"
  const labels: string[] = [];
  for (let c = 0; c < width; c++) {
    const parts: string[] = [];
    for (let r = labelTop; r <= headerEnd && r >= 0; r++) {
      const v = sheet.shown(r, c);
      if (v && parts[parts.length - 1] !== v) parts.push(v);
    }
    labels[c] = parts.join(' ');
  }
  // dòng phía trên tiêu đề có thể ghi học kì / lớp
  let topText = '';
  for (let r = 0; r < Math.max(0, labelTop); r++) for (let c = 0; c < width; c++) topText += ' ' + sheet.get(r, c);

  labels.forEach((l, c) => {
    if (!l) return;
    if (c === m.name) {
      if (isLastHead(sheet.get(headerRow, c)) || isLastHead(l)) {
        const nxt = labels.findIndex((x, j) => j > c && isGivenHead(x.split(' ').pop() || x));
        if (nxt >= 0) m.given = nxt;
      }
      return;
    }
    if (m.code < 0 && isCodeHead(l)) m.code = c;
    else if (m.dob < 0 && isDobHead(l)) m.dob = c;
    else if (m.given < 0 && isGivenHead(l) && c === m.name + 1 && !looksLikeName(sheet.get(first, m.name))) m.given = c;
  });
  // fallback: "Tên" right after a "Họ và tên" that contains only họ đệm in data rows
  if (m.given < 0 && first >= 0 && isGivenHead(labels[m.name + 1] || '')) m.given = m.name + 1;
  // "Họ và tên" gộp 2 ô, dữ liệu tách "Nguyễn Văn" | "An"
  if (m.given < 0 && first >= 0 && m.name >= 0) {
    const merged = sheet.merges.some((x) => x.r1 <= headerRow && headerRow <= x.r2 && x.c1 === m.name && x.c2 > m.name);
    let single = 0, total = 0;
    for (let r = first; r < Math.min(sheet.rowCount, first + 15); r++) {
      if (!sheet.get(r, m.name)) continue;
      total++;
      if (/^\p{L}+$/u.test(sheet.get(r, m.name + 1))) single++;
    }
    if ((merged || labels[m.name + 1] === labels[m.name]) && total && single / total > 0.7) m.given = m.name + 1;
  }

  // score columns, possibly per term
  const termCols: Layout['termCols'] = {};
  const plain: Record<ScoreCol, number> = { TX1: -1, TX2: -1, GK: -1, CK: -1 };
  labels.forEach((l, c) => {
    if (!l || c === m.name || c === m.code) return;
    const sc = scoreColOf(l);
    if (!sc) return;
    const t = termOf(l);
    if (t) {
      termCols[t] ||= { TX1: -1, TX2: -1, GK: -1, CK: -1 };
      if (termCols[t]![sc] < 0) termCols[t]![sc] = c;
    } else if (plain[sc] < 0) plain[sc] = c;
  });
  const term = termOf(topText) || termOf(sheet.name) || termOf(fileName) || undefined;
  m.cols = plain;
  if (Object.keys(termCols).length) {
    const t = term && termCols[term] ? term : (Object.keys(termCols)[0] as Term);
    COLS.forEach((k) => { if (termCols[t]![k] >= 0) m.cols[k] = termCols[t]![k]; });
  }

  // last data row
  let last = first;
  for (let r = Math.max(first, 0); r < sheet.rowCount; r++) {
    const v = m.name >= 0 ? sheet.get(r, m.name) : '';
    if (v && /\p{L}/u.test(v) && !/^(tong|tổng|cộng|si so|sĩ số|ghi chú|người lập|giáo viên|xác nhận|hiệu trưởng)/i.test(v)) last = r;
  }
  m.lastDataRow = first >= 0 ? last : -1;

  // class
  let className = classKeyOf(sheet.name);
  if (!className) {
    const mm = /l[oớ]p\s*[:\-]?\s*(\d{1,2}\s*[a-z]{1,2}\s*\d{0,2})/i.exec(topText);
    if (mm) className = mm[1].replace(/\s+/g, '').toUpperCase();
  }
  if (!className) className = classKeyOf(fileName);

  if (m.name < 0) notes.push('Không tìm thấy cột họ tên.');
  if (first < 0) notes.push('Không tìm thấy dòng dữ liệu học sinh.');
  return { sheet, mapping: m, labels, term, className, termCols, notes };
}

export function readRows(l: Layout): SheetRow[] {
  const { sheet, mapping: m } = l;
  const out: SheetRow[] = [];
  if (m.firstDataRow < 0 || m.name < 0) return out;
  for (let r = m.firstDataRow; r <= m.lastDataRow; r++) {
    let name = sheet.get(r, m.name);
    if (m.given >= 0 && sheet.get(r, m.given)) name = `${name} ${sheet.get(r, m.given)}`;
    name = name.replace(/\s+/g, ' ').trim();
    if (!name || !/\p{L}/u.test(name) || /^\d/.test(name)) continue;
    const values: SheetRow['values'] = {};
    COLS.forEach((k) => { if (m.cols[k] >= 0) values[k] = sheet.get(r, m.cols[k]); });
    out.push({ r, name, code: m.code >= 0 ? sheet.get(r, m.code) : '', dob: m.dob >= 0 ? sheet.get(r, m.dob) : '', values });
  }
  return out;
}

export const colLabel = (l: Layout, c: number) => (c < 0 ? '—' : `${colLetter(c)}${l.labels[c] ? ` · ${l.labels[c].slice(0, 40)}` : ''}`);

/** "8,5" → 8.5 ; "" → null ; rác → NaN */
export function parseScore(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
export const sameScore = (a: number | null, b: number | null) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 0.001);

export const round1 = (x: number) => Math.round((x + 1e-9) * 10) / 10;

type Who = { name: string; code?: string; dob?: string };
const dobKey = (s?: string) => (s || '').replace(/\D/g, '');

/**
 * Ghép từng dòng trong file với học sinh trong sổ điểm: ưu tiên mã HS, sau đó họ tên (bỏ dấu),
 * nếu trùng tên thì dùng ngày sinh. Trả về dòng → học sinh, và những người không ghép được.
 */
export function matchPeople<A extends Who, B extends Who>(rows: A[], people: B[]) {
  const pairs: { row: A; person: B; by: 'mã' | 'tên' | 'tên+ngày sinh' }[] = [];
  const used = new Set<B>();
  const left: A[] = [];
  const byCode = new Map<string, B>();
  people.forEach((p) => p.code && byCode.set(normKey(p.code), p));
  const byName = new Map<string, B[]>();
  people.forEach((p) => { const k = normKey(p.name); byName.set(k, [...(byName.get(k) || []), p]); });
  const pending: A[] = [];
  for (const row of rows) {
    const p = row.code ? byCode.get(normKey(row.code)) : undefined;
    if (p && !used.has(p)) { pairs.push({ row, person: p, by: 'mã' }); used.add(p); }
    else pending.push(row);
  }
  for (const row of pending) {
    const cands = (byName.get(normKey(row.name)) || []).filter((p) => !used.has(p));
    let p: B | undefined;
    let by: 'tên' | 'tên+ngày sinh' = 'tên';
    if (cands.length === 1) p = cands[0];
    else if (cands.length > 1 && row.dob) {
      const d = cands.filter((c) => dobKey(c.dob) && dobKey(c.dob) === dobKey(row.dob));
      if (d.length === 1) { p = d[0]; by = 'tên+ngày sinh'; }
    } else if (cands.length > 1) {
      // trùng tên, không có ngày sinh: ghép theo thứ tự xuất hiện
      p = cands[0];
    }
    if (p) { pairs.push({ row, person: p, by }); used.add(p); } else left.push(row);
  }
  const missing = people.filter((p) => !used.has(p));
  return { pairs, unmatchedRows: left, missing };
}

/** Guess which class book a sheet belongs to. */
export function guessClass(l: Layout, classes: ClassBook[]): ClassBook | undefined {
  const key = l.className;
  if (key) {
    const hit = classes.find((c) => classKeyOf(c.name) === key || normKey(c.name) === normKey(key));
    if (hit) return hit;
  }
  // fall back on overlap of names
  const rows = readRows(l);
  if (!rows.length) return undefined;
  let best: ClassBook | undefined, bestN = 0;
  for (const c of classes) {
    const names = new Set(c.students.map((s) => normKey(s.name)));
    const n = rows.filter((r) => names.has(normKey(r.name))).length;
    if (n > bestN) { bestN = n; best = c; }
  }
  return bestN >= Math.max(3, rows.length * 0.5) ? best : undefined;
}

export const studentsOf = (c: ClassBook): Student[] => c.students;

/** Khi một trang có cột điểm riêng cho từng học kì, chuyển sang các cột của học kì đã chọn. */
export function withTerm(l: Layout, t: Term): Layout {
  const tc = l.termCols[t];
  if (!tc) return l;
  const cols = { ...l.mapping.cols };
  COLS.forEach((k) => { if (tc[k] >= 0) cols[k] = tc[k]; });
  return { ...l, mapping: { ...l.mapping, cols } };
}
