// Shared helpers for the serverless functions (files starting with "_" are not routes on Vercel).

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Simple password gate so a public URL can't spend your API key. */
export function checkAuth(request) {
  const required = process.env.APP_PASSWORD;
  if (!required) return null;
  const given = request.headers.get('x-app-password') || '';
  if (given !== required) return json({ error: 'Sai mật khẩu ứng dụng.' }, 401);
  return null;
}

/** Chế độ chung: 'mock' (chạy thử không gọi AI) hoặc nhà cung cấp mặc định có khóa. */
export function provider() {
  const p = (process.env.AI_PROVIDER || '').toLowerCase();
  if (p) return p;
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.DEEPSEEK_API_KEY) return 'deepseek';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'none';
}

// ---------- Nhiều nhà cung cấp, chung một chuẩn OpenAI Chat Completions ----------
const OPENAI_COMPAT = {
  openai: { base: () => process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1', key: () => process.env.OPENAI_API_KEY, devRole: true },
  gemini: { base: () => 'https://generativelanguage.googleapis.com/v1beta/openai', key: () => process.env.GEMINI_API_KEY },
  deepseek: { base: () => 'https://api.deepseek.com', key: () => process.env.DEEPSEEK_API_KEY },
};

/** Giá tham khảo USD / 1 triệu token [vào, ra]. Ghi đè bằng PRICE_<MODEL> = "vào,ra" nếu giá đổi. */
const PRICES = {
  'gpt-6-astra': [10, 50],
  'gpt-6.1-sol': [2, 10],
  'gpt-6-luna': [0.1, 0.5],
  'gpt-4o': [2.5, 10],
  'gemini-3.8-flash': [0.75, 3.75],
  'gemini-3.6-flash': [0.75, 3.75],
  'gemini-3.5-flash-lite': [0.3, 2.5],
  'gemini-3.1-flash-lite': [0.25, 1.5],
  'gemini-3.1-pro-preview': [2, 12],
  'deepseek-flash': [0.15, 0.6],
  'deepseek-v4-pro': [0.66, 1.98],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-5-5': [2, 10],
};
export function priceOf(model) {
  const env = process.env['PRICE_' + model.toUpperCase().replace(/[^A-Z0-9]/g, '_')];
  if (env) {
    const [i, o] = env.split(',').map(Number);
    if (Number.isFinite(i) && Number.isFinite(o)) return { input: i, output: o };
  }
  const d = PRICES[model] || [0, 0];
  return { input: d[0], output: d[1] };
}

/**
 * Mô hình cho từng việc. Đặt bằng biến môi trường dạng "nhà_cung_cấp:mô_hình", ví dụ
 *   MODEL_GRADE=openai:gpt-6-luna   (chấm lượt 1)
 *   MODEL_REVIEW=gemini:gemini-3.1-flash-lite   (tự rà soát lượt 2)
 *   MODEL_ESCALATE=openai:gpt-6.1-sol   (chấm lại bằng mô hình mạnh hơn, CHỈ với bài bị cảnh báo; "off" để tắt)
 *   MODEL_RUBRIC=openai:gpt-6-luna   (tách tiêu chí)
 */
const DEFAULTS = {
  openai: { grade: 'gpt-6-luna', review: 'gpt-6-luna', escalate: 'gpt-6.1-sol', rubric: 'gpt-6-luna', ocr: 'gpt-6-luna' },
  gemini: { grade: 'gemini-3.1-flash-lite', review: 'gemini-3.1-flash-lite', escalate: 'gemini-3.8-flash', rubric: 'gemini-3.1-flash-lite', ocr: 'gemini-3.1-flash-lite' },
  deepseek: { grade: 'deepseek-flash', review: 'deepseek-flash', escalate: 'deepseek-v4-pro', rubric: 'deepseek-flash', ocr: 'deepseek-flash' },
  anthropic: { grade: 'claude-haiku-5-5', review: 'claude-haiku-5-5', escalate: 'claude-sonnet-5-5', rubric: 'claude-haiku-5-5', ocr: 'claude-haiku-5-5' },
};
export function modelFor(route) {
  const env = process.env['MODEL_' + route.toUpperCase()];
  if (env && env.toLowerCase() === 'off') return null;
  if (env && env.includes(':')) {
    const i = env.indexOf(':');
    return { provider: env.slice(0, i).trim().toLowerCase(), model: env.slice(i + 1).trim() };
  }
  const p = provider();
  if (p === 'mock' || p === 'none') return { provider: p, model: p };
  // tương thích cấu hình cũ: OPENAI_MODEL / ANTHROPIC_MODEL áp cho mọi việc trừ escalate
  if (p === 'openai' && process.env.OPENAI_MODEL && route !== 'escalate') return { provider: p, model: process.env.OPENAI_MODEL };
  if (p === 'anthropic' && process.env.ANTHROPIC_MODEL && route !== 'escalate') return { provider: p, model: process.env.ANTHROPIC_MODEL };
  return { provider: p, model: env || DEFAULTS[p]?.[route] || DEFAULTS[p]?.grade };
}
export const ROUTES = ['grade', 'review', 'escalate', 'rubric', 'ocr'];

function parseDataUrl(url) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(url || '');
  return m ? { mediaType: m[1], data: m[2] } : null;
}

/** Pull the first JSON object out of a model reply. */
export function extractJson(text) {
  if (!text) throw new Error('Không nhận được kết quả chấm.');
  const cleaned = text.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Kết quả chấm sai định dạng.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Giới hạn cứng phía máy chủ cho mỗi lần gọi (ràng buộc chi phí). */
export const LIMITS = {
  maxOutputTokens: Number(process.env.MAX_OUTPUT_TOKENS || 12000),
  maxImages: Number(process.env.MAX_IMAGES || 6),
  maxInputChars: Number(process.env.MAX_INPUT_CHARS || 60000),
};

function attachUsage(obj, usage, model) {
  if (obj && typeof obj === 'object' && usage) {
    const pr = priceOf(model);
    const cost = (usage.input * pr.input + usage.output * pr.output) / 1e6;
    Object.defineProperty(obj, '_usage', { value: { ...usage, cost, model }, enumerable: true });
  }
  return obj;
}

/**
 * Gọi mô hình cho một việc (route). `parts`: [{type:'text', text} | {type:'image', url(dataURL)}].
 * `schema` (JSON Schema) buộc mô hình trả đúng khuôn khi nhà cung cấp hỗ trợ.
 * Trả về object JSON, kèm `_usage` = {input, output, cost, model}.
 */
export async function callModel({ route = 'grade', system, parts, maxTokens = 4000, schema, schemaName = 'ket_qua' }) {
  const target = modelFor(route);
  if (!target) return null;
  const { provider: p, model } = target;
  let imgs = 0;
  parts = parts.filter((x) => x.type !== 'image' || ++imgs <= LIMITS.maxImages)
    .map((x) => (x.type === 'text' ? { ...x, text: x.text.slice(0, LIMITS.maxInputChars) } : x));

  if (OPENAI_COMPAT[p]) {
    const cfg = OPENAI_COMPAT[p];
    const key = cfg.key();
    if (!key) throw new Error(`Chưa có khóa API cho ${p} (đặt ${p.toUpperCase()}_API_KEY trên Vercel).`);
    const legacy = /^(gpt-4|gpt-3)/i.test(model);
    const content = parts.map((x) =>
      x.type === 'image' ? { type: 'image_url', image_url: { url: x.url, detail: 'high' } } : { type: 'text', text: x.text }
    );
    const body = {
      model,
      messages: [
        { role: cfg.devRole && !legacy ? 'developer' : 'system', content: system + '\nTrả lời bằng một đối tượng JSON.' },
        { role: 'user', content },
      ],
      response_format: schema && p !== 'deepseek'
        ? { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } }
        : { type: 'json_object' },
    };
    const cap = Math.min(maxTokens * 2, LIMITS.maxOutputTokens);
    if (legacy) { body.temperature = 0; body.max_tokens = cap; }
    else {
      body.max_completion_tokens = cap;
      const effort = process.env[`${p.toUpperCase()}_REASONING_EFFORT`] || process.env.REASONING_EFFORT || 'low';
      if (effort !== 'default') body.reasoning_effort = effort;
    }
    const send = (b) => fetch(`${cfg.base().replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(b),
    });
    let res = await send(body);
    let data = await res.json().catch(() => ({}));
    // tương thích: bỏ dần những tham số nhà cung cấp không nhận
    for (let tries = 0; !res.ok && res.status === 400 && tries < 4; tries++) {
      const err = Array.isArray(data) ? data[0]?.error : data?.error;
      const msg = (err?.message || '') + ' ' + (err?.param || '');
      if (/reasoning_effort/i.test(msg) && body.reasoning_effort) delete body.reasoning_effort;
      else if (/json_schema|response_format|schema/i.test(msg) && body.response_format.type === 'json_schema') body.response_format = { type: 'json_object' };
      else if (/developer/i.test(msg)) body.messages[0].role = 'system';
      else if (/max_completion_tokens/i.test(msg) && body.max_completion_tokens) { body.max_tokens = body.max_completion_tokens; delete body.max_completion_tokens; }
      else if (/temperature/i.test(msg)) delete body.temperature;
      else break;
      res = await send(body);
      data = await res.json().catch(() => ({}));
    }
    if (!res.ok) {
      const err = Array.isArray(data) ? data[0]?.error : data?.error;
      throw new Error(`${p} (${model}): ${err?.message || 'lỗi ' + res.status}`);
    }
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error(`${model} dùng hết giới hạn token trước khi trả lời xong. Thử lại, hoặc tăng MAX_OUTPUT_TOKENS.`);
    if (choice?.message?.refusal) throw new Error('Không chấm được bài này: ' + choice.message.refusal);
    const u = data.usage || {};
    return attachUsage(extractJson(choice?.message?.content), { input: u.prompt_tokens || 0, output: u.completion_tokens || 0 }, model);
  }

  if (p === 'anthropic') {
    const content = parts.map((x) => {
      if (x.type !== 'image') return { type: 'text', text: x.text };
      const d = parseDataUrl(x.url);
      return { type: 'image', source: { type: 'base64', media_type: d.mediaType, data: d.data } };
    });
    const send = (withTemp) => fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: Math.min(maxTokens, LIMITS.maxOutputTokens),
        ...(withTemp ? { temperature: 0 } : {}),
        system: system + '\nChỉ trả về đúng một đối tượng JSON, không thêm chữ nào khác.',
        messages: [{ role: 'user', content }],
      }),
    });
    let res = await send(true);
    let data = await res.json().catch(() => ({}));
    if (!res.ok && /temperature/i.test(data?.error?.message || '')) { res = await send(false); data = await res.json().catch(() => ({})); }
    if (!res.ok) throw new Error(data?.error?.message || `Anthropic lỗi ${res.status}`);
    const u = data.usage || {};
    return attachUsage(extractJson((data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('')), { input: u.input_tokens || 0, output: u.output_tokens || 0 }, model);
  }

  if (p === 'mock') return null; // handled by callers
  throw new Error('Chưa cấu hình mô hình chấm: đặt OPENAI_API_KEY (hoặc GEMINI_API_KEY / DEEPSEEK_API_KEY) trong Environment Variables của Vercel.');
}
