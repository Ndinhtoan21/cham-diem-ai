import { getSetting } from './store';

export async function api<T = any>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-app-password': getSetting('password') },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `Máy chủ lỗi ${res.status}` }));
  if (!res.ok) {
    const err = new Error(data.error || `Lỗi ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}
