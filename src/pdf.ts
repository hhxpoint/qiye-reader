import { getDocument, GlobalWorkerOptions, Util } from 'pdfjs-dist';
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { uid, type Paper, type TextBlock } from './domain';

GlobalWorkerOptions.workerSrc = workerUrl; // Vite emits a same-origin worker asset.
const MAX_BYTES = 30 * 1024 * 1024;
const encryptedMessage = 'PDF 已加密，请先提供解密后的文件。';
const suspicious = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ue000-\uf8ff\ufffd\ufffe\uffff]/u;

async function openPdf(blob: Blob, signal?: AbortSignal, strict = false) {
  signal?.throwIfAborted();
  if (blob.size > MAX_BYTES) throw new Error('PDF 大小不能超过 30 MiB。');
  const data = new Uint8Array(await blob.arrayBuffer());
  signal?.throwIfAborted();
  const task = getDocument({ data, wasmUrl: '/pdf-runtime/wasm/', cMapUrl: '/pdf-runtime/cmaps/',
    standardFontDataUrl: '/pdf-runtime/standard_fonts/', cMapPacked: true, stopAtErrors: strict });
  let disposal: Promise<void> | undefined;
  let rejectAbort!: (reason: unknown) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const destroy = () => {
    signal?.removeEventListener('abort', abort);
    return disposal ??= task.destroy().catch(() => {});
  };
  const abort = () => { rejectAbort(signal?.reason ?? new DOMException('导入已取消', 'AbortError')); void destroy(); };
  task.onPassword = () => { rejectAbort(new Error(encryptedMessage)); void destroy(); };
  const wait = <T,>(promise: Promise<T>): Promise<T> => Promise.race([promise, interrupted]);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const pdf = await wait(task.promise);
    if (pdf.numPages > 100) throw new Error('PDF 页数不能超过 100 页。');
    if (await wait(pdf.getPermissions()) !== null) throw new Error(encryptedMessage);
    return { pdf, destroy, wait };
  } catch (error) { await destroy(); throw error; }
}

/** The caller owns the document; release it with pdf.loadingTask.destroy() (v6). */
export async function loadPdf(blob: Blob, strict = false): Promise<PDFDocumentProxy> {
  return (await openPdf(blob, undefined, strict)).pdf;
}

type Line = { text: string; x: number; y: number; end: number; h: number };
function pageBlocks(items: TextItem[], viewport: PageViewport, page: number, warnings: string[]): TextBlock[] {
  const runs: Line[] = [], unplaced: string[] = [];
  let complex = false;
  for (const item of items) {
    if (!item.str.trim()) continue;
    const t = Util.transform(viewport.transform, item.transform);
    const h = Math.hypot(t[2], t[3]);
    if (![...t, item.width, h].every(Number.isFinite) || h <= 0) { unplaced.push(item.str); complex = true; continue; }
    if (item.dir !== 'ltr' || Math.abs(t[1]) > Math.abs(t[0]) * 0.1) complex = true;
    runs.push({ text: item.str, x: t[4], y: t[5], end: t[4] + Math.abs(item.width), h });
  }
  runs.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Line[][] = [];
  for (const run of runs) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - run.y) <= Math.max(2, Math.min(row[0].h, run.h) * 0.3)) row.push(run);
    else rows.push([run]);
  }
  const lines: Line[] = [];
  let splitRows = 0;
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let line: Line | undefined, segments = 0;
    for (const run of row) {
      const gap = line ? run.x - line.end : Infinity;
      if (!line || gap > Math.max(run.h * 2, viewport.width * 0.022)) {
        line = { ...run }; lines.push(line); segments++;
      } else {
        if (gap < -run.h * 0.4) complex = true;
        line.text += gap > run.h * 0.12 && !/\s$/u.test(line.text) && !/^\s/u.test(run.text) ? ' ' + run.text : run.text;
        line.end = Math.max(line.end, run.end); line.h = Math.max(line.h, run.h);
      }
    }
    if (segments > 1) splitRows++;
    if (segments > 2) complex = true;
  }
  const typical = lines.map(l => l.h).sort((a, b) => a - b)[Math.floor(lines.length / 2)] || 12;
  // Only accept a repeated central gutter; full-width lines delimit column bands.
  let ordered = lines;
  let columns: { left: Line[]; right: Line[]; spans: Line[] } | undefined;
  for (const fraction of [0.5, 0.45, 0.55, 0.4, 0.6]) {
    const cut = viewport.width * fraction;
    const left = lines.filter(l => l.end < cut - typical / 2);
    const right = lines.filter(l => l.x > cut + typical / 2);
    const spans = lines.filter(l => l.end >= cut - typical / 2 && l.x <= cut + typical / 2);
    if (left.length >= 3 && right.length >= 3 && spans.length <= lines.length * 0.2 &&
        Math.min(left[left.length - 1].y, right[right.length - 1].y) - Math.max(left[0].y, right[0].y) > typical * 2) {
      columns = { left, right, spans }; break;
    }
  }
  if (columns) {
    const { left, right, spans } = columns;
    ordered = []; let li = 0, ri = 0;
    for (const span of spans) {
      while (li < left.length && left[li].y < span.y) ordered.push(left[li++]);
      while (ri < right.length && right[ri].y < span.y) ordered.push(right[ri++]);
      ordered.push(span);
    }
    ordered = ordered.concat(left.slice(li), right.slice(ri));
    warnings.push(`第 ${page} 页疑似双栏：已保守按栏排序，请对照原文。`);
  } else if (splitRows > rows.length * 0.2) complex = true;
  if (complex) warnings.push(`第 ${page} 页疑似复杂版式（表格、多栏、重叠或非横排文字），段落和阅读顺序可能不准确。`);
  if (items.some(item => suspicious.test(item.str))) warnings.push(`第 ${page} 页检测到疑似乱码，请核对原文；自动翻译可能不可靠。`);
  const blocks: TextBlock[] = [];
  let section = `第 ${page} 页`, paragraph = '', previous: Line | undefined;
  const flush = () => {
    let rest = paragraph; paragraph = '';
    while (rest.length) {
      let cut = Math.min(1800, rest.length);
      if (rest.length > cut) {
        const boundaries = [...rest.slice(0, cut).matchAll(/[\s。！？.!?；;]/gu)];
        const boundary = boundaries[boundaries.length - 1]?.index;
        if (boundary !== undefined && boundary >= 900) cut = boundary + 1;
        if (/[\ud800-\udbff]/u.test(rest[cut - 1])) cut--;
      }
      blocks.push({ id: uid(), page, section, text: rest.slice(0, cut) });
      rest = rest.slice(cut);
    }
  };
  for (const line of ordered) {
    const heading = line.text.trim().length <= 140 && (line.h > typical * 1.25 ||
      /^(?:abstract|introduction|methods?|results?|discussion|conclusions?|references|摘要|引言|方法|结果|讨论|结论|参考文献)\s*[:：]?$/iu.test(line.text.trim()));
    if (heading || (previous && (line.y <= previous.y || line.y - previous.y > typical * 1.65 || Math.abs(line.x - previous.x) > typical))) flush();
    if (heading) section = line.text.trim();
    paragraph += (paragraph ? '\n' : '') + line.text;
    if (heading) flush();
    previous = line;
  }
  flush();
  if (unplaced.length) { section = `第 ${page} 页（坐标无法解析）`; paragraph = unplaced.join('\n'); flush(); }
  return blocks;
}

function credibleTitle(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 2 && value.length <= 240 &&
    /[\p{L}\p{N}]/u.test(value) && !suspicious.test(value) && !/[\\/]/u.test(value) &&
    !/^(?:untitled|document\d*|pdf|未命名|无标题|microsoft\s+word.*)(?:\.pdf)?$/iu.test(value.trim());
}

export async function importPdf(file: File, signal: AbortSignal, onProgress: (page: number, total: number) => void): Promise<Paper> {
  const { pdf, destroy, wait } = await openPdf(file, signal);
  const warnings = ['文字按坐标启发式组装，不保证完整还原章节、段落或阅读顺序；未进行图像 OCR。'];
  const blocks: TextBlock[] = [];
  let title = file.name.replace(/\.pdf$/iu, '') || file.name;
  try {
    try {
      const { info, metadata } = await wait(pdf.getMetadata());
      const candidate = [(info as { Title?: unknown }).Title, metadata?.get('dc:title')].find(credibleTitle);
      if (candidate) title = candidate.trim().replace(/\s+/gu, ' ');
    } catch { signal.throwIfAborted(); warnings.push('文档标题元数据无法读取，已使用文件名。'); }
    onProgress(0, pdf.numPages);
    for (let page = 1; page <= pdf.numPages; page++) {
      signal.throwIfAborted();
      const proxy = await wait(pdf.getPage(page));
      try {
        const content = await wait(proxy.getTextContent());
        const items = content.items.filter((item): item is TextItem => 'str' in item);
        const extracted = pageBlocks(items, proxy.getViewport({ scale: 1 }), page, warnings);
        for (const block of extracted) blocks.push(block);
        if (!extracted.length) warnings.push(`第 ${page} 页没有可提取文字，可能为空白或扫描页；该页不能自动翻译。`);
      } catch {
        signal.throwIfAborted();
        warnings.push(`第 ${page} 页文字提取失败，仍可阅读原始 PDF，但该页不能自动翻译。`);
      } finally { proxy.cleanup(); }
      signal.throwIfAborted();
      onProgress(page, pdf.numPages);
    }
    signal.throwIfAborted();
    if (!blocks.length) warnings.push('此 PDF 没有可提取文本，仍可阅读原始页面，但不能自动翻译；请提供含文字层的 PDF。');
    const now = Date.now();
    return { id: uid(), title, authors: '本地导入', year: String(new Date().getFullYear()), category: '未分类',
      color: 'sage', kind: 'pdf', pageCount: pdf.numPages, blocks, translations: {}, notes: [], starred: false,
      currentPage: 1, createdAt: now, updatedAt: now, warnings: warnings.length > 100 ? [...warnings.slice(0, 99), `另有 ${warnings.length - 99} 项解析提示，请逐页核对原PDF。`] : warnings };
  } finally { await destroy(); }
}
