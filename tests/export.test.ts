import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExportSections, initialExportOptions, parsePageRange, safeExportName, wrapText } from '../src/export-model.ts';
import { canTranslateBlock, makeSamples, translationState } from '../src/text.ts';
import { createImageGuard } from '../src/source-image-check.ts';

test('附录页码支持全部、范围、中文逗号，排序去重', () => {
  assert.deepEqual(parsePageRange('', 4), [1, 2, 3, 4]);
  assert.deepEqual(parsePageRange(' 4,1-2，2 ', 4), [1, 2, 4]);
  assert.deepEqual(parsePageRange('2–3', 4), [2, 3]);
});
for (const value of ['0', '-1', '3-2', '1-5', '1,,2', '1.5', 'abc', '1,', '1e2', '99999999999999999']) {
  test(`拒绝错误附录页码：${value}`, () => assert.throws(() => parsePageRange(value, 4)));
}
test('进度只计可译英文，已完成与人工校订不进入剩余队列', () => {
  const paper = makeSamples()[0];
  paper.blocks.unshift({ id: 'heading', text: 'Introduction', section: 'Introduction', page: 1 });
  paper.blocks.push({ id: 'chinese', text: '这是一段中文，不应加入英译中队列。', section: '备注', page: 1 });
  const first = paper.blocks[1];
  paper.translations[first.id] = { text: '已校订', engine: '人工校订', createdAt: 1, issues: [] };
  const state = translationState(paper);
  assert.equal(state.skipped, 2); assert.equal(state.completed, 1);
  assert.equal(state.total, paper.blocks.length - 2);
  assert.ok(!state.remaining.some(b => b.id === first.id));
  assert.equal(canTranslateBlock({ text: 'Only three words' }), false);
  assert.equal(canTranslateBlock({ text: 'Four actual English words' }), true);
});
test('导出内容保留来源、译文引擎、校验信息、原文锚点且不修改快照', () => {
  const paper = makeSamples()[0], block = paper.blocks[0];
  paper.translations[block.id] = { text: '机器译文', engine: 'OPUS-MT', createdAt: 1, issues: ['核对12个样本'] };
  paper.notes.push({ id: 'note', text: '自己的理解', quote: block.text, blockId: block.id, createdAt: 1 });
  const original = JSON.stringify(paper);
  const sections = buildExportSections(paper, initialExportOptions(false));
  assert.deepEqual(sections.map(s => s.title), ['证据提要', '原文与译文', '阅读笔记']);
  const text = JSON.stringify(sections);
  for (const expected of ['机器译文', 'OPUS-MT', '待人工核对', '核对12个样本', '自己的理解', '原文第 1 页', '段落 1']) assert.ok(text.includes(expected), expected);
  assert.equal(JSON.stringify(paper), original);
});
test('导出选项实际控制章节，不将草稿当保存笔记', () => {
  const paper = makeSamples()[0];
  const sections = buildExportSections(paper, { ...initialExportOptions(false), includeText: false, includeEvidence: false });
  assert.deepEqual(sections.map(s => s.title), ['阅读笔记']);
  assert.equal(sections[0].items[0].text, '尚未保存阅读笔记。');
});
test('中英混排与长单词自动换行不丢字符、不拆代理对', () => {
  const text = '中文（12% confidence interval）测试。abcde\nLongUnbrokenWord以及𠮷。';
  const lines = wrapText(text, 8, value => [...value].length);
  assert.ok(lines.every(line => [...line].length <= 8));
  assert.equal(lines.join(''), text.replace(/\n/g, ''));
  assert.ok(lines.every(line => !/[\ud800-\udbff]$/.test(line)));
});
const imageOps = { paintImageXObject: 1, paintImageXObjectRepeat: 2, paintImageMaskXObject: 3, paintImageMaskXObjectRepeat: 4, paintInlineImageXObject: 5, paintInlineImageXObjectGroup: 6, paintImageMaskXObjectGroup: 7 };
const image = { width: 2, height: 2, data: new Uint8Array(12) };
const objects = new Map<string, unknown>([['image', image], ['bad', null]]);
const globalObjects = new Map<string, unknown>([['g_image', image], ['g_bad', null]]);
const guard = createImageGuard({ objs: { has: id => objects.has(id), get: id => objects.get(id) }, commonObjs: { has: id => globalObjects.has(id), get: id => globalObjects.get(id) } }, imageOps);
for (const id of ['bad', 'missing', 'g_bad']) test(`PDF 图片依赖 ${id} 不能静默变成白图`, () => {
  assert.throws(() => guard(0, { fnArray: [1], argsArray: [[id]] }), /未能解码的图片/);
});
test('接受正常本地、共享、内联、掩模图片，不影响非图片绘制', () => {
  for (const [fn, args] of [[1, ['image']], [2, ['g_image']], [3, [{ data: 'image' }]], [5, [image]], [7, [[{ data: 'image' }]]], [99, []]] as [number, unknown[]][]) assert.equal(guard(0, { fnArray: [fn], argsArray: [args] }), true);
});
test('拒绝没有像素数据的内联图片', () => assert.throws(() => guard(0, { fnArray: [5], argsArray: [[{width: 2, height: 2, data: new Uint8Array(0)}]] })));

test('文件名清理禁止字符且有非空名称', () => {
  assert.equal(safeExportName(' a/b:c? ', 'docx'), 'a-b-c--阅读整理.docx');
  assert.equal(safeExportName('', 'pdf'), '栖页-阅读整理.pdf');
});
