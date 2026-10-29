import { openPdf, pageText, readTeacherFile, renderPage, textQuality } from './extract';
import { api } from './api';
import { pool } from './util';
import { normWords, uid } from './util';

/**
 * SGK theo khối lớp. Cả cuốn sách quá dài để gửi cho AI mỗi lần chấm, nên sách được
 * tách thành từng bài; khi chấm, app chọn các bài liên quan nhất tới đề + tiêu chí
 * (giáo viên có thể chọn lại) và chỉ gửi phần đó.
 */
export type Lesson = { id: string; no: number; title: string; text: string };
export type Textbook = { id: string; grade: string; subject: string; name: string; fileNames: string[]; lessons: Lesson[]; chars: number; createdAt: number };

/** "6A1" → "6", "Lớp 7/2" → "7" */
export const gradeOf = (className: string) => /(\d{1,2})/.exec(className || '')?.[1] || '';

const HEAD = /(?:^|[\n\r]|\s{2,}|---\s*)B[ÀA]I\s+(\d{1,2})\s*[.:\-–]?\s*([^\n]{2,90})/giu;

/** Tách văn bản cả cuốn sách thành các bài "Bài 1 …", "Bài 2 …". */
export function splitLessons(text: string): Lesson[] {
  const clean = text.replace(/\r/g, '');
  const marks: { at: number; no: number; title: string }[] = [];
  for (const m of clean.matchAll(HEAD)) {
    const no = Number(m[1]);
    if (no < 1 || no > 40) continue;
    const title = m[2].replace(/\s+\d{1,3}\s*$/, '').replace(/[.…\s]{3,}.*$/, '').trim();
    marks.push({ at: m.index!, no, title });
  }
  if (marks.length < 3) {
    // không nhận ra tiêu đề bài: chia theo đoạn ~5000 ký tự (theo trang nếu có)
    const out: Lesson[] = [];
    const pages = clean.split(/\n?--- Trang (\d+) ---\n?/);
    let buf = '', from = 1, i = 1;
    const flush = (to: number) => { if (buf.trim()) out.push({ id: uid(), no: out.length + 1, title: `Phần ${out.length + 1}${to ? ` (trang ${from}–${to})` : ''}`, text: buf.trim() }); buf = ''; };
    if (pages.length > 1) {
      for (let k = 1; k < pages.length; k += 2) {
        const pg = Number(pages[k]);
        if (!buf) from = pg;
        buf += pages[k + 1] + '\n';
        if (buf.length > 5000) flush(pg);
        i = pg;
      }
      flush(i);
    } else {
      for (let k = 0; k < clean.length; k += 5000) { buf = clean.slice(k, k + 5000); flush(0); }
    }
    return out;
  }
  // mỗi đoạn từ tiêu đề này tới tiêu đề kế tiếp thuộc về bài đó; mục lục và tiêu đề trang
  // lặp lại tạo ra các đoạn ngắn — gộp theo số bài, đặt tên theo đoạn dài nhất.
  const byNo = new Map<number, { parts: string[]; title: string; best: number }>();
  marks.forEach((mk, i) => {
    const seg = clean.slice(mk.at, i + 1 < marks.length ? marks[i + 1].at : clean.length).trim();
    const e = byNo.get(mk.no) || { parts: [], title: mk.title, best: 0 };
    e.parts.push(seg);
    if (seg.length > e.best) { e.best = seg.length; e.title = mk.title; }
    byNo.set(mk.no, e);
  });
  return [...byNo.entries()].sort((a, b) => a[0] - b[0]).map(([no, e]) => {
    const parts = e.parts.length > 1 ? e.parts.filter((x) => x.length >= 200) : e.parts;
    return { id: uid(), no, title: `Bài ${no}. ${e.title}`, text: (parts.length ? parts : e.parts).join('\n') };
  }).filter((l) => l.text.length > 80);
}

export type Progress = (msg: string) => void;

/**
 * Đọc SGK dạng PDF theo từng trang. Trang có chữ tốt thì lấy chữ; trang scan hoặc lỗi phông
 * (thường gặp với PDF tiếng Việt) thì chụp lại thành ảnh và nhờ mô hình chép chữ (rẻ, ~vài xu cả cuốn).
 */
async function readPdfBook(file: File, onProgress: Progress, warnings: string[]): Promise<{ text: string; ocrPages: number; cost: number }> {
  const pdf = await openPdf(await file.arrayBuffer());
  const n = pdf.numPages;
  const texts: string[] = new Array(n).fill('');
  const need: number[] = [];
  for (let i = 1; i <= n; i++) {
    const t = await pageText(await pdf.getPage(i));
    if (textQuality(t, true) === 'good') texts[i - 1] = t;
    else need.push(i);
    if (i % 10 === 0) onProgress(`Đang đọc chữ ${file.name}: trang ${i}/${n}…`);
  }
  let cost = 0, done = 0, failed = 0;
  if (need.length) {
    onProgress(`${need.length}/${n} trang không có chữ đọc được (bản scan / lỗi phông) — đang chép chữ từ ảnh…`);
    const batches: number[][] = [];
    for (let i = 0; i < need.length; i += 3) batches.push(need.slice(i, i + 3));
    await pool(batches, 3, async (pages) => {
      try {
        const images: string[] = [];
        for (const pg of pages) { const u = await renderPage(await pdf.getPage(pg), 1300, 0.72); if (u) images.push(u); }
        const r = await api<{ pages: { page: number; text: string }[]; _usage?: { cost: number } }>('ocr', { images, pages });
        cost += r._usage?.cost || 0;
        (r.pages || []).forEach((x, k) => { const pg = pages.includes(Number(x.page)) ? Number(x.page) : pages[k]; if (pg) texts[pg - 1] = x.text || ''; });
      } catch (e: any) {
        failed += pages.length;
        if (failed === pages.length) warnings.push(`Lỗi khi chép chữ từ ảnh: ${e.message}`);
      }
      done += pages.length;
      onProgress(`Đang chép chữ từ ảnh: ${done}/${need.length} trang…`);
    });
    if (failed) warnings.push(`${failed} trang chưa chép được chữ — có thể tải lại SGK để thử lại.`);
  }
  return { text: texts.map((t, i) => `--- Trang ${i + 1} ---\n${t}`).join('\n'), ocrPages: need.length - failed, cost };
}

export async function readTextbookFiles(files: File[], grade: string, subject = 'Tin học', onProgress: Progress = () => {}): Promise<{ book: Textbook; warnings: string[] }> {
  const warnings: string[] = [];
  let all = '';
  for (const f of files) {
    if (/\.pdf$/i.test(f.name)) {
      const r = await readPdfBook(f, onProgress, warnings);
      if (r.ocrPages) warnings.unshift(`${f.name}: ${r.ocrPages} trang được chép chữ từ ảnh${r.cost ? ` (chi phí ~$${r.cost.toFixed(3)})` : ''}.`);
      all += (all ? '\n' : '') + r.text;
    } else {
      onProgress(`Đang đọc ${f.name}…`);
      const r = await readTeacherFile(f);
      if (!r.text.trim()) warnings.push(`Không đọc được chữ trong ${f.name}.`);
      all += (all ? '\n' : '') + r.text;
    }
  }
  const lessons = splitLessons(all);
  if (all.trim() && lessons.length && !/^Bài/.test(lessons[0].title)) warnings.push('Không nhận ra tiêu đề “Bài 1, Bài 2…” trong sách — đã chia theo đoạn. Vẫn dùng được nhưng chọn bài sẽ kém chính xác hơn.');
  if (!lessons.length) warnings.push('Không lấy được nội dung nào từ file SGK.');
  return {
    book: { id: uid(), grade, subject, name: `${subject} ${grade}`, fileNames: files.map((f) => f.name), lessons, chars: all.length, createdAt: Date.now() },
    warnings,
  };
}

// ---------- chọn bài liên quan ----------
const STOP = new Set('va la cua cac nhung mot co cho trong khi de duoc voi nay do thi hay em hoc sinh bai bang hoac nhu tren duoi ra vao lam theo cau diem tieu chi chi neu sau truoc khong phai cung'.split(' '));
const terms = (s: string) => normWords(s).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
const bigrams = (w: string[]) => w.slice(1).map((x, i) => w[i] + '_' + x);

export function rankLessons(book: Textbook, query: string): { lesson: Lesson; score: number }[] {
  const q = terms(query);
  const qset = new Set([...q, ...bigrams(q)]);
  if (!qset.size) return book.lessons.map((lesson) => ({ lesson, score: 0 }));
  const docs = book.lessons.map((l) => { const w = terms(l.title + ' ' + l.title + ' ' + l.text); return new Set([...w, ...bigrams(w)]); });
  const df = new Map<string, number>();
  docs.forEach((d) => qset.forEach((t) => d.has(t) && df.set(t, (df.get(t) || 0) + 1)));
  const N = docs.length;
  return book.lessons.map((lesson, i) => {
    let score = 0;
    qset.forEach((t) => { if (docs[i].has(t)) score += Math.log(1 + N / (df.get(t) || 1)) * (t.includes('_') ? 2 : 1); });
    // nhắc thẳng "Bài 5" trong đề
    if (new RegExp(`\\bbai\\s*${lesson.no}\\b`).test(normWords(query).join(' '))) score += 50;
    return { lesson, score };
  }).sort((a, b) => b.score - a.score);
}

export const SGK_BUDGET = 18000;

/** Tự chọn bài liên quan nhất, trong giới hạn ký tự gửi cho AI. */
export function autoPick(book: Textbook, query: string, budget = SGK_BUDGET): string[] {
  const ranked = rankLessons(book, query).filter((x) => x.score > 0);
  if (!ranked.length) return [];
  const top = ranked[0].score;
  const out: string[] = [];
  let used = 0;
  for (const r of ranked) {
    if (r.score < top * 0.35 || out.length >= 4) break;
    if (used + Math.min(r.lesson.text.length, budget) > budget && out.length) break;
    out.push(r.lesson.id);
    used += r.lesson.text.length;
  }
  return out;
}

export function contextFor(book: Textbook, ids: string[], budget = SGK_BUDGET): string {
  const per = Math.floor(budget / Math.max(1, ids.length));
  return ids.map((id) => book.lessons.find((l) => l.id === id)).filter(Boolean)
    .map((l) => `### ${l!.title}\n${l!.text.slice(0, per)}`).join('\n\n');
}
