import { readXlsx } from './ooxml';
import { openBook } from './xlsxBook';
import { normKey, normWords, uid } from './util';
import type { Student } from '../types';

export type RosterParse = { students: Student[]; notes: string[]; sheetName?: string };

const isNameHeader = (s: string) => /^(ho va ten|ho ten|hoten|ten hoc sinh|ho va ten hoc sinh|hovaten|ho ten hs|ho va ten hs)$/.test(normWords(s).join(' '));
const isFirstName = (s: string) => /^ten$/.test(normWords(s).join(' '));
const isLastName = (s: string) => /^(ho|ho dem|ho va ten dem|ho lot)$/.test(normWords(s).join(' '));
const isCode = (s: string) => /^(ma|ma hs|ma hoc sinh|ma dinh danh|ma so|mshs|id|ma dinh danh hoc sinh)$/.test(normWords(s).join(' '));
const isDob = (s: string) => /^ngay (thang nam )?sinh/.test(normWords(s).join(' '));
const isStt = (s: string) => /^(stt|tt|so tt)$/.test(normWords(s).join(' '));

export function parseRosterRows(rows: string[][], sheetName?: string): RosterParse {
  const notes: string[] = [];
  const clean = rows.map((r) => (r || []).map((c) => String(c ?? '').trim()));
  let headerRow = -1;
  let nameCol = -1, firstCol = -1, lastCol = -1, codeCol = -1, sttCol = -1, dobCol = -1;
  for (let i = 0; i < Math.min(clean.length, 30) && headerRow < 0; i++) {
    clean[i].forEach((c, j) => {
      if (isNameHeader(c)) nameCol = j;
      else if (isFirstName(c)) firstCol = j;
      else if (isLastName(c)) lastCol = j;
      if (isCode(c) && codeCol < 0) codeCol = j;
      if (isStt(c) && sttCol < 0) sttCol = j;
      if (isDob(c) && dobCol < 0) dobCol = j;
    });
    if (nameCol >= 0 || (firstCol >= 0 && lastCol >= 0)) headerRow = i;
    else { codeCol = -1; sttCol = -1; firstCol = -1; lastCol = -1; dobCol = -1; }
  }
  if (headerRow < 0) {
    // No header: take the column that most often looks like a full name (2+ words, no digits).
    const width = Math.max(0, ...clean.map((r) => r.length));
    let best = -1, bestCount = 0;
    for (let j = 0; j < width; j++) {
      const n = clean.filter((r) => /^[^\d]{3,}$/.test(r[j] || '') && (r[j] || '').split(/\s+/).length >= 2).length;
      if (n > bestCount) { best = j; bestCount = n; }
    }
    nameCol = best;
    notes.push('Không thấy dòng tiêu đề "Họ và tên" — đã tự chọn cột trông giống họ tên nhất, hãy kiểm tra lại.');
  }
  const students: Student[] = [];
  const start = headerRow + 1;
  // "Họ và tên" gộp 2 ô: dữ liệu tách "Nguyễn Văn" | "An" mà cột sau không có tiêu đề
  if (nameCol >= 0 && firstCol < 0 && lastCol < 0) {
    const data = clean.slice(start).filter((r) => r && r[nameCol]);
    const single = data.filter((r) => /^\p{L}+$/u.test(r[nameCol + 1] || '')).length;
    const headNext = headerRow >= 0 ? clean[headerRow][nameCol + 1] || '' : '';
    if (data.length && single / data.length > 0.7 && (!headNext || isFirstName(headNext))) firstCol = nameCol + 1;
  }
  for (let i = start; i < clean.length; i++) {
    const r = clean[i];
    if (!r) continue;
    let name = nameCol >= 0 ? r[nameCol] : '';
    if (nameCol >= 0 && firstCol >= 0 && firstCol !== nameCol && /^\S+$/.test(r[firstCol] || '') && name && !(normWords(name).length >= 2 && normWords(name).slice(-1)[0] === normKey(r[firstCol]))) name = `${name} ${r[firstCol]}`;
    if (nameCol < 0 && lastCol >= 0) name = `${r[lastCol] || ''} ${r[firstCol] || ''}`.trim();
    name = name.replace(/\s+/g, ' ').trim();
    if (!name) continue;
    if (/^(tong|tổng|giáo viên|gvcn|người lập|ngày)/i.test(name) || /^\d+([.,]\d+)?$/.test(name)) continue;
    const sttRaw = sttCol >= 0 ? r[sttCol] : '';
    students.push({ id: uid(), stt: Number(sttRaw) || students.length + 1, name, code: codeCol >= 0 ? r[codeCol] || undefined : undefined, dob: dobCol >= 0 ? r[dobCol] || undefined : undefined });
  }
  // anomalies
  const seen: Record<string, string[]> = {};
  students.forEach((s) => (seen[normKey(s.name)] ||= []).push(s.name));
  Object.values(seen).filter((v) => v.length > 1).forEach((v) => notes.push(`Trùng tên: "${v[0]}" xuất hiện ${v.length} lần — khi ghép bài cần mã HS hoặc ghép tay.`));
  students.filter((s) => s.name.split(' ').length < 2).forEach((s) => notes.push(`Tên chỉ có 1 chữ: "${s.name}" (STT ${s.stt}).`));
  const stts = students.map((s) => s.stt);
  if (new Set(stts).size !== stts.length) notes.push('Cột STT có số bị trùng.');
  return { students, notes, sheetName };
}

/** Text pasted from Excel / Google Sheets (tab separated). */
export function parsePasted(text: string): RosterParse {
  const rows = text.replace(/\r/g, '').split('\n').filter((l) => l.trim()).map((l) => l.split('\t'));
  return parseRosterRows(rows);
}

export async function parseRosterFile(file: File): Promise<RosterParse & { sheets: string[] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
    const t = await file.text();
    const sep = t.includes('\t') ? '\t' : t.split('\n')[0].includes(';') ? ';' : ',';
    const rows = t.replace(/\r/g, '').split('\n').map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '')));
    return { ...parseRosterRows(rows), sheets: [] };
  }
  const sheets = name.endsWith('.xls')
    ? (await openBook(file)).sheets.map((s) => ({ name: s.name, rows: Array.from(s.grid, (r) => Array.from(r || [], (c) => c ?? '')), formulas: [] }))
    : await readXlsx(await file.arrayBuffer());
  // pick the sheet giving the most students
  let best: RosterParse = { students: [], notes: [] };
  for (const s of sheets) {
    const p = parseRosterRows(s.rows, s.name);
    if (p.students.length > best.students.length) best = p;
  }
  if (sheets.length > 1) best.notes.unshift(`File có ${sheets.length} trang tính, đã lấy trang "${best.sheetName}" (${best.students.length} HS).`);
  return { ...best, sheets: sheets.map((s) => s.name) };
}
