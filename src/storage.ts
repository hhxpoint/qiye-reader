import type { Paper } from './domain';

type Backup = { version: 1; papers: Paper[]; files: { id: string; type: string; base64: string }[]; settings: Record<string, unknown> };
const MAX_READ = 100 * 1024 * 1024, MAX_PDF = 80 * 1024 * 1024;
const STORES = ['papers', 'files', 'settings'];
function check(ok: unknown, message = '字段类型、长度或取值不合法'): asserts ok {
  if (!ok) throw new Error(`备份无效：${message}。`);
}
function key(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 128 && !/[\u0000-\u001f]/.test(v) && !['__proto__', 'prototype', 'constructor'].includes(v);
}
function object(v: unknown, fields?: string): asserts v is Record<string, unknown> {
  check(v !== null && typeof v === 'object' && !Array.isArray(v) && [null, Object.prototype].includes(Object.getPrototypeOf(v)));
  check(Reflect.ownKeys(v).every(k => key(k) && (!fields || fields.split(' ').includes(k))), '存在未知或不安全的字段');
}
function text(v: unknown, max = 1_000_000, min = 0): asserts v is string { check(typeof v === 'string' && v.length >= min && v.length <= max); }
function integer(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): asserts v is number { check(typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max); }
function list(v: unknown, max: number): asserts v is unknown[] { check(Array.isArray(v) && v.length <= max, '列表类型错误或数量超限'); }
function strings(v: unknown) { list(v, 100); for (const s of v) text(s, 4096); }
function unique(v: unknown, seen: Set<string>): asserts v is string { check(key(v) && !seen.has(v), 'ID 无效或重复'); seen.add(v); }
function settings(v: unknown) {
  object(v); check(Object.keys(v).length <= 100, '设置数量超限');
  let budget = 20_000;
  function json(x: unknown, depth = 0): void {
    check(--budget >= 0 && depth <= 8, '设置过多或嵌套过深');
    if (x === null || typeof x === 'boolean') return;
    if (typeof x === 'string') { text(x, 100_000); return; }
    if (typeof x === 'number') { check(Number.isFinite(x)); return; }
    if (Array.isArray(x)) { list(x, 5000); for (const item of x) json(item, depth + 1); }
    else { object(x); check(Object.keys(x).length <= 1000); for (const item of Object.values(x)) json(item, depth + 1); }
  }
  json(v);
  if ('preferences' in v) {
    const p = v.preferences; object(p, 'engine fontSize reduceMotion');
    check(p.engine === 'local' || p.engine === 'browser', '翻译引擎不合法'); integer(p.fontSize, 10, 40); check(typeof p.reduceMotion === 'boolean');
  }
  if ('terms' in v) {
    list(v.terms, 300); const ids = new Set<string>();
    for (const t of v.terms) { object(t, 'id source target'); unique(t.id, ids); text(t.source, 80, 1); text(t.target, 120, 1); }
  }
  if ('initialized' in v) check(typeof v.initialized === 'boolean');
  if ('lastPaper' in v) text(v.lastPaper, 128);
}
// 纯校验：不执行、不渲染导入字符串，不解码 PDF，也不访问 IndexedDB。
export function validateBackup(value: unknown): Backup {
  object(value, 'version papers files settings'); check(value.version === 1, '仅支持版本 1');
  list(value.papers, 2000); list(value.files, 2000); settings(value.settings);
  const paperIds = new Set<string>(), pdfIds = new Set<string>(); let blockTotal = 0;
  for (const p of value.papers) {
    object(p, 'id title authors year category color kind pageCount blocks translations notes starred currentPage createdAt updatedAt warnings sample sourceUrl');
    unique(p.id, paperIds); text(p.title, 2000, 1); text(p.authors, 4000); text(p.year, 32); text(p.category, 128);
    check(['sage', 'clay', 'lavender', 'sand'].includes(p.color as string), '文献颜色不合法');
    check(p.kind === 'pdf' || p.kind === 'text', '文献类型不合法'); if (p.kind === 'pdf') pdfIds.add(p.id);
    integer(p.pageCount, 1, 10_000); integer(p.currentPage, 1, p.pageCount); integer(p.createdAt); integer(p.updatedAt);
    check(typeof p.starred === 'boolean'); strings(p.warnings);
    if ('sample' in p) check(typeof p.sample === 'boolean');
    if ('sourceUrl' in p) text(p.sourceUrl, 2048);
    list(p.blocks, 20_000); blockTotal += p.blocks.length; check(blockTotal <= 200_000, '段落总数超限');
    const blocks = new Set<string>(), notes = new Set<string>();
    for (const b of p.blocks) { object(b, 'id page text section'); unique(b.id, blocks); integer(b.page, 1, p.pageCount); text(b.text); text(b.section, 2000); }
    object(p.translations);
    for (const [id, t] of Object.entries(p.translations)) {
      check(blocks.has(id), '翻译必须对应本文段落'); object(t, 'text engine createdAt issues');
      text(t.text); text(t.engine, 128, 1); integer(t.createdAt); strings(t.issues);
    }
    list(p.notes, 10_000);
    for (const n of p.notes) {
      object(n, 'id blockId text quote createdAt'); unique(n.id, notes); text(n.text, 100_000); integer(n.createdAt);
      if ('quote' in n) text(n.quote, 100_000);
      if ('blockId' in n) check(key(n.blockId) && blocks.has(n.blockId), '批注必须对应本文段落');
    }
  }
  const fileIds = new Set<string>(); let bytes = 0;
  for (const f of value.files) {
    object(f, 'id type base64'); unique(f.id, fileIds); check(pdfIds.has(f.id), '文件必须对应 PDF 文献');
    check(f.type === 'application/pdf', '文件类型必须为 PDF'); check(typeof f.base64 === 'string', 'PDF 编码不合法');
    const s = f.base64, padding = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
    bytes += s.length / 4 * 3 - padding; check(bytes <= MAX_PDF, '原始 PDF 总量不能超过 80MB');
    check(s.length >= 4 && s.length % 4 === 0 && !/[^A-Za-z0-9+/]/.test(s.slice(0, s.length - padding)), 'PDF Base64 编码不合法');
    const last = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(s[s.length - padding - 1]);
    check(!padding || (last & (padding === 2 ? 15 : 3)) === 0, 'PDF Base64 填充不合法');
  }
  return value as Backup;
}
function storageError(cause: unknown) {
  return new Error(cause instanceof DOMException && cause.name === 'QuotaExceededError' ? '本地存储空间不足，请释放空间后重试。' : '本地资料操作失败，请检查浏览器存储权限或关闭其他阅读器页面后重试。', { cause });
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('当前环境不支持本地数据库，请使用支持 IndexedDB 的浏览器。')); return; }
    let request: IDBOpenDBRequest, blocked = false;
    try { request = indexedDB.open('qiye-library-v1', 1); } catch (e) { reject(storageError(e)); return; }
    request.onupgradeneeded = () => {
      for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: name === 'settings' ? 'key' : 'id' });
    };
    request.onblocked = () => { blocked = true; reject(new Error('数据库被其他页面占用，请关闭其他阅读器页面后重试。')); };
    request.onerror = () => reject(storageError(request.error));
    request.onsuccess = () => {
      const db = request.result; db.onversionchange = () => db.close();
      if (blocked) db.close(); else resolve(db);
    };
  });
}
// work 只能同步排入请求；结果只在 complete 后读取，任何失败均回滚。
async function transaction<T>(names: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => () => T): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction, result: () => T, failure: unknown;
    try { tx = db.transaction(names, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined); } catch (e) { db.close(); reject(storageError(e)); return; }
    tx.oncomplete = () => { db.close(); try { resolve(result()); } catch (e) { reject(storageError(e)); } };
    tx.onerror = tx.onabort = event => { db.close(); reject(storageError(failure ?? (event.target as IDBRequest | IDBTransaction).error ?? tx.error)); };
    try { result = work(tx); } catch (e) { failure = e; tx.abort(); }
  });
}
export function getPapers(): Promise<Paper[]> {
  return transaction(['papers'], 'readonly', tx => { const r = tx.objectStore('papers').getAll(); return () => r.result; });
}
export async function savePaper(paper: Paper, file?: Blob): Promise<void> {
  validateBackup({ version: 1, papers: [paper], files: [], settings: {} });
  if (file !== undefined) check(file instanceof Blob && paper.kind === 'pdf' && (!file.type || file.type === 'application/pdf') && file.size > 0, '只能保存非空 PDF 文件');
  return transaction(['papers', 'files'], 'readwrite', tx => {
    tx.objectStore('papers').put(paper);
    if (file !== undefined) tx.objectStore('files').put({ id: paper.id, blob: file });
    else if (paper.kind === 'text') tx.objectStore('files').delete(paper.id);
    return () => undefined;
  });
}
export function deletePaper(id: string): Promise<void> {
  return transaction(['papers', 'files'], 'readwrite', tx => { for (const name of ['papers', 'files']) tx.objectStore(name).delete(id); return () => undefined; });
}
export function getFile(id: string): Promise<Blob | undefined> {
  return transaction(['files'], 'readonly', tx => { const r = tx.objectStore('files').get(id); return () => r.result?.blob; });
}
// 默认值由调用方传入（如 DEFAULT_PREFERENCES）；false、0、null 不会被默认值替换。
export function getSetting<T>(key: string, fallback: T): Promise<T> {
  return transaction(['settings'], 'readonly', tx => { const r = tx.objectStore('settings').get(key); return () => r.result === undefined ? fallback : r.result.value; });
}
export async function setSetting<T>(key: string, value: T): Promise<void> {
  settings({ [key]: value });
  return transaction(['settings'], 'readwrite', tx => { tx.objectStore('settings').put({ key, value }); return () => undefined; });
}
export async function exportBackup(): Promise<Blob> {
  const snapshot = await transaction(STORES, 'readonly', tx => {
    const requests = STORES.map(name => tx.objectStore(name).getAll()); return () => requests.map(r => r.result);
  });
  const [papers, files, entries] = snapshot as [Paper[], { id: string; blob: Blob }[], { key: string; value: unknown }[]];
  check(files.reduce((n, f) => n + f.blob.size, 0) <= MAX_PDF, '原始 PDF 总量不能超过 80MB');
  const encoded: Backup['files'] = [];
  for (const { id, blob } of files) {
    const bytes = new Uint8Array(await blob.arrayBuffer().catch(e => { throw storageError(e); })), chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
    encoded.push({ id, type: blob.type || 'application/pdf', base64: btoa(chunks.join('')) });
  }
  const backup = validateBackup({ version: 1, papers, files: encoded, settings: Object.fromEntries(entries.map(e => [e.key, e.value])) });
  const output = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  check(output.size <= MAX_READ, '备份不能超过 100MB，请减少文献后重试'); return output;
}
export async function restoreBackup(file: File): Promise<number> {
  check(file instanceof Blob && file.size <= MAX_READ, '备份文件不能超过 100MB');
  let data: unknown;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('无法读取备份，请选择有效的 JSON 备份文件。'); }
  const backup = validateBackup(data);
  // 所有解码发生在事务开始前，避免 await 导致事务提前提交。
  const files = backup.files.map(f => {
    const raw = atob(f.base64), bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return { id: f.id, blob: new Blob([bytes], { type: f.type }) };
  });
  const fileIds = new Set(files.map(f => f.id));
  return transaction(STORES, 'readwrite', tx => {
    // 缺失的 PDF 不能沿用本机同 ID 的旧文件；仅清理本次恢复涉及的文献。
    for (const paper of backup.papers) { tx.objectStore('papers').put(paper); if (!fileIds.has(paper.id)) tx.objectStore('files').delete(paper.id); }
    for (const f of files) tx.objectStore('files').put(f);
    for (const [key, value] of Object.entries(backup.settings)) tx.objectStore('settings').put({ key, value });
    return () => backup.papers.length;
  });
}
