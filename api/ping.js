import { json, checkAuth, provider, modelFor, priceOf, ROUTES, LIMITS } from './_lib.js';

export async function POST(request) {
  const denied = checkAuth(request);
  if (denied) return denied;
  const p = provider();
  const routes = {};
  ROUTES.forEach((r) => { const m = modelFor(r); routes[r] = m ? { ...m, price: priceOf(m.model) } : null; });
  return json({ ok: true, provider: p, model: routes.grade?.model || p, routes, limits: LIMITS, passwordRequired: Boolean(process.env.APP_PASSWORD) });
}
