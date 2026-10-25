import { api } from './api';
import { collapse, roundStep, normKey } from './util';
import type { Criterion, ErrorItem, Project, Result, Score, Student, Submission } from '../types';

type Raw = {
  scores?: { criterionId: string; score: number; reason?: string; confidence?: string }[];
  errors?: { criterionId: string; quote?: string; note?: string }[];
  comment?: string;
  needsTeacher?: boolean;
  needsTeacherReason?: string;
  reviewNote?: string;
};

export const effective = (s: Score) => (s.teacher != null ? s.teacher : s.ai);
export const totalOf = (r?: Result) => (r ? Math.round(r.scores.reduce((a, s) => a + effective(s), 0) * 100) / 100 : 0);
export const maxTotal = (rubric: Criterion[]) => Math.round(rubric.reduce((a, c) => a + Number(c.max || 0), 0) * 100) / 100;
export const isEdited = (s: Score) => s.teacher != null && s.teacher !== s.ai;

/** Find a quote in the submission text, tolerant of whitespace and case. */
export function quoteFound(text: string, quote: string) {
  if (!quote.trim()) return true;
  return collapse(text).includes(collapse(quote));
}

/** Turn a raw model answer into a checked Result; every rule here is a self-check before the teacher sees it. */
export function normalize(raw: Raw, rubric: Criterion[], step: number, sub: Submission | undefined): Pick<Result, 'scores' | 'errors' | 'comment' | 'flags' | 'reviewNote'> {
  const flags: string[] = [];
  const byId = new Map((raw.scores || []).map((s) => [String(s.criterionId), s]));
  // tolerate models that answer with the criterion name instead of the id
  const byName = new Map((raw.scores || []).map((s) => [normKey(String(s.criterionId)), s]));
  const scores: Score[] = rubric.map((c, i) => {
    const r = byId.get(c.id) || byName.get(normKey(c.name)) || (raw.scores || [])[i];
    if (!r) {
      flags.push(`AI chưa chấm tiêu chí "${c.name}" — tạm để 0.`);
      return { criterionId: c.id, ai: 0, reason: 'AI không trả điểm cho tiêu chí này.', confidence: 'thấp' };
    }
    let v = Number(r.score);
    if (Number.isNaN(v)) v = 0;
    if (v > c.max) flags.push(`Điểm "${c.name}" vượt tối đa (${v} > ${c.max}) — đã hạ xuống ${c.max}.`);
    if (v < 0) flags.push(`Điểm "${c.name}" âm — đã đặt 0.`);
    v = roundStep(Math.min(Math.max(v, 0), c.max), step);
    return { criterionId: c.id, ai: v, reason: r.reason || '', confidence: r.confidence || '' };
  });
  const validIds = new Set(rubric.map((c) => c.id));
  const errors: ErrorItem[] = (raw.errors || []).map((e) => {
    const cid = validIds.has(String(e.criterionId)) ? String(e.criterionId) : rubric.find((c) => normKey(c.name) === normKey(String(e.criterionId)))?.id || '';
    const quote = String(e.quote || '').trim();
    return { criterionId: cid, quote, note: String(e.note || ''), found: sub ? quoteFound(sub.text, quote) : false };
  });
  const notFound = errors.filter((e) => e.quote && !e.found).length;
  if (notFound) flags.push(`${notFound} đoạn trích lỗi không tìm thấy nguyên văn trong bài — kiểm tra lại.`);
  scores.forEach((s) => {
    const c = rubric.find((x) => x.id === s.criterionId)!;
    if (s.ai < c.max && !errors.some((e) => e.criterionId === s.criterionId) && !s.reason.trim()) flags.push(`Trừ điểm "${c.name}" nhưng chưa nêu lỗi.`);
    if (/thấp/i.test(s.confidence || '')) flags.push(`AI chưa chắc chắn ở tiêu chí "${c.name}".`);
  });
  if (raw.needsTeacher) flags.push(`AI đề nghị thầy/cô xem kĩ: ${raw.needsTeacherReason || 'bài khó đánh giá'}.`);
  return { scores, errors, comment: raw.comment || '', flags, reviewNote: raw.reviewNote || '' };
}

export function payloadFor(p: Project, sub: Submission, extraNote?: string) {
  return {
    exam: p.examText,
    examImages: p.examImages,
    rubric: p.rubric,
    instructions: p.instructions,
    scoreStep: p.scoreStep,
    extraNote,
    submission: { fileNames: sub.fileNames, text: sub.text, analysis: sub.analysis, images: sub.images },
  };
}

/** Grade one student: pass 1 (chấm) + pass 2 (tự rà soát), then the automatic checks. */
export async function gradeOne(p: Project, st: Student, onPhase: (phase: 'grading' | 'reviewing') => void, extraNote?: string): Promise<Result> {
  const sub = p.submissions[st.id];
  if (!sub || (!sub.text.trim() && !sub.images.length)) {
    const noFile = !p.fileMap[st.id]?.length;
    return {
      status: 'done',
      scores: p.rubric.map((c) => ({ criterionId: c.id, ai: 0, reason: noFile ? 'Không nộp bài.' : 'Không đọc được nội dung bài.', confidence: '' })),
      errors: [],
      comment: '',
      flags: [noFile ? 'Không tìm thấy bài nộp — điểm tạm 0, cần xác nhận.' : 'File bài làm không đọc được — điểm tạm 0, cần mở file kiểm tra.', ...(sub?.warnings || [])],
      checked: false,
      noSubmission: true,
      gradedAt: Date.now(),
    };
  }
  onPhase('grading');
  const base = payloadFor(p, sub, extraNote);
  // Vercel giới hạn mỗi yêu cầu ~4,5 MB: bớt ảnh nếu bài quá nặng
  const dropped: string[] = [];
  while (JSON.stringify(base).length > 3_600_000 && base.submission.images.length) {
    base.submission = { ...base.submission, images: base.submission.images.slice(0, -1) };
    dropped.push('1');
  }
  if (dropped.length) sub.warnings = [...sub.warnings, `Bài quá nặng: ${dropped.length} hình cuối không được gửi cho AI — cần xem tay phần đó.`];
  const first = await api<Raw>('grade', { ...base, mode: 'grade' });
  const firstNorm = normalize(first, p.rubric, p.scoreStep, sub);
  onPhase('reviewing');
  let final = firstNorm;
  try {
    const reviewed = await api<Raw>('grade', { ...base, mode: 'review', previous: first });
    final = normalize(reviewed, p.rubric, p.scoreStep, sub);
    const changed = p.rubric
      .map((c, i) => (firstNorm.scores[i].ai !== final.scores[i].ai ? `${c.name}: ${firstNorm.scores[i].ai} → ${final.scores[i].ai}` : ''))
      .filter(Boolean);
    if (changed.length) final.flags.push(`Khi tự rà soát AI đã sửa điểm (${changed.join('; ')}).`);
  } catch (e: any) {
    final.flags.push(`Lượt rà soát lại bị lỗi (${e.message}) — đang dùng kết quả chấm lần 1.`);
  }
  final.flags.push(...sub.warnings);
  return { status: 'done', ...final, checked: false, gradedAt: Date.now() };
}

/** Checks across the whole class after grading. */
export function classChecks(p: Project): { title: string; items: string[] }[] {
  const out: { title: string; items: string[] }[] = [];
  const done = p.students.filter((s) => p.results[s.id]?.status === 'done');
  const totals = done.map((s) => totalOf(p.results[s.id]));
  // identical submissions
  const byText: Record<string, string[]> = {};
  p.students.forEach((s) => {
    const t = p.submissions[s.id]?.text;
    if (t && t.replace(/\s/g, '').length > 80) (byText[collapse(t)] ||= []).push(s.name);
  });
  const same = Object.values(byText).filter((v) => v.length > 1).map((v) => `Bài giống hệt nhau: ${v.join(', ')}`);
  if (same.length) out.push({ title: 'Nghi trùng bài', items: same });
  const noSub = p.students.filter((s) => p.results[s.id]?.noSubmission).map((s) => s.name);
  if (noSub.length) out.push({ title: 'Không có bài / không đọc được', items: noSub });
  const errs = p.students.filter((s) => p.results[s.id]?.status === 'error').map((s) => `${s.name}: ${p.results[s.id]?.errorMsg}`);
  if (errs.length) out.push({ title: 'Chấm bị lỗi (bấm "Chấm lại")', items: errs });
  if (totals.length >= 5) {
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
    const sd = Math.sqrt(totals.reduce((a, b) => a + (b - avg) ** 2, 0) / totals.length);
    const outliers = done.filter((s) => !p.results[s.id].noSubmission && sd > 0 && Math.abs(totalOf(p.results[s.id]) - avg) > 2 * sd).map((s) => `${s.name}: ${totalOf(p.results[s.id])} điểm (trung bình lớp ${avg.toFixed(1)})`);
    if (outliers.length) out.push({ title: 'Điểm lệch xa trung bình lớp', items: outliers });
  }
  return out;
}
