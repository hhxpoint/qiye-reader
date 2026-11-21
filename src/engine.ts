import type { ModelProgress } from './domain';
interface Result { text: string; engine: string; }
interface BrowserTranslator { translate(text: string, options?: { signal?: AbortSignal }): Promise<string>; destroy(): void; }
interface BrowserTranslatorAPI {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: { sourceLanguage: string; targetLanguage: string; monitor?: (monitor: EventTarget) => void }): Promise<BrowserTranslator>;
}
interface BrowserSummarizer { summarize(text: string, options?: { signal?: AbortSignal }): Promise<string>; destroy(): void; }
interface BrowserSummarizerAPI {
  availability(options: Record<string, unknown>): Promise<string>;
  create(options: Record<string, unknown>): Promise<BrowserSummarizer>;
}
const browserAPI = () => (globalThis as unknown as { Translator?: BrowserTranslatorAPI }).Translator;
const summarizerAPI = () => (globalThis as unknown as { Summarizer?: BrowserSummarizerAPI }).Summarizer;
let worker: Worker | undefined;
let serial = 0;
let native: BrowserTranslator | undefined;
let activeReject: ((reason: Error) => void) | undefined;
export const hasBrowserTranslator = () => Boolean(browserAPI());
export const hasBrowserSummarizer = () => Boolean(summarizerAPI());
export function cancelEngine() {
  worker?.terminate(); worker = undefined;
  native?.destroy(); native = undefined;
  activeReject?.(new DOMException('任务已取消，已完成的译文仍然保留。', 'AbortError'));
  activeReject = undefined;
}
function request(type: 'initialize' | 'translate', text: string, progress: (value: ModelProgress) => void, signal?: AbortSignal): Promise<Result> {
  if (signal?.aborted) return Promise.reject(new DOMException('已取消', 'AbortError'));
  if (activeReject) return Promise.reject(new Error('已有翻译任务正在运行。'));
  worker ??= new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
  const target = worker; const id = ++serial;
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => { clearTimeout(timer); target.removeEventListener('message', onMessage); target.removeEventListener('error', onError); signal?.removeEventListener('abort', onAbort); activeReject = undefined; };
    const fail = (error: Error) => { cleanup(); target.terminate(); if (worker === target) worker = undefined; reject(error); };
    const resetTimer = () => { clearTimeout(timer); timer = setTimeout(() => fail(new Error('模型长时间没有响应，任务已安全停止。请检查网络或尝试更短段落。')), 180000); };
    const onAbort = () => fail(new DOMException('任务已取消，已完成的译文仍然保留。', 'AbortError'));
    const onError = () => fail(new Error('本地推理进程未能启动或已中断。请检查浏览器内存后重试。'));
    const onMessage = (event: MessageEvent) => {
      if (event.data.id !== id) return;
      resetTimer();
      if (event.data.type === 'progress') progress(event.data as ModelProgress);
      else if (event.data.type === 'result') {
        if (typeof event.data.text !== 'string' || typeof event.data.engine !== 'string') { fail(new Error('本地模型返回了无效结果。')); return; }
        cleanup(); resolve({ text: event.data.text, engine: event.data.engine });
      }
      else if (event.data.type === 'error') fail(new Error(`本地模型处理失败：${event.data.message}`));
    };
    activeReject = fail;
    target.addEventListener('message', onMessage); target.addEventListener('error', onError); signal?.addEventListener('abort', onAbort, { once: true });
    progress({ phase: 'loading', message: '正在检查本站模型资源与缓存' }); resetTimer(); target.postMessage({ id, type, text });
  });
}
async function bounded<T>(operation: Promise<T>, signal?: AbortSignal, onLate?: (value: T) => void): Promise<T> {
  if (signal?.aborted) { void operation.then(onLate, () => {}); throw new DOMException('已取消', 'AbortError'); }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => fail(new DOMException('已取消', 'AbortError'));
    const timer = setTimeout(() => fail(new Error('浏览器本地模型长时间没有响应，已停止等待。请检查设备支持或稍后重试。')), 180000);
    signal?.addEventListener('abort', abort, { once: true });
    operation.then(value => { if (settled) { onLate?.(value); return; } settled = true; cleanup(); resolve(value); }, error => fail(error));
  });
}
async function nativeTranslator(progress: (value: ModelProgress) => void, signal?: AbortSignal) {
  if (native) return native;
  const api = browserAPI(); if (!api) throw new Error('此浏览器没有开放内置翻译接口。请使用本站本地模型。');
  const options = { sourceLanguage: 'en', targetLanguage: 'zh' };
  if (await bounded(api.availability(options), signal) === 'unavailable') throw new Error('浏览器当前无法提供英中翻译。请改用本站本地模型。');
  progress({ phase: 'loading', message: '正在准备浏览器内置语言包' });
  native = await bounded(api.create({ ...options, monitor: monitor => monitor.addEventListener('downloadprogress', event => { if (signal?.aborted) return; const value = event as Event & { loaded: number }; progress({ phase: 'loading', message: '浏览器正在下载语言包', loaded: value.loaded, total: 1 }); }) }), signal, value => value.destroy());
  return native;
}
export async function prepareEngine(engine: 'local' | 'browser', progress: (value: ModelProgress) => void, signal?: AbortSignal) {
  if (engine === 'browser') await nativeTranslator(progress, signal); else await request('initialize', '', progress, signal);
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  progress({ phase: 'ready', message: '本地翻译已就绪，文献不会发送到云端模型' });
}
export async function translateText(text: string, engine: 'local' | 'browser', progress: (value: ModelProgress) => void, signal?: AbortSignal): Promise<Result> {
  if (engine === 'local') return request('translate', text, progress, signal);
  const instance = await nativeTranslator(progress, signal);
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  progress({ phase: 'running', message: '正在调用浏览器本地翻译' });
  const result = await bounded(instance.translate(text, { signal }), signal);
  if (!result.trim()) throw new Error('浏览器未返回译文。');
  return { text: result, engine: '浏览器内置 · 英中翻译' };
}
export async function summarizeEvidence(text: string, signal?: AbortSignal): Promise<string> {
  const api = summarizerAPI(); if (!api) throw new Error('此浏览器没有可用的本地生成摘要接口。原文证据提要仍可使用。');
  const options = { type: 'key-points', format: 'plain-text', length: 'short', expectedInputLanguages: ['en'], expectedContextLanguages: ['en'], outputLanguage: 'en' };
  if (await bounded(api.availability(options), signal) === 'unavailable') throw new Error('当前设备或语言包不满足本地摘要要求。');
  const instance = await bounded(api.create(options), signal, value => value.destroy());
  const abort = () => instance.destroy(); signal?.addEventListener('abort', abort, { once: true });
  try { if (signal?.aborted) throw new DOMException('已取消', 'AbortError'); return await bounded(instance.summarize(text, { signal }), signal); }
  finally { signal?.removeEventListener('abort', abort); instance.destroy(); }
}
