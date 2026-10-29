import * as pdfjs from 'pdfjs-dist';
import { extractDocx, extractPptx, extractXlsx, downscale, type Extracted } from './ooxml';
import { extractSb3 } from './sb3';
import { escapeHtml } from './util';
import type { FileKind, Submission } from '../types';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
export { pdfjs };

const TEXT_EXT = ['txt', 'py', 'c', 'cpp', 'h', 'java', 'js', 'ts', 'html', 'htm', 'css', 'pas', 'pp', 'sql', 'md', 'json', 'csv', 'xml', 'sb', 'vb', 'cs'];
const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'heic'];

export function kindOf(name: string): FileKind {
  const ext = name.split('.').pop()!.toLowerCase();
  if (ext === 'docx') return 'docx';
  if (ext === 'pptx') return 'pptx';
  if (ext === 'sb3') return 'sb3';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx';
  if (IMG_EXT.includes(ext)) return 'image';
  if (TEXT_EXT.includes(ext)) return 'text';
  return 'unsupported';
}

export const isJunkFile = (path: string) => {
  const base = path.split('/').pop() || '';
  return base.startsWith('.') || base.startsWith('~$') || base === 'Thumbs.db' || base === 'desktop.ini';
};

// pdf.js cần bảng mã chữ (cmaps), phông chuẩn và bộ giải mã ảnh (wasm) để đọc đúng PDF tiếng Việt và PDF scan
const PDF_OPTS = { cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/', iccUrl: '/pdfjs/iccs/' };
export const openPdf = (buf: ArrayBuffer) => pdfjs.getDocument({ data: new Uint8Array(buf), ...PDF_OPTS } as any).promise;

export async function pageText(page: any): Promise<string> {
  const tc = await page.getTextContent();
  let s = '';
  for (const it of tc.items as any[]) s += it.str + (it.hasEOL ? '\n' : ' ');
  return s.replace(/[ \t]+\n/g, '\n').trim();
}

const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/gi;
/** Chữ trích ra có dùng được không: rỗng (bản scan), lỗi phông (ký tự rác) hay tốt. */
export function textQuality(t: string, vietnamese = false): 'good' | 'empty' | 'garbled' {
  const s = t.replace(/\s/g, '');
  if (s.length < 25) return 'empty';
  const ok = (s.match(/[\p{L}\p{N}.,;:!?()[\]{}\-–—"'“”‘’%/+=*<>_#&@…·•]/gu) || []).length;
  if (s.includes('\uFFFD') || ok / s.length < 0.85) return 'garbled';
  if (vietnamese && s.length > 150 && (t.match(VI) || []).length / s.length < 0.03) return 'garbled';
  return 'good';
}

const IMG_OPS = () => new Set([(pdfjs as any).OPS.paintImageXObject, (pdfjs as any).OPS.paintInlineImageXObject, (pdfjs as any).OPS.paintImageXObjectRepeat].filter((x) => x != null));
export async function pageImageCount(page: any): Promise<number> {
  try {
    const ops = await page.getOperatorList();
    const set = IMG_OPS();
    return ops.fnArray.filter((f: number) => set.has(f)).length;
  } catch { return 0; }
}

export async function renderPage(page: any, maxW = 1400, quality = 0.8): Promise<string | null> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2.2, maxW / base.width);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width);
  c.height = Math.round(vp.height);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvas: c, canvasContext: ctx, viewport: vp } as any).promise;
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', quality));
  return downscale(blob, maxW, quality);
}

const MAX_PDF_IMAGES = 6;

/** Bài làm PDF: lấy chữ, và chụp lại các trang có hình / trang scan để hệ thống "nhìn" được. */
async function extractPdf(buf: ArrayBuffer): Promise<Extracted> {
  const pdf = await openPdf(buf);
  const info: { text: string; q: ReturnType<typeof textQuality>; imgs: number }[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const text = await pageText(page);
    info.push({ text, q: textQuality(text), imgs: await pageImageCount(page) });
  }
  // ưu tiên trang không có chữ đọc được, rồi tới trang có hình
  const need = info.map((x, i) => ({ i, pri: x.q !== 'good' ? 0 : x.imgs ? 1 : 9 })).filter((x) => x.pri < 9).sort((a, b) => a.pri - b.pri || a.i - b.i);
  const rendered = new Map<number, string>();
  for (const { i } of need.slice(0, MAX_PDF_IMAGES)) {
    const url = await renderPage(await pdf.getPage(i + 1), 1400, 0.8);
    if (url) rendered.set(i, url);
  }
  const warnings: string[] = [];
  const bad = info.filter((x) => x.q !== 'good').length;
  if (bad) warnings.push(`${bad}/${pdf.numPages} trang PDF không có chữ đọc được (bản scan hoặc lỗi phông) — đọc qua hình, cần kiểm tra kĩ hơn.`);
  if (need.length > MAX_PDF_IMAGES) warnings.push(`PDF có ${need.length} trang cần đọc qua hình, chỉ chụp ${MAX_PDF_IMAGES} trang đầu (trang ${need.slice(MAX_PDF_IMAGES).map((x) => x.i + 1).join(', ')} chưa được xem).`);
  const text = info.map((x, i) => (x.q === 'good' ? `--- Trang ${i + 1} ---\n${x.text}` : `--- Trang ${i + 1} --- (xem hình${rendered.has(i) ? ` trang ${i + 1}` : ' — chưa chụp'})`)).join('\n');
  const html = info.map((x, i) => `<section class="slide"><div class="slide-no">Trang ${i + 1}${x.imgs ? ` · ${x.imgs} hình` : ''}</div>${x.q === 'good' ? `<p class="pre">${escapeHtml(x.text)}</p>` : ''}${rendered.has(i) ? `<img class="doc-img" src="${rendered.get(i)}" alt="Trang ${i + 1}">` : ''}</section>`).join('');
  const analysis = `PDF ${pdf.numPages} trang.` + (rendered.size ? ` Đã chụp hình các trang: ${[...rendered.keys()].map((i) => i + 1).join(', ')} (gửi kèm dưới dạng hình theo thứ tự này).` : '') + (info.some((x) => x.imgs) ? ` Trang có hình ảnh: ${info.map((x, i) => (x.imgs ? `${i + 1} (${x.imgs} hình)` : '')).filter(Boolean).join(', ')}.` : '');
  return { text: info.some((x) => x.q === 'good') ? text : '', analysis, html, images: [...rendered.values()], warnings };
}

async function extractOne(file: File): Promise<Extracted> {
  const kind = kindOf(file.name);
  const buf = await file.arrayBuffer();
  switch (kind) {
    case 'docx': return extractDocx(buf);
    case 'pptx': return extractPptx(buf);
    case 'sb3': return extractSb3(buf);
    case 'xlsx': return extractXlsx(buf);
    case 'pdf': return extractPdf(buf);
    case 'image': {
      const url = await downscale(file, 1600, 0.85);
      if (!url) return { text: '', analysis: '', html: '', images: [], warnings: [`Không mở được ảnh ${file.name} (định dạng HEIC/ảnh lỗi?).`] };
      return { text: '', analysis: 'Bài làm dạng ảnh.', html: `<img class="doc-img" src="${url}" alt="">`, images: [url], warnings: [] };
    }
    case 'text': {
      const t = new TextDecoder('utf-8').decode(buf);
      return { text: t, analysis: `File văn bản/mã nguồn ${file.name}, ${t.split('\n').length} dòng.`, html: `<pre class="code">${escapeHtml(t)}</pre>`, images: [], warnings: [] };
    }
    default: {
      const ext = file.name.split('.').pop()!.toLowerCase();
      const hint = ext === 'doc' ? ' Hãy lưu lại dưới dạng .docx.' : ext === 'ppt' ? ' Hãy lưu lại dưới dạng .pptx.' : ext === 'sb2' ? ' Hãy mở bằng Scratch 3 rồi lưu .sb3.' : '';
      return { text: '', analysis: '', html: '', images: [], warnings: [`Chưa đọc được định dạng .${ext} (${file.name}).${hint}`] };
    }
  }
}

/** Read all files of one student into one Submission. */
export async function buildSubmission(files: File[]): Promise<Submission> {
  const sub: Submission = { fileNames: [], kinds: [], text: '', analysis: '', html: '', images: [], warnings: [] };
  const texts: string[] = [];
  const analyses: string[] = [];
  for (const f of files) {
    sub.fileNames.push(f.name);
    sub.kinds.push(kindOf(f.name));
    try {
      const e = await extractOne(f);
      const head = files.length > 1 ? `##### FILE: ${f.name} #####\n` : '';
      if (e.text) texts.push(head + e.text);
      if (e.analysis) analyses.push(head + e.analysis);
      sub.html += (files.length > 1 ? `<div class="file-head">${escapeHtml(f.name)}</div>` : '') + e.html;
      sub.images.push(...e.images);
      sub.warnings.push(...e.warnings);
      if (f.size === 0) sub.warnings.push(`File ${f.name} rỗng (0 byte).`);
    } catch (err: any) {
      sub.warnings.push(`Lỗi khi đọc ${f.name}: ${err?.message || err}. File có thể bị hỏng.`);
    }
  }
  sub.text = texts.join('\n\n');
  sub.analysis = analyses.join('\n\n');
  sub.images = sub.images.slice(0, 6);
  return sub;
}

/** Text + images of a teacher-provided file (đề / tiêu chí). */
export async function readTeacherFile(file: File): Promise<{ text: string; images: string[] }> {
  const e = await extractOne(file);
  return { text: e.text || '', images: e.images.slice(0, 2) };
}
