import { json, checkAuth, provider } from './_lib.js';

export async function POST(request) {
  const denied = checkAuth(request);
  if (denied) return denied;
  const p = provider();
  const model = p === 'openai' ? process.env.OPENAI_MODEL || 'gpt-4o' : p === 'anthropic' ? process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5' : p;
  return json({ ok: true, provider: p, model, passwordRequired: Boolean(process.env.APP_PASSWORD) });
}
