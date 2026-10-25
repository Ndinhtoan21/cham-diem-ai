export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Vietnamese-insensitive key: "Nguyễn Văn Ân" -> "nguyenvanan" */
export function normKey(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function normWords(s: string): string[] {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export const roundStep = (v: number, step: number) => {
  const s = step > 0 ? step : 0.25;
  return Math.round(Math.round(v / s) * s * 100) / 100;
};

export const fmt = (n: number | null | undefined) =>
  n == null || Number.isNaN(n) ? '' : String(Math.round(n * 100) / 100).replace('.', ',');

export const escapeHtml = (s: string) =>
  (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const collapse = (s: string) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

export async function pool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>, shouldStop?: () => boolean) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      if (shouldStop?.()) return;
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export const safeFileName = (s: string) => (s || 'file').replace(/[\\/:*?"<>|]+/g, '_').trim();
