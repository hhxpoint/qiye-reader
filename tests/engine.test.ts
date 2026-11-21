import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { cancelEngine, translateText } from '../src/engine.ts';
import type { ModelProgress } from '../src/domain.ts';
import { validateBackup } from '../src/storage.ts';
import { makeSamples } from '../src/text.ts';

type RequestMessage = { id: number; type: 'initialize' | 'translate'; text: string };

// node:test 默认串行运行；每个用例结束时先清理引擎，再恢复原始全局属性。
function mockWorker(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const workers: MockWorker[] = [];
  class MockWorker extends EventTarget {
    requests: RequestMessage[] = [];
    terminated = false;
    constructor() { super(); workers.push(this); }
    postMessage(message: RequestMessage) { this.requests.push(structuredClone(message)); }
    terminate() { this.terminated = true; }
    message(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data })); }
  }
  t.after(() => {
    try { cancelEngine(); }
    finally {
      if (original) Object.defineProperty(globalThis, 'Worker', original);
      else Reflect.deleteProperty(globalThis, 'Worker');
    }
  });
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: MockWorker });
  const translate = (text = 'Source paragraph.', progress: (value: ModelProgress) => void = () => {}) => {
    const pending = translateText(text, 'local', progress);
    // 即使中途断言失败，after 中取消未完成请求也不会产生未处理的 rejection。
    void pending.catch(() => {});
    return pending;
  };
  return { workers, translate };
}

test('Worker result 仅返回 text/engine，组合为 Paper 翻译后通过严格备份校验', async t => {
  const { workers, translate } = mockWorker(t);
  const paper = makeSamples()[0], block = paper.blocks[0];
  const pending = translate(block.text);
  assert.equal(workers.length, 1);
  const worker = workers[0], request = worker.requests[0];
  assert.deepEqual(request, { id: request.id, type: 'translate', text: block.text });
  const payload = { id: request.id, type: 'result', text: '阅读研究论文不是一场竞赛。', engine: 'local', internal: '不应保存' };
  worker.message(payload);
  const result = await pending;
  assert.deepEqual(result, { text: payload.text, engine: payload.engine });
  assert.deepEqual(Reflect.ownKeys(result).sort(), ['engine', 'text']);
  assert.notEqual(result, payload);
  assert.equal(worker.terminated, false);

  paper.translations[block.id] = { ...result, createdAt: 1, issues: [] };
  const backup = { version: 1, papers: [paper], files: [], settings: {} };
  assert.deepEqual(validateBackup(backup), backup);
});

for (const kind of ['message', 'runtime'] as const) {
  test(`Worker ${kind === 'message' ? 'error 消息' : 'error 事件'}拒绝请求并 terminate，随后可重新请求`, async t => {
    const { workers, translate } = mockWorker(t);
    const pending = translate();
    const worker = workers[0], id = worker.requests[0].id;
    const rejected = assert.rejects(pending, kind === 'message' ? /本地模型处理失败：测试故障/ : /本地推理进程未能启动或已中断/);
    if (kind === 'message') worker.message({ id, type: 'error', message: '测试故障' });
    else worker.dispatchEvent(new Event('error'));
    await rejected;
    assert.equal(worker.terminated, true);

    const retry = translate('Retry paragraph.');
    assert.equal(workers.length, 2);
    const replacement = workers[1], request = replacement.requests[0];
    assert.notEqual(replacement, worker);
    assert.notEqual(request.id, id);
    assert.deepEqual(request, { id: request.id, type: 'translate', text: 'Retry paragraph.' });
    replacement.message({ id: request.id, type: 'result', text: '重试译文', engine: 'local' });
    assert.deepEqual(await retry, { text: '重试译文', engine: 'local' });
    assert.equal(replacement.terminated, false);
  });
}

test('cancelEngine 以 AbortError 拒绝 pending 并 terminate，取消后可重新请求', async t => {
  const { workers, translate } = mockWorker(t);
  const pending = translate();
  const worker = workers[0];
  const rejected = assert.rejects(pending, { name: 'AbortError', message: '任务已取消，已完成的译文仍然保留。' });
  cancelEngine();
  await rejected;
  assert.equal(worker.terminated, true);

  const retry = translate();
  assert.equal(workers.length, 2);
  const replacement = workers[1];
  replacement.message({ id: replacement.requests[0].id, type: 'result', text: '取消后重试', engine: 'local' });
  assert.deepEqual(await retry, { text: '取消后重试', engine: 'local' });
});

test('并发请求被拒绝，不创建额外 Worker 或中断已有请求', async t => {
  const { workers, translate } = mockWorker(t);
  const pending = translate('First paragraph.');
  const worker = workers[0];
  await assert.rejects(translate('Second paragraph.'), /已有翻译任务正在运行/);
  assert.equal(workers.length, 1);
  assert.equal(worker.requests.length, 1);
  assert.equal(worker.terminated, false);
  worker.message({ id: worker.requests[0].id, type: 'result', text: '首个请求完成', engine: 'local' });
  assert.deepEqual(await pending, { text: '首个请求完成', engine: 'local' });
});

test('忽略错误 id 的消息，转发匹配的进度，完成后清理监听且复用 Worker', async t => {
  const { workers, translate } = mockWorker(t);
  const progress: ModelProgress[] = [];
  const pending = translate('Source paragraph.', value => progress.push(value));
  const worker = workers[0], id = worker.requests[0].id;
  const initial = { phase: 'loading', message: '正在检查本站模型资源与缓存' };
  assert.deepEqual(progress, [initial]);
  let settled = false;
  void pending.then(() => { settled = true; }, () => { settled = true; });
  for (const wrongId of [id + 1, String(id)]) {
    worker.message({ id: wrongId, type: 'progress', phase: 'running', message: '错误进度' });
    worker.message({ id: wrongId, type: 'result', text: '错误译文', engine: 'local' });
    worker.message({ id: wrongId, type: 'error', message: '错误请求' });
  }
  await setImmediate();
  assert.equal(settled, false);
  assert.equal(worker.terminated, false);
  assert.deepEqual(progress, [initial]);

  const update = { id, type: 'progress', phase: 'running', message: '生成译文', loaded: 1, total: 2 };
  worker.message(update);
  assert.deepEqual(progress, [initial, update]);
  worker.message({ id, type: 'result', text: '正确译文', engine: 'local' });
  assert.deepEqual(await pending, { text: '正确译文', engine: 'local' });
  worker.message(update);
  worker.message({ id, type: 'error', message: '迟到错误' });
  worker.dispatchEvent(new Event('error'));
  assert.deepEqual(progress, [initial, update]);
  assert.equal(worker.terminated, false);

  const next = translate('Next paragraph.');
  assert.equal(workers.length, 1);
  assert.equal(worker.requests.length, 2);
  const nextId = worker.requests[1].id;
  assert.notEqual(nextId, id);
  worker.message({ id: nextId, type: 'result', text: '下一段译文', engine: 'local' });
  assert.deepEqual(await next, { text: '下一段译文', engine: 'local' });
});

const invalidValues: [string, unknown][] = [['缺失', undefined], ['null', null], ['数字', 42], ['对象', {}]];
for (const field of ['text', 'engine'] as const) {
  for (const [label, value] of invalidValues) {
    test(`畸形 result：${field} 为${label}时拒绝并 terminate`, async t => {
      const { workers, translate } = mockWorker(t);
      const pending = translate();
      const worker = workers[0];
      const payload: Record<string, unknown> = { id: worker.requests[0].id, type: 'result', text: '译文', engine: 'local' };
      if (value === undefined) delete payload[field];
      else payload[field] = value;
      const rejected = assert.rejects(pending, /本地模型返回了无效结果/);
      worker.message(payload);
      await rejected;
      assert.equal(worker.terminated, true);
    });
  }
}
