import { json, checkAuth, callModel, provider } from './_lib.js';

const SYSTEM = `Bạn tách tiêu chí chấm điểm từ văn bản giáo viên cung cấp (có thể là bảng, danh sách, đáp án/hướng dẫn chấm).
Giữ nguyên thứ tự và cách diễn đạt của giáo viên, không tự thêm tiêu chí. Mỗi tiêu chí có điểm tối đa (số).
Nếu một tiêu chí có các ý nhỏ kèm điểm, gộp các ý nhỏ vào "desc" của tiêu chí đó.
Trả về JSON: {"criteria":[{"name":"...","max":1,"desc":"..."}],"notes":"những chỗ không rõ ràng, ví dụ tổng điểm không bằng 10 hoặc thiếu điểm"}`;

export async function POST(request) {
  const denied = checkAuth(request);
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const text = String(b.text || '').slice(0, 30000);
  if (!text.trim()) return json({ error: 'Văn bản tiêu chí trống.' }, 400);
  try {
    if (provider() === 'mock') {
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      const criteria = lines
        .map((l) => {
          const m = /(.+?)[\s|:(–-]+(\d+(?:[.,]\d+)?)\s*(?:đ|điểm)?\)?\s*$/i.exec(l);
          return m ? { name: m[1].replace(/^\d+[.)]\s*/, '').trim(), max: Number(m[2].replace(',', '.')), desc: '' } : null;
        })
        .filter(Boolean);
      return json({ criteria, notes: '(Mô phỏng) Tách theo dòng có điểm ở cuối.' });
    }
    const out = await callModel({ system: SYSTEM, parts: [{ type: 'text', text }], maxTokens: 3000 });
    return json(out);
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }
}
