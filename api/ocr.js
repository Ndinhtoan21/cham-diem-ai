import { json, checkAuth, callModel, provider } from './_lib.js';

const SYSTEM = `Bạn chép lại chữ từ ảnh chụp các trang sách giáo khoa / tài liệu tiếng Việt.
- Chép NGUYÊN VĂN, đúng chính tả và dấu tiếng Việt, giữ thứ tự đọc tự nhiên (tiêu đề, đoạn, gạch đầu dòng, bảng).
- Giữ nguyên các tiêu đề như "Bài 1. ...", "Chủ đề ...", "Ghi nhớ", "Em có biết".
- Với hình minh hoạ có nội dung kiến thức (sơ đồ, bảng, ảnh màn hình phần mềm), thêm một dòng ngắn [Hình: mô tả nội dung chính]. Bỏ qua hình trang trí.
- Không thêm lời bình, không tóm tắt.
Trả về JSON: {"pages":[{"page":số_trang,"text":"..."}]} theo đúng thứ tự ảnh.`;

export async function POST(request) {
  const denied = checkAuth(request);
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const images = (b.images || []).slice(0, 4);
  const pages = b.pages || images.map((_, i) => i + 1);
  if (!images.length) return json({ error: 'Không có ảnh.' }, 400);
  try {
    if (provider() === 'mock') {
      return json({ pages: pages.map((n) => ({ page: n, text: `Bài ${n}. Nội dung trang ${n} (mô phỏng chép chữ từ ảnh)\nThông tin là những gì đem lại hiểu biết cho con người.` })), _usage: { input: 1500 * images.length, output: 600 * images.length, cost: 0 } });
    }
    const parts = [{ type: 'text', text: `Có ${images.length} ảnh, lần lượt là các trang: ${pages.join(', ')}.` }];
    images.forEach((url, i) => parts.push({ type: 'text', text: `Trang ${pages[i]}:` }, { type: 'image', url }));
    const schema = {
      type: 'object', additionalProperties: false, required: ['pages'],
      properties: { pages: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['page', 'text'], properties: { page: { type: 'number' }, text: { type: 'string' } } } } },
    };
    const out = await callModel({ route: 'ocr', system: SYSTEM, parts, maxTokens: 2500 * images.length, schema, schemaName: 'chep_chu' });
    return json(out);
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }
}
