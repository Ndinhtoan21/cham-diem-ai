import { AlignmentType, Document, Packer, PageOrientation, Paragraph, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType, ShadingType, BorderStyle } from 'docx';

const NB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
import { effective, maxTotal, totalOf } from './grading';
import { fmt } from './util';
import { finalScore } from './gradebook';
import { TERM_LABEL } from '../types';
import type { Project } from '../types';

const FONT = 'Times New Roman';
const t = (text: string, o: { bold?: boolean; size?: number; italics?: boolean; color?: string } = {}) =>
  new TextRun({ text, font: FONT, size: (o.size || 13) * 2, bold: o.bold, italics: o.italics, color: o.color });
const para = (children: TextRun[], align: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT, after = 80) =>
  new Paragraph({ children, alignment: align, spacing: { after } });
const cell = (text: string, o: { bold?: boolean; align?: any; width?: number; shade?: boolean; size?: number } = {}) =>
  new TableCell({
    children: [para([t(text, { bold: o.bold, size: o.size || 12 })], o.align || AlignmentType.LEFT, 0)],
    verticalAlign: VerticalAlign.CENTER,
    width: o.width ? { size: o.width, type: WidthType.DXA } : undefined,
    shading: o.shade ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E7EEF3' } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
  });

function header(p: Project) {
  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB },
      rows: [
        new TableRow({
          children: [
            new TableCell({ children: [para([t((p.school || '').toUpperCase(), { bold: true, size: 12 })], AlignmentType.CENTER, 0), para([t(p.teacher ? `Giáo viên: ${p.teacher}` : '', { size: 12 })], AlignmentType.CENTER, 0)] }),
            new TableCell({ children: [para([t('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', { bold: true, size: 12 })], AlignmentType.CENTER, 0), para([t('Độc lập - Tự do - Hạnh phúc', { bold: true, size: 12 })], AlignmentType.CENTER, 0)] }),
          ],
        }),
      ],
    }),
    para([t('')]),
  ];
}

export async function exportWord(p: Project): Promise<Blob> {
  const draft = !p.finalized;
  const wide = p.rubric.length > 5;
  const crit = p.rubric;

  // Page 1 — tiêu chí chấm
  const page1 = [
    ...header(p),
    para([t('TIÊU CHÍ CHẤM ĐIỂM', { bold: true, size: 15 })], AlignmentType.CENTER, 60),
    para([t(`${p.name}${p.className ? ` — Lớp ${p.className}` : ''}`, { size: 13, italics: true })], AlignmentType.CENTER, 200),
    ...(draft ? [para([t('BẢN NHÁP — điểm chưa được chốt', { bold: true, color: 'C0392B' })], AlignmentType.CENTER, 160)] : []),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: [cell('Mã', { bold: true, shade: true, align: AlignmentType.CENTER, width: 700 }), cell('Tiêu chí', { bold: true, shade: true, width: 3000 }), cell('Mô tả / hướng dẫn chấm', { bold: true, shade: true }), cell('Điểm tối đa', { bold: true, shade: true, align: AlignmentType.CENTER, width: 1200 })] }),
        ...crit.map((c, i) => new TableRow({ children: [cell(`TC${i + 1}`, { align: AlignmentType.CENTER }), cell(c.name), cell(c.desc || ''), cell(fmt(c.max), { align: AlignmentType.CENTER })] })),
        new TableRow({ children: [cell(''), cell('Tổng', { bold: true }), cell(''), cell(fmt(maxTotal(crit)), { bold: true, align: AlignmentType.CENTER })] }),
      ],
    }),
  ];

  // Page 2 — bảng điểm
  const scale10 = maxTotal(crit) !== 10;
  const rows = p.students.map((s, i) => {
    const r = p.results[s.id];
    return new TableRow({
      children: [
        cell(String(s.stt || i + 1), { align: AlignmentType.CENTER }),
        cell(s.name),
        ...crit.map((c) => {
          const sc = r?.scores.find((x) => x.criterionId === c.id);
          return cell(sc ? fmt(effective(sc)) : '', { align: AlignmentType.CENTER });
        }),
        cell(r?.status === 'done' ? fmt(scale10 ? totalOf(r) : finalScore(p, r)) : '', { bold: !scale10, align: AlignmentType.CENTER }),
        ...(scale10 ? [cell(fmt(finalScore(p, r)), { bold: true, align: AlignmentType.CENTER })] : []),
      ],
    });
  });
  const totals = p.students.map((s) => finalScore(p, p.results[s.id])).filter((v): v is number => v != null);
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
  const page2 = [
    ...header(p),
    para([t(`BẢNG ĐIỂM${p.className ? ` LỚP ${p.className.toUpperCase()}` : ''}`, { bold: true, size: 15 })], AlignmentType.CENTER, 60),
    para([t(p.name, { italics: true })], AlignmentType.CENTER, 200),
    ...(draft ? [para([t('BẢN NHÁP — điểm chưa được chốt', { bold: true, color: 'C0392B' })], AlignmentType.CENTER, 160)] : []),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            cell('STT', { bold: true, shade: true, align: AlignmentType.CENTER, width: 600 }),
            cell('Họ và tên', { bold: true, shade: true, width: 3200 }),
            ...crit.map((c, i) => cell(`TC${i + 1} (${fmt(c.max)}đ)`, { bold: true, shade: true, align: AlignmentType.CENTER, size: 11 })),
            cell(scale10 ? `Tổng (${fmt(maxTotal(crit))})` : 'Tổng điểm', { bold: true, shade: true, align: AlignmentType.CENTER, width: 1100 }),
            ...(scale10 ? [cell('Điểm (thang 10)', { bold: true, shade: true, align: AlignmentType.CENTER, width: 1100 })] : []),
          ],
        }),
        ...rows,
      ],
    }),
    para([t('')]),
    para([t(`Sĩ số: ${p.students.length}. Có điểm: ${totals.length}. Điểm trung bình: ${fmt(Math.round(avg * 10) / 10)}.${p.term ? ` ${TERM_LABEL[p.term]}, cột điểm ${p.column || ''}.` : ''}`, { size: 12, italics: true })]),
    para([t(crit.map((c, i) => `TC${i + 1}: ${c.name}`).join('; '), { size: 11, italics: true })]),
    para([t('')]),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB },
      rows: [new TableRow({ children: [new TableCell({ children: [para([t('')])] }), new TableCell({ children: [para([t(`Đà Nẵng, ngày ...... tháng ...... năm ${new Date().getFullYear()}`, { italics: true, size: 12 })], AlignmentType.CENTER, 0), para([t('GIÁO VIÊN CHẤM', { bold: true, size: 12 })], AlignmentType.CENTER, 900), para([t(p.teacher || '', { bold: true, size: 12 })], AlignmentType.CENTER, 0)] })] })],
    }),
  ];

  const margin = { top: 1000, bottom: 1000, left: 1100, right: 900 };
  const doc = new Document({
    creator: p.teacher || 'Chấm Điểm AI',
    title: `Bảng điểm ${p.name}`,
    sections: [
      { properties: { page: { margin } }, children: page1 },
      { properties: { page: { margin, size: wide ? { orientation: PageOrientation.LANDSCAPE } : undefined } }, children: page2 },
    ],
  });
  return Packer.toBlob(doc);
}
