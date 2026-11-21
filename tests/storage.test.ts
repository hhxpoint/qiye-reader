import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBackup } from '../src/storage.ts';

const sample = () => ({
  version: 1,
  papers: [{ id: 'p1', title: '研究', authors: '作者', year: '2026', category: 'AI', color: 'sage', kind: 'pdf', pageCount: 2,
    blocks: [{ id: 'b1', page: 2, text: '<script>不应执行</script>', section: '摘要' }],
    translations: { b1: { text: '译文', engine: 'local', createdAt: 1, issues: [] } },
    notes: [{ id: 'n1', blockId: 'b1', text: '笔记', quote: '引文', createdAt: 1 }],
    starred: false, currentPage: 1, createdAt: 1, updatedAt: 2, warnings: [], sample: false, sourceUrl: 'https://example.org/paper' }],
  files: [{ id: 'p1', type: 'application/pdf', base64: 'JVBERi0xLjQK' }],
  settings: { preferences: { engine: 'local', fontSize: 17, reduceMotion: false }, terms: [{ id: 't1', source: 'paper', target: '文献' }], custom: [false, 0, null] },
});
type Input = ReturnType<typeof sample>;
const rejects = (v: unknown) => assert.throws(() => validateBackup(v), /备份无效：/);
const paper = (patch: Record<string, unknown>) => { const b = sample(); return { ...b, papers: [{ ...b.papers[0], ...patch }] }; };
const file = (patch: Record<string, unknown>) => { const b = sample(); return { ...b, files: [{ ...b.files[0], ...patch }] }; };
test('完整备份通过且校验不修改或执行文本', () => {
  const b = sample(), before = structuredClone(b); assert.deepEqual(validateBackup(b), before); assert.deepEqual(b, before);
  assert.equal(validateBackup(b).papers[0].blocks[0].text, '<script>不应执行</script>');
});
test('空库、文本、可选 PDF 和文献级笔记合法', () => {
  validateBackup({ version: 1, papers: [], files: [], settings: {} });
  const b = sample(); b.files = []; validateBackup(b);
  b.papers[0].kind = 'text'; validateBackup({ ...b, papers: [{ ...b.papers[0], notes: [{ id: 'n2', text: '', createdAt: 0 }] }] });
});
test('严格检查根对象、必需字段、版本与集合类型', () => {
  for (const v of [null, [], 1, 'backup', new Date()]) rejects(v);
  for (const version of [0, 2, '1', null, true]) rejects({ ...sample(), version });
  for (const k of ['version', 'papers', 'files', 'settings']) { const b: Record<string, unknown> = sample(); delete b[k]; rejects(b); }
  for (const patch of [{ papers: {} }, { files: null }, { settings: [] }, { extra: true }]) rejects({ ...sample(), ...patch });
});
test('文献字段类型、长度、枚举与时间', () => {
  for (const k of Object.keys(sample().papers[0]).filter(k => !['sample', 'sourceUrl'].includes(k))) {
    const p: Record<string, unknown> = { ...sample().papers[0] }; delete p[k]; rejects({ ...sample(), papers: [p] });
  }
  for (const patch of [{ id: '' }, { id: 'x'.repeat(129) }, { title: '' }, { title: 'x'.repeat(2001) }, { authors: 1 }, { year: 2026 }, { category: null },
    { color: 'blue' }, { kind: 'html' }, { starred: 1 }, { sample: 'false' }, { sourceUrl: false }, { warnings: [1] }, { extra: 0 }]) rejects(paper(patch));
  for (const createdAt of [-1, 0.1, Infinity, NaN, '1', Number.MAX_SAFE_INTEGER + 1]) rejects(paper({ createdAt }));
  for (const color of ['sage', 'clay', 'lavender', 'sand']) validateBackup(paper({ color }));
});
test('页码必须为范围内正整数', () => {
  for (const pageCount of [0, -1, 1.5, 10_001, '2']) rejects(paper({ pageCount }));
  for (const page of [0, -1, 1.5, 3, '1']) { rejects(paper({ currentPage: page })); rejects(paper({ blocks: [{ ...sample().papers[0].blocks[0], page }] })); }
});
test('文献、段落、笔记和文件 ID 不可重复', () => {
  const b = sample(), p = b.papers[0]; rejects({ ...b, papers: [p, p] }); rejects({ ...b, files: [...b.files, ...b.files] });
  rejects(paper({ blocks: [...p.blocks, ...p.blocks] })); rejects(paper({ notes: [...p.notes, ...p.notes] }));
});
test('翻译和笔记只能引用同一文献段落', () => {
  const p = sample().papers[0]; rejects(paper({ translations: { absent: p.translations.b1 } }));
  rejects(paper({ notes: [{ ...p.notes[0], blockId: 'absent' }] })); rejects(paper({ notes: [{ ...p.notes[0], blockId: null }] }));
  rejects({ ...sample(), papers: [p, { ...p, id: 'p2', blocks: [{ ...p.blocks[0], id: 'b2' }] }] });
  for (const patch of [{ text: 1 }, { engine: '' }, { createdAt: -1 }, { issues: [false] }]) rejects(paper({ translations: { b1: { ...p.translations.b1, ...patch } } }));
  rejects(paper({ notes: [{ ...p.notes[0], quote: 1 }] })); rejects(paper({ blocks: [{ ...p.blocks[0], section: false }] }));
});
test('限制数量和大文本', () => {
  const b = sample(), p = b.papers[0];
  rejects({ ...b, papers: Array(2001).fill(p) }); rejects({ ...b, files: Array(2001).fill(b.files[0]) });
  for (const patch of [{ blocks: Array(20_001).fill(p.blocks[0]) }, { notes: Array(10_001).fill(p.notes[0]) }, { warnings: Array(101).fill('x') },
    { blocks: [{ ...p.blocks[0], text: 'x'.repeat(1_000_001) }] }]) rejects(paper(patch));
});
test('PDF 归属、MIME 和规范 Base64', () => {
  for (const patch of [{ id: 'missing' }, { type: 'text/html' }, { base64: 1 }]) rejects(file(patch));
  rejects(paper({ kind: 'text' }));
  for (const base64 of ['', 'A', 'AAA', 'AB==', 'AAB=', 'AA=A', '====', 'AAAA===', 'AA==\n', 'AA-_', ' A A']) rejects(file({ base64 }));
  for (const base64 of ['AA==', 'AAA=', 'AAAA', sample().files[0].base64]) validateBackup(file({ base64 }));
});
test('80MB 按解码后的 PDF 总量计算，边界可接受，超出拒绝', () => {
  const b: Input = sample(), size = 80 * 1024 * 1024;
  b.files[0].base64 = 'A'.repeat(Math.ceil(size / 3) * 4 - 1) + '='; validateBackup(b);
  b.papers.push({ ...b.papers[0], id: 'p2' }); b.files.push({ id: 'p2', type: 'application/pdf', base64: 'AA==' });
  assert.throws(() => validateBackup(b), /80MB/);
});
test('设置支持 JSON 值，验证偏好、术语、嵌套与数量', () => {
  for (const preferences of [{ engine: 'remote', fontSize: 17, reduceMotion: false }, { engine: 'local', fontSize: 100, reduceMotion: false }, { engine: 'local', fontSize: 17, reduceMotion: 0 }]) rejects({ ...sample(), settings: { preferences } });
  for (const v of [undefined, NaN, Infinity, 1n, () => 1, new Date(), Symbol('x')]) rejects({ ...sample(), settings: { v } });
  let deep: unknown = null; for (let i = 0; i < 10; i++) deep = { deep }; rejects({ ...sample(), settings: { deep } });
  const circular: Record<string, unknown> = {}; circular.self = circular; rejects({ ...sample(), settings: circular });
  rejects({ ...sample(), settings: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, 0])) });
  const term = sample().settings.terms[0]; rejects({ ...sample(), settings: { terms: [term, term] } });
  rejects({ ...sample(), settings: { terms: [{ ...term, target: 1 }] } });
});
test('拒绝原型污染字段与不安全 ID，普通文本保持原样', () => {
  for (const k of ['__proto__', 'constructor', 'prototype']) {
    rejects({ ...sample(), settings: JSON.parse(`{"${k}":{"polluted":true}}`) }); rejects(paper({ id: k }));
  }
  rejects(paper({ id: '\u0000bad' })); assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});
