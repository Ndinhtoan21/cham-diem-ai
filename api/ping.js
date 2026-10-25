import { json, checkAuth, provider, modelName, prices, LIMITS } from './_lib.js';

export async function POST(request) {
  const denied = checkAuth(request);
  if (denied) return denied;
  const p = provider();
  return json({ ok: true, provider: p, model: modelName(), prices: prices(), limits: LIMITS, effort: process.env.OPENAI_REASONING_EFFORT || 'medium', passwordRequired: Boolean(process.env.APP_PASSWORD) });
}
