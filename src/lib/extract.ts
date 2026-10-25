import * as pdfjs from 'pdfjs-dist';
import { extractDocx, extractPptx, extractXlsx, downscale, type Extracted } from './ooxml';
import { extractSb3 } from './sb3';
import { escapeHtml } from './util';
import type { FileKind, Submission } from '../types';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

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

async function extractPdf(buf: ArrayBuffer): Promise<Extracted> {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    let s = '';
    for (const it of tc.items as any[]) s += it.str + (it.hasEOL ? '\n' : ' ');
    pages.push(s.trim());
  }
  const text = pages.map((p, i) => `--- Trang ${i + 1} ---\n${p}`).join('\n');
  const totalChars = pages.join('').replace(/\s/g, '').length;
  const images: string[] = [];
  const warnings: string[] = [];
  let html = pages.map((p, i) => `<section class="slide"><div class="slide-no">Trang ${i + 1}</div><p class="pre">${escapeHtml(p)}</p></section>`).join('');
  if (totalChars < 40 * pdf.numPages) {
    // Probably a scan: render pages as images so the AI can read them.
    warnings.push('PDF gần như không có chữ (có thể là bản scan) — AI sẽ đọc qua hình ảnh, cần kiểm tra kĩ hơn.');
    html = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1.6 });
      const c = document.createElement('canvas');
      c.width = vp.width;
      c.height = vp.height;
      await page.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: vp } as any).promise;
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.85));
      const url = await downscale(blob, 1600);
      if (url) {
        images.push(url);
        html += `<img class="doc-img" src="${url}" alt="Trang ${i}">`;
      }
    }
    if (pdf.numPages > 5) warnings.push(`PDF có ${pdf.numPages} trang, chỉ gửi 5 trang đầu cho AI.`);
  }
  return { text: totalChars < 40 * pdf.numPages ? '' : text, analysis: `PDF ${pdf.numPages} trang.`, html, images, warnings };
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
