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

export function provider() {
  const p = (process.env.AI_PROVIDER || '').toLowerCase();
  if (p) return p;
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'none';
}

function parseDataUrl(url) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(url || '');
  return m ? { mediaType: m[1], data: m[2] } : null;
}

/** Pull the first JSON object out of a model reply. */
export function extractJson(text) {
  if (!text) throw new Error('AI không trả về nội dung.');
  const cleaned = text.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI trả về sai định dạng JSON.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Call the configured model. `parts` is an array of {type:'text', text} | {type:'image', url(dataURL)}.
 * Returns the parsed JSON object.
 */
/** Giá tham khảo (USD / 1 triệu token) để app ước tính chi phí; ghi đè bằng PRICE_INPUT_PER_M / PRICE_OUTPUT_PER_M. */
const PRICES = {
  'gpt-6-astra': [10, 50],
  'gpt-6.1-sol': [2, 10],
  'gpt-6-luna': [0.1, 0.5],
  'gpt-4o': [2.5, 10],
};
export function modelName() {
  const p = provider();
  if (p === 'openai') return process.env.OPENAI_MODEL || 'gpt-6-astra';
  if (p === 'anthropic') return process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  return p;
}
export function prices() {
  const d = PRICES[modelName()] || [0, 0];
  const i = Number(process.env.PRICE_INPUT_PER_M);
  const o = Number(process.env.PRICE_OUTPUT_PER_M);
  return { input: Number.isFinite(i) && process.env.PRICE_INPUT_PER_M ? i : d[0], output: Number.isFinite(o) && process.env.PRICE_OUTPUT_PER_M ? o : d[1] };
}
/** Giới hạn cứng phía máy chủ cho mỗi lần gọi (ràng buộc chi phí). */
export const LIMITS = {
  maxOutputTokens: Number(process.env.MAX_OUTPUT_TOKENS || 12000),
  maxImages: Number(process.env.MAX_IMAGES || 6),
  maxInputChars: Number(process.env.MAX_INPUT_CHARS || 60000),
};

function attachUsage(obj, usage) {
  if (obj && typeof obj === 'object' && usage) {
    const pr = prices();
    const cost = (usage.input * pr.input + usage.output * pr.output) / 1e6;
    Object.defineProperty(obj, '_usage', { value: { ...usage, cost }, enumerable: true });
  }
  return obj;
}

/**
 * Call the configured model. `parts` is an array of {type:'text', text} | {type:'image', url(dataURL)}.
 * `schema` (JSON Schema) buộc mô hình trả đúng khuôn (Structured Outputs).
 * Returns the parsed JSON object, with `_usage` = {input, output, cost}.
 */
export async function callModel({ system, parts, maxTokens = 4000, schema, schemaName = 'ket_qua' }) {
  const p = provider();
  // ràng buộc đầu vào
  let imgs = 0;
  parts = parts.filter((x) => x.type !== 'image' || ++imgs <= LIMITS.maxImages)
    .map((x) => (x.type === 'text' ? { ...x, text: x.text.slice(0, LIMITS.maxInputChars) } : x));
  if (p === 'openai') {
    const model = modelName();
    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const legacy = /^(gpt-4|gpt-3)/i.test(model);
    const content = parts.map((x) =>
      x.type === 'image'
        ? { type: 'image_url', image_url: { url: x.url, detail: 'high' } }
        : { type: 'text', text: x.text }
    );
    const body = {
      model,
      messages: [
        { role: legacy ? 'system' : 'developer', content: system },
        { role: 'user', content },
      ],
      response_format: schema
        ? { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } }
        : { type: 'json_object' },
    };
    if (legacy) {
      body.temperature = 0;
      body.max_tokens = Math.min(maxTokens, LIMITS.maxOutputTokens);
    } else {
      // mô hình suy luận: token suy nghĩ cũng tính vào output nên cho trần cao hơn, nhưng vẫn có trần
      body.max_completion_tokens = Math.min(maxTokens * 3, LIMITS.maxOutputTokens);
      body.reasoning_effort = process.env.OPENAI_REASONING_EFFORT || 'medium';
    }
    const send = (b) => fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify(b),
    });
    let res = await send(body);
    let data = await res.json().catch(() => ({}));
    // tương thích: bỏ dần những tham số mô hình không nhận
    for (let tries = 0; !res.ok && res.status === 400 && tries < 3; tries++) {
      const msg = data?.error?.message || '';
      const param = data?.error?.param || '';
      if (/reasoning_effort/i.test(msg + param)) delete body.reasoning_effort;
      else if (/json_schema|response_format/i.test(msg + param) && body.response_format.type === 'json_schema') body.response_format = { type: 'json_object' };
      else if (/developer/i.test(msg)) body.messages[0].role = 'system';
      else if (/temperature/i.test(msg + param)) delete body.temperature;
      else break;
      res = await send(body);
      data = await res.json().catch(() => ({}));
    }
    if (!res.ok) throw new Error(data?.error?.message || `OpenAI lỗi ${res.status}`);
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error('AI dùng hết giới hạn token trước khi trả lời xong (MAX_OUTPUT_TOKENS). Thử lại, hoặc tăng giới hạn / giảm OPENAI_REASONING_EFFORT.');
    if (choice?.message?.refusal) throw new Error('AI từ chối chấm bài này: ' + choice.message.refusal);
    const u = data.usage || {};
    return attachUsage(extractJson(choice?.message?.content), { input: u.prompt_tokens || 0, output: u.completion_tokens || 0 });
  }

  if (p === 'anthropic') {
    const model = modelName();
    const content = parts.map((x) => {
      if (x.type !== 'image') return { type: 'text', text: x.text };
      const d = parseDataUrl(x.url);
      return { type: 'image', source: { type: 'base64', media_type: d.mediaType, data: d.data } };
    });
    const send = (withTemp) => fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
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
    // một số model mới không nhận tham số temperature
    if (!res.ok && /temperature/i.test(data?.error?.message || '')) {
      res = await send(false);
      data = await res.json().catch(() => ({}));
    }
    if (!res.ok) throw new Error(data?.error?.message || `Anthropic lỗi ${res.status}`);
    const u = data.usage || {};
    return attachUsage(extractJson((data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('')), { input: u.input_tokens || 0, output: u.output_tokens || 0 });
  }

  if (p === 'mock') return null; // handled by callers

  throw new Error('Chưa cấu hình AI: đặt OPENAI_API_KEY (hoặc ANTHROPIC_API_KEY) trong Environment Variables của Vercel.');
}
