import { MarianTokenizer, AutoModelForSeq2SeqLM, TranslationPipeline, env, type Tensor, type ProgressInfo } from '@huggingface/transformers';

// Runtime/tokenizer stay same-origin. Only these pinned public weights use remote sources.
const fetchNative = globalThis.fetch.bind(globalThis);
const revision = '4dc37afc6deb160f4c9048260d48019ee497658e';
const modelPrefix = '/models/onnx-community/opus-mt-en-zh/onnx/';
const weights = new Set(['encoder_model_quantized.onnx', 'decoder_model_merged_quantized.onnx']);
env.fetch = async (input, init) => {
  const url = new URL(String(input), self.location.origin);
  const name = url.pathname.slice(modelPrefix.length);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(modelPrefix) || !weights.has(name)) return fetchNative(input, init);
  for (const host of ['https://hf-mirror.com', 'https://huggingface.co']) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetchNative(`${host}/onnx-community/opus-mt-en-zh/resolve/${revision}/onnx/${name}?download=true`, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (response.ok && !response.headers.get('content-type')?.includes('text/html')) return response;
    } catch { /* Try the other public source once; never send document text. */ }
    finally { clearTimeout(timer); }
  }
  throw new Error('两个公开模型源均暂不可达，请检查网络后重试。原文与已保存的笔记不受影响。');
};
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('/models/', self.location.origin).href;
env.useBrowserCache = true;
// Same-origin runtime uses the HTTP cache; avoid a second blob-import cache layer.
env.useWasmCache = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.wasmPaths = {
    mjs: new URL('/runtime/ort-wasm-simd-threaded.asyncify.mjs', self.location.origin).href,
    wasm: new URL('/runtime/ort-wasm-simd-threaded.asyncify.wasm', self.location.origin).href,
  };
}
let translator: TranslationPipeline | null = null;
let loading: Promise<TranslationPipeline> | null = null;
let active = false;
const send = (id: number, type: string, data: Record<string, unknown> = {}) => self.postMessage({ id, type, ...data });
async function initialize(id: number) {
  if (translator) return translator;
  // Load the declared components explicitly: v4 pipeline auto-discovery skips
  // same-origin HTTP tokenizer metadata when remote discovery is disabled.
  if (!loading) {
    const progress_callback = (info: ProgressInfo) => {
      if (info.status === 'progress_total' || info.status === 'progress') {
        send(id, 'progress', { phase: 'loading', message: `正在准备 ${'file' in info ? info.file : '模型资源'}`, loaded: info.loaded, total: info.total });
      } else if (info.status === 'download' || info.status === 'initiate') send(id, 'progress', { phase: 'loading', message: `正在加载 ${info.file}` });
      else if (info.status === 'done') send(id, 'progress', { phase: 'loading', message: `${info.file} 已读取，正在准备推理` });
    };
    loading = (async () => {
      send(id, 'progress', { phase: 'loading', message: '正在读取本站分词器' });
      // AutoTokenizer also uses the v4 metadata discovery path. Read the two
      // declared JSON files directly rather than enabling remote discovery.
      const [tokenizerJSON, tokenizerConfig] = await Promise.all(['tokenizer.json', 'tokenizer_config.json'].map(async name => {
        const response = await fetchNative(new URL(`/models/onnx-community/opus-mt-en-zh/${name}`, self.location.origin));
        if (!response.ok || !response.headers.get('content-type')?.includes('json')) throw new Error('分词器资源不可用，请刷新网页后重试。');
        return response.json();
      }));
      const tokenizer = new MarianTokenizer(tokenizerJSON, tokenizerConfig);
      send(id, 'progress', { phase: 'loading', message: '分词器已就绪，正在初始化推理运行库' });
      const model = await AutoModelForSeq2SeqLM.from_pretrained('onnx-community/opus-mt-en-zh', { dtype: 'q8', device: 'wasm', local_files_only: true, progress_callback });
      translator = new TranslationPipeline({ task: 'translation', tokenizer, model });
      return translator;
    })().catch(error => { loading = null; throw error; });
  }
  return loading;
}
function splitText(text: string, model: TranslationPipeline): string[] {
  if (typeof model.tokenizer !== 'function') throw new Error(`分词器初始化异常：${typeof model.tokenizer} / ${Object.keys(model).join(',')}`);
  const tokens = model.tokenizer(text, { truncation: false });
  if (tokens.input_ids.dims.at(-1)! <= 180) return [text];
  if (text.length < 8) throw new Error('无法安全分割这段文字，请检查编码。');
  const midpoint = Math.floor(text.length / 2);
  let cut = text.lastIndexOf(' ', midpoint);
  if (cut < text.length / 4) cut = midpoint;
  return [...splitText(text.slice(0, cut), model), ...splitText(text.slice(cut).trimStart(), model)];
}
async function runChunk(text: string, model: TranslationPipeline, depth = 0): Promise<string> {
  const inputs = model.tokenizer([text], { truncation: false, padding: true });
  if (inputs.input_ids.dims.at(-1)! > 512) throw new Error('输入超过模型上限，已停止以避免漏译。');
  const output = await model.model.generate({ ...inputs, max_new_tokens: 384, num_beams: 1, do_sample: false }) as Tensor;
  if (output.dims.at(-1)! >= 384) {
    if (depth > 3 || text.length < 20) throw new Error('译文达到长度上限，未保存可能截断的结果。');
    let cut = text.lastIndexOf(' ', Math.floor(text.length / 2)); if (cut < 1) cut = Math.floor(text.length / 2);
    return `${await runChunk(text.slice(0, cut), model, depth + 1)}${await runChunk(text.slice(cut).trim(), model, depth + 1)}`;
  }
  return model.tokenizer.batch_decode(output, { skip_special_tokens: true })[0].trim();
}
self.onmessage = async (event: MessageEvent<{ id: number; type: 'initialize' | 'translate'; text?: string }>) => {
  const { id, type, text = '' } = event.data;
  if (active) { send(id, 'error', { message: '请等待当前任务完成。' }); return; }
  active = true;
  try {
    const model = await initialize(id);
    if (type === 'initialize') { send(id, 'result', { text: '', engine: 'OPUS-MT · 本地 WASM' }); return; }
    if (!text.trim() || text.length > 20000) throw new Error('段落为空或过长，请分段处理。');
    const parts = splitText(text, model); const result: string[] = [];
    for (let index = 0; index < parts.length; index++) {
      send(id, 'progress', { phase: 'running', message: `正在本地翻译片段 ${index + 1} / ${parts.length}` });
      result.push(await runChunk(parts[index], model));
    }
    if (!result.join('').trim()) throw new Error('模型未返回译文，请重试。');
    send(id, 'result', { text: result.join('\n'), engine: 'OPUS-MT · 本地 WASM' });
  } catch (error) { send(id, 'error', { message: error instanceof Error ? error.message : String(error) }); }
  finally { active = false; }
};
