import type { ScoreCol } from '../types';
import { matchPeople, parseScore, readRows, sameScore, type Layout, type SheetRow } from './sheetMap';
import { writeReportXlsx } from './xlsxBook';
import { fmt } from './util';

export type Table = { id: string; system: 'FSP' | 'CSDL'; fileName: string; layout: Layout; className: string };

export type Diff = {
  className: string;
  name: string;
  code: string;
  col: ScoreCol;
  fsp: string;
  csdl: string;
  kind: 'Lệch điểm' | 'Thiếu ở FSP' | 'Thiếu ở CSDL' | 'Điểm không hợp lệ';
};
export type ClassResult = {
  className: string;
  fspFile: string;
  csdlFile: string;
  students: number;
  compared: number; // số ô điểm đã so (ít nhất một bên có điểm)
  same: number;
  diff: number;
  bothEmpty: number;
  onlyFsp: string[]; // HS chỉ có ở FSP
  onlyCsdl: string[];
  diffs: Diff[];
  byCol: Record<string, { compared: number; diff: number }>;
};

const show = (v: string) => (v === '' ? '(trống)' : v);

export function compareTables(fsp: Table, csdl: Table, cols: ScoreCol[]): ClassResult {
  const a = readRows(fsp.layout);
  const b = readRows(csdl.layout);
  const m = matchPeople(a, b);
  const res: ClassResult = {
    className: fsp.className || csdl.className, fspFile: `${fsp.fileName} › ${fsp.layout.sheet.name}`, csdlFile: `${csdl.fileName} › ${csdl.layout.sheet.name}`,
    students: m.pairs.length, compared: 0, same: 0, diff: 0, bothEmpty: 0,
    onlyFsp: m.unmatchedRows.map((r) => r.name), onlyCsdl: m.missing.map((r) => r.name), diffs: [], byCol: {},
  };
  const usable = cols.filter((k) => fsp.layout.mapping.cols[k] >= 0 && csdl.layout.mapping.cols[k] >= 0);
  usable.forEach((k) => (res.byCol[k] = { compared: 0, diff: 0 }));
  for (const { row, person } of m.pairs as { row: SheetRow; person: SheetRow }[]) {
    for (const k of usable) {
      const ra = row.values[k] ?? '';
      const rb = person.values[k] ?? '';
      const va = parseScore(ra), vb = parseScore(rb);
      if (va == null && vb == null) { res.bothEmpty++; continue; }
      res.compared++;
      res.byCol[k].compared++;
      let kind: Diff['kind'] | null = null;
      if ((va != null && Number.isNaN(va)) || (vb != null && Number.isNaN(vb))) kind = 'Điểm không hợp lệ';
      else if (va == null) kind = 'Thiếu ở FSP';
      else if (vb == null) kind = 'Thiếu ở CSDL';
      else if (!sameScore(va, vb)) kind = 'Lệch điểm';
      if (kind) {
        res.diff++;
        res.byCol[k].diff++;
        res.diffs.push({ className: res.className, name: row.name, code: row.code || person.code, col: k, fsp: show(ra), csdl: show(rb), kind });
      } else res.same++;
    }
  }
  return res;
}

export const pct = (a: number, b: number) => (b ? `${fmt(Math.round((a / b) * 1000) / 10)}%` : '0%');

export async function compareReportXlsx(results: ClassResult[], cols: ScoreCol[], title: string): Promise<Blob> {
  const tot = results.reduce((s, r) => ({ c: s.c + r.compared, d: s.d + r.diff, ok: s.ok + r.same }), { c: 0, d: 0, ok: 0 });
  const summary: (string | number)[][] = [
    [title],
    [`Cột so sánh: ${cols.join(', ')} · Lập lúc ${new Date().toLocaleString('vi-VN')}`],
    [],
    ['Lớp', 'File FSP', 'File CSDL', 'Số HS ghép được', 'Số điểm so sánh', 'Đúng', 'Sai', 'Tỉ lệ sai', 'HS chỉ có ở FSP', 'HS chỉ có ở CSDL'],
    ...results.map((r) => [r.className, r.fspFile, r.csdlFile, r.students, r.compared, r.same, r.diff, pct(r.diff, r.compared), r.onlyFsp.join(', '), r.onlyCsdl.join(', ')]),
    ['TỔNG', '', '', results.reduce((s, r) => s + r.students, 0), tot.c, tot.ok, tot.d, pct(tot.d, tot.c), '', ''],
  ];
  const details: (string | number)[][] = [
    ['STT', 'Lớp', 'Họ và tên', 'Mã HS', 'Cột điểm', 'Điểm FSP', 'Điểm CSDL', 'Loại sai lệch'],
    ...results.flatMap((r) => r.diffs).map((d, i) => [i + 1, d.className, d.name, d.code, d.col, d.fsp, d.csdl, d.kind]),
  ];
  return writeReportXlsx([
    { name: 'Tổng hợp', rows: summary, widths: [10, 34, 34, 14, 14, 10, 10, 11, 30, 30], headerRows: [3, summary.length - 1] },
    { name: 'Chi tiết sai lệch', rows: details, widths: [6, 10, 28, 16, 10, 11, 11, 18], headerRows: [0] },
  ]);
}
