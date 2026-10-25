import JSZip from 'jszip';
import { escapeHtml } from './util';

// ---------- generic XML helpers ----------
export const parseXml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
const kids = (el: Element | Document, name?: string): Element[] =>
  Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1 && (!name || (n as Element).localName === name));
const kid = (el: Element | null | undefined, name: string) => (el ? kids(el, name)[0] || null : null);
const all = (el: Element | Document, name: string): Element[] =>
  Array.from(el.getElementsByTagName('*')).filter((e) => e.localName === name);
const attr = (el: Element | null, name: string) => {
  if (!el) return '';
  for (const a of Array.from(el.attributes)) if (a.localName === name) return a.value;
  return '';
};
/** Relationship id (r:id) — distinct from a plain "id" attribute on the same element. */
const rid = (el: Element | null) => {
  if (!el) return '';
  for (const a of Array.from(el.attributes)) if (a.localName === 'id' && (a.prefix || a.namespaceURI?.includes('relationships'))) return a.value;
  return attr(el, 'id');
};
const onOff = (el: Element | null) => {
  if (!el) return false;
  const v = attr(el, 'val');
  return !(v === '0' || v === 'false' || v === 'none');
};

async function readRels(zip: JSZip, path: string): Promise<Record<string, string>> {
  const f = zip.file(path);
  if (!f) return {};
  const doc = parseXml(await f.async('string'));
  const out: Record<string, string> = {};
  all(doc, 'Relationship').forEach((r) => (out[attr(r, 'Id')] = attr(r, 'Target')));
  return out;
}

function resolvePath(baseDir: string, target: string) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (baseDir + '/' + target).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };

export async function downscale(blob: Blob, max = 1400, quality = 0.78): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  } catch {
    return null;
  }
}

async function zipImage(zip: JSZip, path: string): Promise<string | null> {
  const ext = path.split('.').pop()!.toLowerCase();
  const f = zip.file(path);
  if (!f || !MIME[ext]) return null;
  const blob = new Blob([await f.async('uint8array')], { type: MIME[ext] });
  return downscale(blob);
}

export type Extracted = { text: string; analysis: string; html: string; images: string[]; warnings: string[] };

// ---------- DOCX ----------
const ALIGN: Record<string, string> = { center: 'căn giữa', right: 'căn phải', both: 'căn đều', justify: 'căn đều', left: 'căn trái', start: 'căn trái', end: 'căn phải' };
const CSS_ALIGN: Record<string, string> = { center: 'center', right: 'right', end: 'right', both: 'justify', justify: 'justify' };

export async function extractDocx(buf: ArrayBuffer): Promise<Extracted> {
  const zip = await JSZip.loadAsync(buf);
  const main = zip.file('word/document.xml');
  if (!main) throw new Error('Không phải file Word hợp lệ.');
  const doc = parseXml(await main.async('string'));
  const rels = await readRels(zip, 'word/_rels/document.xml.rels');

  // styles: names + defaults
  const styleNames: Record<string, string> = {};
  let defFont = '';
  let defSize = 0;
  const stylesFile = zip.file('word/styles.xml');
  if (stylesFile) {
    const st = parseXml(await stylesFile.async('string'));
    all(st, 'style').forEach((s) => (styleNames[attr(s, 'styleId')] = attr(kid(s, 'name'), 'val')));
    const rDef = all(st, 'rPrDefault')[0];
    if (rDef) {
      defFont = attr(all(rDef, 'rFonts')[0] || null, 'ascii');
      const sz = attr(all(rDef, 'sz')[0] || null, 'val');
      if (sz) defSize = Number(sz) / 2;
    }
  }

  const images: string[] = [];
  const warnings: string[] = [];
  const textLines: string[] = [];
  const analysis: string[] = [];
  let imgCount = 0;
  let tableCount = 0;
  let paraNo = 0;

  async function runToHtml(r: Element, fmtAcc: string[][]): Promise<{ html: string; text: string }> {
    const rPr = kid(r, 'rPr');
    const b = onOff(kid(rPr, 'b'));
    const i = onOff(kid(rPr, 'i'));
    const u = attr(kid(rPr, 'u'), 'val');
    const strike = onOff(kid(rPr, 'strike'));
    const sz = attr(kid(rPr, 'sz'), 'val');
    const font = attr(kid(rPr, 'rFonts'), 'ascii') || attr(kid(rPr, 'rFonts'), 'hAnsi');
    const color = attr(kid(rPr, 'color'), 'val');
    const hl = attr(kid(rPr, 'highlight'), 'val');
    const vert = attr(kid(rPr, 'vertAlign'), 'val');
    let html = '';
    let text = '';
    for (const c of kids(r)) {
      if (c.localName === 't') {
        text += c.textContent || '';
        html += escapeHtml(c.textContent || '');
      } else if (c.localName === 'tab') {
        text += '\t';
        html += '&emsp;';
      } else if (c.localName === 'br' || c.localName === 'cr') {
        text += '\n';
        html += '<br>';
      } else if (c.localName === 'drawing' || c.localName === 'pict' || c.localName === 'object') {
        imgCount++;
        const blip = all(c, 'blip')[0] || all(c, 'imagedata')[0];
        const relId = blip ? attr(blip, 'embed') || rid(blip) : '';
        const target = rels[relId];
        if (target) {
          const url = await zipImage(zip, resolvePath('word', target));
          if (url) {
            images.push(url);
            html += `<img class="doc-img" src="${url}" alt="Hình ${imgCount}">`;
          } else html += `<span class="doc-img-missing">[Hình ${imgCount}]</span>`;
        }
        text += ` [Hình ${imgCount}] `;
      }
    }
    if (!html) return { html: '', text: '' };
    const style: string[] = [];
    const tags: string[] = [];
    if (b) { style.push('font-weight:700'); tags.push('đậm'); }
    if (i) { style.push('font-style:italic'); tags.push('nghiêng'); }
    if (u && u !== 'none') { style.push('text-decoration:underline'); tags.push('gạch chân'); }
    if (strike) { style.push('text-decoration:line-through'); tags.push('gạch ngang'); }
    if (sz) { style.push(`font-size:${Math.min(36, Number(sz) / 2)}pt`); tags.push(`cỡ ${Number(sz) / 2}`); }
    if (font) { style.push(`font-family:'${font.replace(/'/g, '')}'`); tags.push(font); }
    if (color && color !== 'auto' && color !== '000000') { style.push(`color:#${color}`); tags.push(`màu #${color}`); }
    if (hl) { style.push('background:#fff59d'); tags.push(`tô nền ${hl}`); }
    if (vert === 'superscript') tags.push('chỉ số trên');
    if (vert === 'subscript') tags.push('chỉ số dưới');
    if (text.trim()) fmtAcc.push([tags.join(', '), text]);
    return { html: style.length ? `<span style="${style.join(';')}">${html}</span>` : html, text };
  }

  async function paraToHtml(p: Element, inTable = false): Promise<{ html: string; text: string }> {
    const pPr = kid(p, 'pPr');
    const styleId = attr(kid(pPr, 'pStyle'), 'val');
    const styleName = styleNames[styleId] || styleId;
    const jc = attr(kid(pPr, 'jc'), 'val');
    const isList = !!kid(pPr, 'numPr');
    const ind = kid(pPr, 'ind');
    const spacing = kid(pPr, 'spacing');
    const fmtAcc: string[][] = [];
    let html = '';
    let text = '';
    const walk = async (el: Element) => {
      for (const c of kids(el)) {
        if (c.localName === 'r') {
          const o = await runToHtml(c, fmtAcc);
          html += o.html;
          text += o.text;
        } else if (['hyperlink', 'ins', 'smartTag', 'sdt', 'sdtContent', 'fldSimple'].includes(c.localName)) await walk(c);
      }
    };
    await walk(p);
    const heading = /heading\s*(\d)|^title$/i.exec(styleName || '');
    const tag = heading ? `h${Math.min(6, Number(heading[1] || 1) + 1)}` : 'p';
    const css = CSS_ALIGN[jc] ? ` style="text-align:${CSS_ALIGN[jc]}"` : '';
    const listMark = isList ? '• ' : '';
    if (!inTable && (text.trim() || html.includes('<img'))) {
      paraNo++;
      const props = [styleName && styleName !== 'Normal' ? `kiểu ${styleName}` : '', ALIGN[jc] || '', isList ? 'danh sách' : '',
        ind && attr(ind, 'firstLine') ? `thụt đầu dòng ${(Number(attr(ind, 'firstLine')) / 567).toFixed(1)}cm` : '',
        spacing && attr(spacing, 'line') ? `giãn dòng ${(Number(attr(spacing, 'line')) / 240).toFixed(2)}` : '']
        .filter(Boolean).join(', ');
      const runs = mergeRuns(fmtAcc).map(([t, s]) => `[${t || 'mặc định'}] "${s.slice(0, 90)}${s.length > 90 ? '…' : ''}"`).join(' ');
      analysis.push(`Đoạn ${paraNo}${props ? ` (${props})` : ''}: ${runs || '(chỉ có hình)'}`);
    }
    return { html: `<${tag}${css}>${listMark}${html || '&nbsp;'}</${tag}>`, text: listMark + text };
  }

  async function tableToHtml(tbl: Element): Promise<{ html: string; text: string }> {
    tableCount++;
    let html = '<table class="doc-table">';
    const lines: string[] = [];
    const rows = kids(tbl, 'tr');
    for (const tr of rows) {
      html += '<tr>';
      const cells: string[] = [];
      for (const tc of kids(tr, 'tc')) {
        let cellHtml = '';
        const cellText: string[] = [];
        for (const c of kids(tc)) {
          if (c.localName === 'p') {
            const o = await paraToHtml(c, true);
            cellHtml += o.html;
            cellText.push(o.text);
          } else if (c.localName === 'tbl') {
            const o = await tableToHtml(c);
            cellHtml += o.html;
            cellText.push(o.text);
          }
        }
        html += `<td>${cellHtml}</td>`;
        cells.push(cellText.join(' ').trim());
      }
      html += '</tr>';
      lines.push(cells.join(' | '));
    }
    html += '</table>';
    const cols = rows[0] ? kids(rows[0], 'tc').length : 0;
    analysis.push(`Bảng ${tableCount}: ${rows.length} hàng × ${cols} cột. Nội dung: ${lines.join(' / ').slice(0, 400)}`);
    return { html, text: lines.join('\n') };
  }

  const body = all(doc, 'body')[0];
  let html = '';
  const blocks = async (el: Element) => {
    for (const c of kids(el)) {
      if (c.localName === 'p') {
        const o = await paraToHtml(c);
        html += o.html;
        textLines.push(o.text);
      } else if (c.localName === 'tbl') {
        const o = await tableToHtml(c);
        html += o.html;
        textLines.push(o.text);
      } else if (c.localName === 'sdt' || c.localName === 'sdtContent') await blocks(c);
    }
  };
  if (body) await blocks(body);

  const head: string[] = [];
  const sect = all(doc, 'sectPr').pop();
  if (sect) {
    const pg = kid(sect, 'pgSz');
    const mar = kid(sect, 'pgMar');
    const cm = (v: string) => (Number(v) / 567).toFixed(1) + 'cm';
    if (pg) head.push(`Trang: ${attr(pg, 'orient') === 'landscape' ? 'nằm ngang' : 'đứng'}, khổ ${cm(attr(pg, 'w'))} × ${cm(attr(pg, 'h'))}`);
    if (mar) head.push(`Lề: trên ${cm(attr(mar, 'top'))}, dưới ${cm(attr(mar, 'bottom'))}, trái ${cm(attr(mar, 'left'))}, phải ${cm(attr(mar, 'right'))}`);
  }
  head.push(`Mặc định: ${defFont || 'không rõ phông'}${defSize ? `, cỡ ${defSize}` : ''}`);
  head.push(`Số đoạn có chữ: ${paraNo}; số hình: ${imgCount}; số bảng: ${tableCount}`);
  if (zip.file('word/header1.xml')) head.push('Có đầu trang (header)');
  if (zip.file('word/footer1.xml')) head.push('Có chân trang (footer)');

  const text = textLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text && !imgCount) warnings.push('File Word không có nội dung.');
  return { text, analysis: [...head, ...analysis].join('\n'), html: `<div class="docx">${html}</div>`, images: images.slice(0, 6), warnings };
}

function mergeRuns(r: string[][]): string[][] {
  const out: string[][] = [];
  for (const [t, s] of r) {
    const last = out[out.length - 1];
    if (last && last[0] === t) last[1] += s;
    else out.push([t, s]);
  }
  return out;
}

// ---------- PPTX ----------
const PH: Record<string, string> = { title: 'tiêu đề', ctrTitle: 'tiêu đề', subTitle: 'tiêu đề phụ', body: 'nội dung' };

export async function extractPptx(buf: ArrayBuffer): Promise<Extracted> {
  const zip = await JSZip.loadAsync(buf);
  const pres = zip.file('ppt/presentation.xml');
  if (!pres) throw new Error('Không phải file PowerPoint hợp lệ.');
  const presDoc = parseXml(await pres.async('string'));
  const presRels = await readRels(zip, 'ppt/_rels/presentation.xml.rels');
  const slidePaths = all(presDoc, 'sldId').map((s) => resolvePath('ppt', presRels[rid(s)] || ''));
  const images: string[] = [];
  const textOut: string[] = [];
  const analysis: string[] = [`Số trang chiếu: ${slidePaths.length}`];
  let html = '<div class="pptx">';
  let n = 0;
  for (const path of slidePaths) {
    n++;
    const f = zip.file(path);
    if (!f) continue;
    const xml = await f.async('string');
    const doc = parseXml(xml);
    const dir = path.split('/').slice(0, -1).join('/');
    const rels = await readRels(zip, `${dir}/_rels/${path.split('/').pop()}.rels`);
    const shapes: { role: string; lines: { text: string; fmt: string }[] }[] = [];
    for (const sp of all(doc, 'sp')) {
      const ph = all(sp, 'ph')[0];
      const role = ph ? PH[attr(ph, 'type')] || 'nội dung' : 'hộp chữ';
      const lines: { text: string; fmt: string }[] = [];
      for (const p of all(sp, 'p')) {
        const t = all(p, 't').map((x) => x.textContent || '').join('');
        if (!t.trim()) continue;
        const rPr = all(p, 'rPr')[0] || null;
        const fmt = [attr(rPr, 'b') === '1' ? 'đậm' : '', attr(rPr, 'i') === '1' ? 'nghiêng' : '',
          attr(rPr, 'sz') ? `cỡ ${Number(attr(rPr, 'sz')) / 100}` : '', attr(all(p, 'latin')[0] || null, 'typeface')].filter(Boolean).join(', ');
        lines.push({ text: t, fmt });
      }
      if (lines.length) shapes.push({ role, lines });
    }
    const pics = all(doc, 'pic');
    const slideImgs: string[] = [];
    for (const pic of pics) {
      const blip = all(pic, 'blip')[0];
      const t = blip && rels[attr(blip, 'embed')];
      if (t && images.length < 8) {
        const url = await zipImage(zip, resolvePath(dir, t));
        if (url) {
          images.push(url);
          slideImgs.push(url);
        }
      }
    }
    const tables = all(doc, 'tbl').length;
    const charts = Object.values(rels).filter((t) => t.includes('chart')).length;
    const media = Object.values(rels).filter((t) => /\.(mp3|wav|m4a|mp4|wmv|mov)$/i.test(t)).length;
    const trans = all(doc, 'transition')[0];
    const transName = trans ? kids(trans).map((k) => k.localName).find((k) => !['sndAc', 'extLst'].includes(k)) || 'có' : '';
    const anim: Record<string, number> = {};
    all(doc, 'cTn').forEach((c) => {
      const cls = attr(c, 'presetClass');
      if (cls) anim[cls] = (anim[cls] || 0) + 1;
    });
    const animTxt = Object.entries(anim).map(([k, v]) => `${{ entr: 'xuất hiện', exit: 'biến mất', emph: 'nhấn mạnh', path: 'đường đi' }[k] || k}: ${v}`).join(', ');
    const hasBg = all(doc, 'bg').length > 0;

    const slideText = shapes.map((s) => s.lines.map((l) => l.text).join('\n')).join('\n');
    textOut.push(`--- Trang ${n} ---\n${slideText}`);
    analysis.push(
      `Trang ${n}: ${shapes.map((s) => `${s.role}: ${s.lines.map((l) => `"${l.text.slice(0, 80)}"${l.fmt ? ` [${l.fmt}]` : ''}`).join('; ')}`).join(' | ') || '(không có chữ)'}` +
        `; hình ảnh: ${pics.length}` + (tables ? `; bảng: ${tables}` : '') + (charts ? `; biểu đồ: ${charts}` : '') + (media ? `; âm thanh/video: ${media}` : '') +
        `; hiệu ứng chuyển trang: ${transName || 'không'}` + `; hiệu ứng động: ${animTxt || 'không'}` + (hasBg ? '; có đặt nền riêng' : '')
    );
    html += `<section class="slide"><div class="slide-no">Trang ${n}${transName ? ` · chuyển trang: ${transName}` : ''}${animTxt ? ` · hiệu ứng: ${animTxt}` : ''}</div>`;
    for (const s of shapes) {
      for (const l of s.lines) html += s.role === 'tiêu đề' ? `<h3>${escapeHtml(l.text)}</h3>` : `<p>${escapeHtml(l.text)}</p>`;
    }
    slideImgs.forEach((u) => (html += `<img class="doc-img" src="${u}" alt="">`));
    if (!shapes.length && !slideImgs.length) html += '<p class="muted">(trang trống hoặc chỉ có hình không đọc được)</p>';
    html += '</section>';
  }
  html += '</div>';
  const warnings = slidePaths.length ? [] : ['File PowerPoint không có trang chiếu.'];
  return { text: textOut.join('\n'), analysis: analysis.join('\n'), html, images: images.slice(0, 6), warnings };
}

// ---------- XLSX ----------
export type Sheet = { name: string; rows: string[][]; formulas: string[] };

export async function readXlsx(buf: ArrayBuffer): Promise<Sheet[]> {
  const zip = await JSZip.loadAsync(buf);
  const wb = zip.file('xl/workbook.xml');
  if (!wb) throw new Error('Không phải file Excel (.xlsx) hợp lệ.');
  const wbDoc = parseXml(await wb.async('string'));
  const rels = await readRels(zip, 'xl/_rels/workbook.xml.rels');
  const shared: string[] = [];
  const ss = zip.file('xl/sharedStrings.xml');
  if (ss) {
    const d = parseXml(await ss.async('string'));
    all(d, 'si').forEach((si) => shared.push(all(si, 't').map((t) => t.textContent || '').join('')));
  }
  const sheets: Sheet[] = [];
  for (const s of all(wbDoc, 'sheet')) {
    const target = rels[rid(s)];
    if (!target) continue;
    const f = zip.file(resolvePath('xl', target));
    if (!f) continue;
    const d = parseXml(await f.async('string'));
    const rows: string[][] = [];
    const formulas: string[] = [];
    for (const r of all(d, 'row')) {
      const rIdx = Number(attr(r, 'r')) - 1;
      const row: string[] = [];
      for (const c of kids(r, 'c')) {
        const ref = attr(c, 'r');
        const col = colIndex(ref.replace(/\d+/g, ''));
        const t = attr(c, 't');
        const v = kid(c, 'v')?.textContent ?? '';
        let val = v;
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = all(c, 't').map((x) => x.textContent || '').join('');
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        row[col] = val;
        const fEl = kid(c, 'f');
        if (fEl && fEl.textContent) formulas.push(`${ref}: =${fEl.textContent} → ${val}`);
      }
      rows[rIdx] = Array.from(row, (x) => x ?? '');
    }
    sheets.push({ name: attr(s, 'name'), rows: Array.from(rows, (x) => x ?? []), formulas });
  }
  return sheets;
}

function colIndex(letters: string) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function extractXlsx(buf: ArrayBuffer): Promise<Extracted> {
  const sheets = await readXlsx(buf);
  let html = '';
  const text: string[] = [];
  const analysis: string[] = [];
  for (const s of sheets) {
    const rows = s.rows.filter((r) => r.some((c) => String(c).trim()));
    text.push(`--- Trang tính ${s.name} ---\n${rows.map((r) => r.join(' | ')).join('\n')}`);
    analysis.push(`Trang tính "${s.name}": ${rows.length} hàng có dữ liệu.` + (s.formulas.length ? ` Công thức:\n${s.formulas.slice(0, 200).join('\n')}` : ' Không có công thức.'));
    html += `<h3>${escapeHtml(s.name)}</h3><table class="doc-table">${s.rows.slice(0, 300).map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(String(c))}</td>`).join('')}</tr>`).join('')}</table>`;
  }
  return { text: text.join('\n'), analysis: analysis.join('\n'), html, images: [], warnings: [] };
}
