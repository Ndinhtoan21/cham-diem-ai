import { json, checkAuth, callModel, provider, priceOf, modelFor } from './_lib.js';

const SYSTEM = `Bạn là giáo viên Tin học cấp THCS chấm bài thực hành/tự luận một cách cẩn thận, công bằng và nhất quán.
Nguyên tắc:
- Chỉ chấm theo ĐỀ BÀI và TIÊU CHÍ được cung cấp, cộng với YÊU CẦU CHẤM riêng của giáo viên (ưu tiên yêu cầu của giáo viên).
- Mỗi tiêu chí cho điểm từ 0 đến điểm tối đa, làm tròn theo bước điểm được cho.
- Mọi lần trừ điểm phải có lý do cụ thể. Khi lỗi nằm ở một chỗ cụ thể trong bài, "quote" phải là đoạn TRÍCH NGUYÊN VĂN (copy đúng từng ký tự) từ phần "NỘI DUNG BÀI LÀM", ngắn gọn (tối đa khoảng 120 ký tự). Nếu lỗi là thiếu nội dung hoặc không trích được (ví dụ lỗi trong hình ảnh), để "quote" là chuỗi rỗng.
- Phần "PHÂN TÍCH ĐỊNH DẠNG" mô tả định dạng/cấu trúc file (cỡ chữ, căn lề, hiệu ứng, khối lệnh...). Dùng nó để chấm các tiêu chí về định dạng; không trích nó làm "quote".
- Không bịa nội dung không có trong bài. Nếu không chắc, đặt confidence "thấp" và needsTeacher = true.
- Nhận xét ngắn gọn, tích cực, xưng "em".

CHUẨN KIẾN THỨC (rất quan trọng):
- Chấm theo đúng phạm vi kiến thức của sách giáo khoa và lớp được ghi ở mục "PHẠM VI KIẾN THỨC", KHÔNG theo kiến thức chuyên sâu của người lớn hay chuyên gia.
- Học sinh nhỏ tuổi: câu trả lời đúng ý chính như cách SGK trình bày là ĐỦ điểm, kể cả khi diễn đạt đơn giản, bằng lời của em, không dùng thuật ngữ chuyên môn, hoặc chưa đầy đủ theo nghĩa học thuật.
- KHÔNG trừ điểm vì thiếu chi tiết, thuật ngữ hay ý nằm ngoài SGK. KHÔNG bắt lỗi những khái niệm SGK đã đơn giản hoá (ví dụ cách SGK định nghĩa thông tin, dữ liệu, mạng máy tính, thuật toán…) — cách hiểu theo SGK được coi là đúng.
- Nếu có mục "NỘI DUNG SGK THAM KHẢO", đó là chuẩn để đối chiếu: ý nào khớp với SGK thì chấm đúng; chỉ trừ điểm khi học sinh hiểu SAI so với SGK hoặc thiếu ý mà tiêu chí yêu cầu.
- Khi phân vân giữa cách hiểu chuyên sâu và cách hiểu theo SGK, luôn chọn cách hiểu theo SGK (có lợi cho học sinh) và ghi rõ trong "reason".
Trả về JSON đúng dạng:
{"scores":[{"criterionId":"...","score":0,"reason":"...","confidence":"cao|trung bình|thấp"}],
 "errors":[{"criterionId":"...","quote":"...","note":"..."}],
 "comment":"...","needsTeacher":false,"needsTeacherReason":""}`;

const REVIEW_EXTRA = `
BẠN ĐANG Ở LƯỢT RÀ SOÁT. Dưới đây là kết quả chấm lần 1. Hãy kiểm tra lại thật kĩ từng tiêu chí:
1) Điểm có đúng với tiêu chí và yêu cầu của giáo viên không, có chấm quá tay hay quá dễ không? Có lần trừ điểm nào dựa trên kiến thức vượt SGK / khắt khe hơn chuẩn của lớp không — nếu có thì trả lại điểm.
2) Mỗi "quote" có thật sự xuất hiện nguyên văn trong bài không? Nếu không, sửa lại cho đúng hoặc để rỗng.
3) Có lỗi nào bị bỏ sót, hoặc lỗi nào bị trừ sai không?
Trả về kết quả CUỐI CÙNG theo đúng định dạng JSON trên, thêm trường "reviewNote": mô tả ngắn những gì đã thay đổi so với lần 1 (chuỗi rỗng nếu giữ nguyên).`;

function buildParts(b) {
  const rubric = b.rubric
    .map((c, i) => `${i + 1}. [criterionId: ${c.id}] ${c.name} — tối đa ${c.max} điểm${c.desc ? `\n   Mô tả/hướng dẫn: ${c.desc}` : ''}`)
    .join('\n');
  const total = b.rubric.reduce((s, c) => s + Number(c.max || 0), 0);
  const sub = b.submission || {};
  let text = `PHẠM VI KIẾN THỨC: ${b.curriculum || 'Tin học 6 – bộ sách Kết nối tri thức với cuộc sống (học sinh lớp 6, 11–12 tuổi)'}\n\n`;
  if (b.textbook) text += `NỘI DUNG SGK THAM KHẢO (chuẩn để đối chiếu, do giáo viên cung cấp):\n${String(b.textbook).slice(0, 20000)}\n\n`;
  text += `ĐỀ BÀI:\n${b.exam || '(không có)'}\n\nTIÊU CHÍ CHẤM (tổng ${total} điểm, bước điểm ${b.scoreStep || 0.25}):\n${rubric}\n\nYÊU CẦU CHẤM CỦA GIÁO VIÊN:\n${b.instructions || '(không có)'}\n`;
  if (b.extraNote) text += `\nGHI CHÚ THÊM CỦA GIÁO VIÊN CHO BÀI NÀY:\n${b.extraNote}\n`;
  text += `\nTÊN FILE BÀI LÀM: ${(sub.fileNames || []).join(', ') || '(không rõ)'}\n`;
  if (sub.analysis) text += `\nPHÂN TÍCH ĐỊNH DẠNG (do hệ thống trích từ file):\n${sub.analysis.slice(0, 30000)}\n`;
  text += `\nNỘI DUNG BÀI LÀM:\n${(sub.text || '(không đọc được chữ — xem hình ảnh đính kèm nếu có)').slice(0, 40000)}\n`;
  if ((b.mode === 'review' || b.mode === 'escalate') && b.previous) text += `${REVIEW_EXTRA}\n\nKẾT QUẢ LẦN 1:\n${JSON.stringify(b.previous)}`;
  const parts = [{ type: 'text', text }];
  (b.examImages || []).slice(0, 2).forEach((url) => parts.push({ type: 'text', text: 'Hình trong đề bài:' }, { type: 'image', url }));
  (sub.images || []).slice(0, 6).forEach((url, i) => parts.push({ type: 'text', text: `Hình ${i + 1} trong bài làm:` }, { type: 'image', url }));
  return parts;
}

/** Khuôn kết quả bắt buộc: chỉ được dùng đúng mã tiêu chí của đề, độ chắc chắn trong 3 mức. */
function gradeSchema(rubric) {
  const ids = rubric.map((c) => String(c.id));
  const str = { type: 'string' };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['scores', 'errors', 'comment', 'needsTeacher', 'needsTeacherReason', 'reviewNote'],
    properties: {
      scores: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['criterionId', 'score', 'reason', 'confidence'],
          properties: { criterionId: { type: 'string', enum: ids }, score: { type: 'number' }, reason: str, confidence: { type: 'string', enum: ['cao', 'trung bình', 'thấp'] } },
        },
      },
      errors: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['criterionId', 'quote', 'note'],
          properties: { criterionId: { type: 'string', enum: ids }, quote: str, note: str },
        },
      },
      comment: str,
      needsTeacher: { type: 'boolean' },
      needsTeacherReason: str,
      reviewNote: str,
    },
  };
}

function mockGrade(b) {
  // Deterministic fake result so the interface can be tried without an API key.
  const text = b.submission?.text || '';
  let seed = 0;
  for (const ch of text.slice(0, 500)) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
  const words = text.split(/\s+/).filter((w) => w.length > 3);
  const errors = [];
  const scores = b.rubric.map((c, i) => {
    const lose = ((seed + i * 7) % 4) * (b.scoreStep || 0.25);
    const score = Math.max(0, Number(c.max) - Math.min(lose, Number(c.max)));
    if (score < c.max) {
      const w = words.length ? words[(seed + i * 13) % words.length] : '';
      errors.push({ criterionId: c.id, quote: w, note: `(Mô phỏng) Chưa đạt đầy đủ yêu cầu "${c.name}".` });
    }
    return { criterionId: c.id, score, reason: `(Mô phỏng) Chấm thử cho tiêu chí "${c.name}".`, confidence: i === 0 && seed % 3 === 0 ? 'thấp' : 'cao' };
  });
  return {
    scores,
    errors,
    comment: '(Mô phỏng) Em đã hoàn thành bài, cần chú ý thêm các lỗi được đánh dấu.',
    needsTeacher: seed % 5 === 0,
    needsTeacherReason: seed % 5 === 0 ? '(Mô phỏng) Bài có phần khó đánh giá.' : '',
    ...(b.mode === 'review' ? { reviewNote: '' } : {}),
    _usage: { input: 6000, output: 2500, cost: (6000 * priceOf('gpt-6-luna').input + 2500 * priceOf('gpt-6-luna').output) / 1e6, model: 'mock' },
  };
}

export async function POST(request) {
  const denied = checkAuth(request);
  if (denied) return denied;
  let b;
  try {
    b = await request.json();
  } catch {
    return json({ error: 'Dữ liệu gửi lên không hợp lệ.' }, 400);
  }
  if (!Array.isArray(b.rubric) || !b.rubric.length) return json({ error: 'Thiếu tiêu chí chấm.' }, 400);
  try {
    const route = b.mode === 'review' ? 'review' : b.mode === 'escalate' ? 'escalate' : 'grade';
    if (route === 'escalate' && !modelFor('escalate')) return json({ skipped: true });
    if (provider() === 'mock') {
      await new Promise((r) => setTimeout(r, 300));
      return json(mockGrade(b));
    }
    const result = await callModel({ route, system: SYSTEM, parts: buildParts(b), maxTokens: 4000, schema: gradeSchema(b.rubric), schemaName: 'ket_qua_cham' });
    return json(result);
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }
}
