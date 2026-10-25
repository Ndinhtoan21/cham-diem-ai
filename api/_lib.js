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
export async function callModel({ system, parts, maxTokens = 4000 }) {
  const p = provider();
  if (p === 'openai') {
    const model = process.env.OPENAI_MODEL || 'gpt-4o';
    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const content = parts.map((x) =>
      x.type === 'image'
        ? { type: 'image_url', image_url: { url: x.url, detail: 'high' } }
        : { type: 'text', text: x.text }
    );
    const body = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      response_format: { type: 'json_object' },
    };
    // Reasoning-style models reject a custom temperature.
    if (!/^(o\d|gpt-5)/i.test(model)) body.temperature = 0;
    if (/^(o\d|gpt-5)/i.test(model)) body.max_completion_tokens = maxTokens * 4;
    else body.max_tokens = maxTokens;
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `OpenAI lỗi ${res.status}`);
    return extractJson(data.choices?.[0]?.message?.content);
  }

  if (p === 'anthropic') {
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
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
        max_tokens: maxTokens,
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
    return extractJson((data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''));
  }

  if (p === 'mock') return null; // handled by callers

  throw new Error('Chưa cấu hình AI: đặt OPENAI_API_KEY (hoặc ANTHROPIC_API_KEY) trong Environment Variables của Vercel.');
}
