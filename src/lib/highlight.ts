const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Wrap each quote found in `root` with <mark class="err" data-err="i">.
 * Matching ignores case and differences in whitespace, and can span several text nodes.
 * Returns the set of quote indexes that were found.
 */
export function applyHighlights(root: HTMLElement, quotes: { idx: number; quote: string; active?: boolean }[]): Set<number> {
  const found = new Set<number>();
  for (const q of quotes) {
    const quote = q.quote.trim();
    if (quote.length < 2) continue;
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode as Text;
      if (!(n.parentElement && n.parentElement.closest('mark.err'))) nodes.push(n);
    }
    const starts: number[] = [];
    let full = '';
    for (const n of nodes) {
      starts.push(full.length);
      full += n.data;
    }
    const re = new RegExp(escRe(quote).replace(/\s+/g, '\\s+'), 'i');
    const m = re.exec(full);
    if (!m) continue;
    found.add(q.idx);
    const s = m.index;
    const e = s + m[0].length;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const ns = starts[i];
      const node = nodes[i];
      const ne = ns + node.data.length;
      if (ne <= s || ns >= e) continue;
      const ls = Math.max(0, s - ns);
      const le = Math.min(node.data.length, e - ns);
      const mid = ls > 0 ? node.splitText(ls) : node;
      if (le - ls < mid.data.length) mid.splitText(le - ls);
      const mark = document.createElement('mark');
      mark.className = 'err' + (q.active ? ' active' : '');
      mark.dataset.err = String(q.idx);
      mid.parentNode!.insertBefore(mark, mid);
      mark.appendChild(mid);
    }
  }
  return found;
}
