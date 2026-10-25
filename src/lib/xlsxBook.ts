import JSZip from 'jszip';

/**
 * Đọc và ghi file Excel mẫu (FSP / CSDL) mà KHÔNG làm hỏng định dạng:
 * chỉ sửa đúng các ô điểm trong XML của trang tính, mọi thứ khác (màu, viền, ô gộp,
 * công thức, khóa bảo vệ…) giữ nguyên. File .xls (Excel 97-2003) được chuyển qua
 * thư viện SheetJS (tải khi cần) rồi xuất lại đúng định dạng .xls.
 */

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const parseXml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
const els = (root: Element | Document, name: string): Element[] =>
  Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === name);
const kids = (el: Element, name: string): Element[] =>
  Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).localName === name);
const attr = (el: Element | null, name: string) => {
  if (!el) return '';
  for (const a of Array.from(el.attributes)) if (a.localName === name) return a.value;
  return '';
};
const relId = (el: Element) => {
  for (const a of Array.from(el.attributes)) if (a.localName === 'id' && (a.prefix || a.namespaceURI?.includes('relationships'))) return a.value;
  return '';
};

export function colIndex(letters: string) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function colLetter(i: number) {
  let s = '';
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}
export const cellRef = (r: number, c: number) => `${colLetter(c)}${r + 1}`;
const splitRef = (ref: string) => {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref.replace(/\$/g, ''));
  return m ? { r: Number(m[2]) - 1, c: colIndex(m[1]) } : null;
};

export type Merge = { r1: number; c1: number; r2: number; c2: number };

export class BookSheet {
  name: string;
  path: string;
  doc: Document;
  grid: string[][] = [];
  formulas = new Set<string>();
  merges: Merge[] = [];
  hidden: boolean;
  dirty = false;

  constructor(name: string, path: string, doc: Document, shared: string[], hidden: boolean) {
    this.name = name;
    this.path = path;
    this.doc = doc;
    this.hidden = hidden;
    for (const row of els(doc, 'row')) {
      for (const c of kids(row, 'c')) {
        const pos = splitRef(attr(c, 'r'));
        if (!pos) continue;
        const t = attr(c, 't');
        const v = kids(c, 'v')[0]?.textContent ?? '';
        let val = v;
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = els(c, 't').map((x) => x.textContent || '').join('');
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        (this.grid[pos.r] ||= [])[pos.c] = val;
        if (kids(c, 'f').length) this.formulas.add(cellRef(pos.r, pos.c));
      }
    }
    for (const m of els(doc, 'mergeCell')) {
      const [a, b] = attr(m, 'ref').split(':');
      const p1 = splitRef(a), p2 = splitRef(b || a);
      if (p1 && p2) this.merges.push({ r1: p1.r, c1: p1.c, r2: p2.r, c2: p2.c });
    }
  }

  get rowCount() { return this.grid.length; }
  get colCount() {
    let n = 0;
    for (let i = 0; i < this.grid.length; i++) n = Math.max(n, this.grid[i]?.length || 0);
    return n;
  }

  /** Raw value of a cell. */
  get(r: number, c: number): string { return String(this.grid[r]?.[c] ?? '').trim(); }

  /** Value as seen on screen: cells inside a merged block show the block's top-left value. */
  shown(r: number, c: number): string {
    const m = this.merges.find((x) => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2);
    return m ? this.get(m.r1, m.c1) : this.get(r, c);
  }

  isFormula(r: number, c: number) { return this.formulas.has(cellRef(r, c)); }

  /** Write a number (or clear with null) into a cell, keeping its style. */
  setNumber(r: number, c: number, value: number | null) {
    const ref = cellRef(r, c);
    const sheetData = els(this.doc, 'sheetData')[0];
    if (!sheetData) throw new Error(`Trang tính "${this.name}" không có dữ liệu.`);
    let rowEl = kids(sheetData, 'row').find((x) => Number(attr(x, 'r')) === r + 1);
    if (!rowEl) {
      rowEl = this.doc.createElementNS(NS, 'row');
      rowEl.setAttribute('r', String(r + 1));
      const after = kids(sheetData, 'row').find((x) => Number(attr(x, 'r')) > r + 1);
      sheetData.insertBefore(rowEl, after || null);
    }
    let cEl = kids(rowEl, 'c').find((x) => attr(x, 'r') === ref);
    if (!cEl) {
      cEl = this.doc.createElementNS(NS, 'c');
      cEl.setAttribute('r', ref);
      // inherit the row style if the cell did not exist yet
      const rowStyle = attr(rowEl, 's');
      if (rowStyle && attr(rowEl, 'customFormat') === '1') cEl.setAttribute('s', rowStyle);
      const after = kids(rowEl, 'c').find((x) => (splitRef(attr(x, 'r'))?.c ?? 0) > c);
      rowEl.insertBefore(cEl, after || null);
      // keep the "spans" hint valid
      const spans = attr(rowEl, 'spans');
      if (spans) {
        const [a, b] = spans.split(':').map(Number);
        if (c + 1 < a || c + 1 > b) rowEl.setAttribute('spans', `${Math.min(a, c + 1)}:${Math.max(b, c + 1)}`);
      }
    }
    if (cEl.hasAttribute('t')) cEl.removeAttribute('t');
    while (cEl.firstChild) cEl.removeChild(cEl.firstChild);
    if (value != null) {
      const v = this.doc.createElementNS(NS, 'v');
      v.textContent = String(Math.round(value * 100) / 100);
      cEl.appendChild(v);
    }
    (this.grid[r] ||= [])[c] = value == null ? '' : String(Math.round(value * 100) / 100);
    this.dirty = true;
  }
}

export type Book = {
  fileName: string;
  format: 'xlsx' | 'xls';
  zip: JSZip;
  sheets: BookSheet[];
};

// ---------- SheetJS (only for .xls) ----------
let sheetjs: Promise<any> | null = null;
function loadSheetJS(): Promise<any> {
  if ((window as any).XLSX) return Promise.resolve((window as any).XLSX);
  sheetjs ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => resolve((window as any).XLSX);
    s.onerror = () => { sheetjs = null; reject(new Error('Không tải được thư viện đọc file .xls (cần Internet). Hoặc mở file bằng Excel và lưu lại thành .xlsx.')); };
    document.head.appendChild(s);
  });
  return sheetjs;
}

export async function openBook(file: File): Promise<Book> {
  const lower = file.name.toLowerCase();
  let buf = await file.arrayBuffer();
  let format: Book['format'] = 'xlsx';
  const isZip = new Uint8Array(buf.slice(0, 2)).join(',') === '80,75';
  if (lower.endsWith('.xls') || !isZip) {
    if (lower.endsWith('.csv')) throw new Error('File CSV không có định dạng mẫu — hãy dùng file Excel gốc tải từ hệ thống.');
    const XLSX = await loadSheetJS();
    const wb = XLSX.read(buf, { type: 'array', cellStyles: true });
    buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    format = 'xls';
  }
  const zip = await JSZip.loadAsync(buf);
  const wbFile = zip.file('xl/workbook.xml');
  if (!wbFile) throw new Error(`"${file.name}" không phải file Excel hợp lệ.`);
  const wbDoc = parseXml(await wbFile.async('string'));
  const relsDoc = parseXml((await zip.file('xl/_rels/workbook.xml.rels')?.async('string')) || '<Relationships/>');
  const rels: Record<string, string> = {};
  els(relsDoc, 'Relationship').forEach((r) => (rels[attr(r, 'Id')] = attr(r, 'Target')));
  const shared: string[] = [];
  const ss = zip.file('xl/sharedStrings.xml');
  if (ss) els(parseXml(await ss.async('string')), 'si').forEach((si) => shared.push(els(si, 't').map((t) => t.textContent || '').join('')));
  const sheets: BookSheet[] = [];
  for (const s of els(wbDoc, 'sheet')) {
    let target = rels[relId(s)];
    if (!target) continue;
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const f = zip.file(target);
    if (!f) continue;
    sheets.push(new BookSheet(attr(s, 'name'), target, parseXml(await f.async('string')), shared, ['hidden', 'veryHidden'].includes(attr(s, 'state'))));
  }
  return { fileName: file.name, format, zip, sheets };
}

/** Serialize the edited workbook. Excel recalculates formulas (e.g. điểm trung bình) when opened. */
export async function saveBook(book: Book): Promise<{ blob: Blob; ext: 'xlsx' | 'xls' }> {
  const ser = new XMLSerializer();
  for (const s of book.sheets) if (s.dirty) book.zip.file(s.path, ser.serializeToString(s.doc));
  const wbPath = 'xl/workbook.xml';
  const wbDoc = parseXml(await book.zip.file(wbPath)!.async('string'));
  let calc = els(wbDoc, 'calcPr')[0];
  if (!calc) {
    calc = wbDoc.createElementNS(NS, 'calcPr');
    const root = wbDoc.documentElement;
    // calcPr must come after sheets/definedNames
    const after = Array.from(root.childNodes).find((n) => n.nodeType === 1 && ['oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst'].includes((n as Element).localName));
    root.insertBefore(calc, after || null);
  }
  calc.setAttribute('fullCalcOnLoad', '1');
  book.zip.file(wbPath, ser.serializeToString(wbDoc));
  const buf = await book.zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  if (book.format === 'xls') {
    const XLSX = await loadSheetJS();
    const wb = XLSX.read(buf, { type: 'array', cellStyles: true });
    const out = XLSX.write(wb, { type: 'array', bookType: 'biff8' });
    return { blob: new Blob([out], { type: 'application/vnd.ms-excel' }), ext: 'xls' };
  }
  return { blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), ext: 'xlsx' };
}

// ---------- simple writer for reports ----------
const xmlEsc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export type ReportSheet = {
  name: string;
  rows: (string | number | null | undefined)[][];
  widths?: number[];
  headerRows?: number[]; // bold + fill
  redRows?: number[]; // highlight rows
};

/** Build a small, clean .xlsx (used for báo cáo đối chiếu). */
export async function writeReportXlsx(sheets: ReportSheet[]): Promise<Blob> {
  const zip = new JSZip();
  const safe = (n: string, i: number) => (n.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${i + 1}`);
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(safe(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  // styles: 0 normal, 1 header (bold, grey fill, border), 2 border, 3 red row (border + fill)
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Times New Roman"/></font><font><b/><sz val="11"/><name val="Times New Roman"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7EEF3"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFDE3E0"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment wrapText="1" vertical="center"/></xf><xf fontId="0" fillId="0" borderId="1" applyBorder="1"><alignment wrapText="1" vertical="center"/></xf><xf fontId="0" fillId="3" borderId="1" applyFill="1" applyBorder="1"><alignment wrapText="1" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  sheets.forEach((s, i) => {
    const head = new Set(s.headerRows || []);
    const red = new Set(s.redRows || []);
    const width = Math.max(1, ...s.rows.map((r) => r.length));
    const rowsXml = s.rows.map((r, ri) => {
      const style = head.has(ri) ? 1 : red.has(ri) ? 3 : r.some((v) => v !== '' && v != null) && ri > Math.min(...(s.headerRows || [0])) ? 2 : 0;
      const cells = Array.from({ length: width }, (_, ci) => {
        const v = r[ci];
        const ref = cellRef(ri, ci);
        const st = style ? ` s="${style}"` : '';
        if (v == null || v === '') return style ? `<c r="${ref}"${st}/>` : '';
        if (typeof v === 'number') return `<c r="${ref}"${st}><v>${v}</v></c>`;
        return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    const cols = s.widths?.length ? `<cols>${s.widths.map((w, ci) => `<col min="${ci + 1}" max="${ci + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}">${cols}<sheetData>${rowsXml}</sheetData></worksheet>`);
  });
  const buf = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
