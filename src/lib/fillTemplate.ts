import type { ClassBook, ScoreCol, Student, Term } from '../types';
import { openBook, saveBook, type Book } from './xlsxBook';
import { matchPeople, parseScore, readRows, sameScore, type Layout, type SheetRow } from './sheetMap';
import { colLetter } from './xlsxBook';

export type Write = { col: ScoreCol; c: number; value: number | null; current: number | null; skip?: string };
export type PlanItem = { row: SheetRow; student: Student; by: string; writes: Write[] };
export type FillPlan = {
  layout: Layout;
  book: ClassBook;
  term: Term;
  cols: ScoreCol[];
  items: PlanItem[];
  unmatchedRows: SheetRow[];
  missing: Student[];
  issues: string[]; // bất thường cần giáo viên xem
  stats: { toWrite: number; overwrite: number; empty: number };
};

/** Lập kế hoạch điền điểm cho một trang tính (chưa ghi gì vào file). */
export function planFill(layout: Layout, book: ClassBook, term: Term, cols: ScoreCol[]): FillPlan {
  const issues: string[] = [];
  const rows = readRows(layout);
  const m = matchPeople(rows, book.students);
  const sheet = layout.sheet;
  cols.forEach((k) => { if (layout.mapping.cols[k] < 0) issues.push(`Chưa chọn cột ${k} trên trang "${sheet.name}" — cột này sẽ không được điền.`); });
  let toWrite = 0, overwrite = 0, empty = 0;
  const items: PlanItem[] = m.pairs.map(({ row, person, by }) => {
    const writes: Write[] = [];
    for (const k of cols) {
      const c = layout.mapping.cols[k];
      if (c < 0) continue;
      const value = book.scores[term][k][person.id] ?? null;
      const cur = parseScore(sheet.get(row.r, c));
      const w: Write = { col: k, c, value, current: cur != null && Number.isNaN(cur) ? null : cur };
      if (sheet.isFormula(row.r, c)) w.skip = 'ô có công thức';
      else if (value == null) { w.skip = 'chưa có điểm trong sổ'; empty++; }
      else {
        toWrite++;
        if (w.current != null && !sameScore(w.current, value)) overwrite++;
      }
      writes.push(w);
    }
    return { row, student: person, by, writes };
  });
  if (m.unmatchedRows.length) issues.push(`${m.unmatchedRows.length} học sinh trong file không có trong sổ điểm lớp ${book.name}: ${m.unmatchedRows.slice(0, 6).map((r) => r.name).join(', ')}${m.unmatchedRows.length > 6 ? '…' : ''} — các dòng này giữ nguyên.`);
  if (m.missing.length) issues.push(`${m.missing.length} học sinh trong sổ điểm không tìm thấy trong file: ${m.missing.slice(0, 6).map((s) => s.name).join(', ')}${m.missing.length > 6 ? '…' : ''}.`);
  const totalCells = items.reduce((n, it) => n + it.writes.filter((w) => w.skip !== 'ô có công thức').length, 0);
  const emptyCols = cols.filter((k) => layout.mapping.cols[k] >= 0 && items.length && items.every((it) => it.writes.find((w) => w.col === k)?.value == null));
  if (emptyCols.length) issues.push(`Sổ điểm lớp ${book.name} chưa có điểm ${emptyCols.join(', ')} nào cho ${term} — đã chốt bài chấm / dán điểm TX chưa?`);
  if (empty && empty < totalCells && emptyCols.length < cols.length) {
    const who = items.flatMap((it) => it.writes.filter((w) => w.skip === 'chưa có điểm trong sổ' && !emptyCols.includes(w.col)).map((w) => `${it.student.name} (${w.col})`));
    if (who.length) issues.push(`${who.length} ô chưa có điểm trong sổ nên để nguyên: ${who.slice(0, 6).join(', ')}${who.length > 6 ? '…' : ''}.`);
  }
  if (overwrite) issues.push(`${overwrite} ô trong file đã có điểm KHÁC sẽ bị ghi đè (xem cột "Hiện có" trong bảng).`);
  const formula = items.flatMap((it) => it.writes.filter((w) => w.skip === 'ô có công thức')).length;
  if (formula) issues.push(`${formula} ô đích chứa công thức — không ghi đè, kiểm tra lại cột đã chọn.`);
  const byName = items.filter((i) => i.by !== 'mã').length;
  if (byName && layout.mapping.code >= 0) issues.push(`${byName} học sinh ghép theo họ tên (mã HS không khớp hoặc trống) — nên kiểm tra.`);
  const dupCols = cols.filter((k, i) => layout.mapping.cols[k] >= 0 && cols.some((k2, j) => j !== i && layout.mapping.cols[k2] === layout.mapping.cols[k]));
  if (dupCols.length) issues.push(`Hai cột điểm đang trỏ cùng một cột Excel (${dupCols.join(', ')}) — chọn lại.`);
  return { layout, book, term, cols, items, unmatchedRows: m.unmatchedRows, missing: m.missing, issues, stats: { toWrite, overwrite, empty } };
}

export function applyPlan(plan: FillPlan) {
  for (const it of plan.items) for (const w of it.writes) if (!w.skip) plan.layout.sheet.setNumber(it.row.r, w.c, w.value);
}

export type Verify = { checked: number; ok: number; bad: string[] };

/** Ghi file, mở lại file vừa ghi và so từng ô với điểm trong sổ (tự rà soát trước khi giao). */
export async function buildAndVerify(book: Book, plans: FillPlan[]): Promise<{ blob: Blob; ext: string; verify: Verify }> {
  plans.forEach(applyPlan);
  const { blob, ext } = await saveBook(book);
  const again = await openBook(new File([blob], `check.${ext}`));
  const v: Verify = { checked: 0, ok: 0, bad: [] };
  for (const plan of plans) {
    const s = again.sheets.find((x) => x.name === plan.layout.sheet.name);
    if (!s) { v.bad.push(`Không thấy lại trang "${plan.layout.sheet.name}" trong file xuất.`); continue; }
    for (const it of plan.items) for (const w of it.writes) {
      if (w.skip) continue;
      v.checked++;
      const got = parseScore(s.get(it.row.r, w.c));
      const nameNow = s.get(it.row.r, plan.layout.mapping.name);
      if (sameScore(got, w.value) && nameNow && it.row.name.startsWith(nameNow.split(' ')[0])) v.ok++;
      else v.bad.push(`${plan.layout.sheet.name} ô ${colLetter(w.c)}${it.row.r + 1} (${it.student.name}, ${w.col}): cần ${w.value}, file có "${s.get(it.row.r, w.c)}"`);
    }
  }
  return { blob, ext, verify: v };
}
