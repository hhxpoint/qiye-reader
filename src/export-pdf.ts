import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildExportSections, exportStats, parsePageRange, READING_NOTICE, SOURCE_NOTICE, wrapText, yieldExport, type ExportContext, type ExportOptions, type ExportSnapshot } from './export-model';

const A4: [number, number] = [595.28, 841.89];
const INK = rgb(.20, .25, .21), SAGE = rgb(.31, .43, .32), MUTED = rgb(.43, .47, .42);
const RULE = rgb(.85, .88, .82), PALE = rgb(.95, .96, .93);
const M = 52, BOTTOM = 67, WIDTH = A4[0] - M * 2;
const normalize = (value: string) => value.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');

async function loadFont(signal: AbortSignal) {
  const response = await fetch('/fonts/QiyeSans-Regular.ttf', { signal, credentials: 'omit' });
  if (!response.ok) throw new Error('PDF 中文字体暂时无法下载，请检查网络后重试。Word 导出不依赖此字体下载。');
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.length < 1000 || data.length > 25 * 1024 * 1024 || !((data[0] === 0 && data[1] === 1) || String.fromCharCode(...data.slice(0, 4)) === 'OTTO')) throw new Error('PDF 字体资源无效，请刷新网页后重试。');
  return data;
}

export async function exportPdf(snapshot: ExportSnapshot, options: ExportOptions, context: ExportContext, fontBytes?: Uint8Array): Promise<Blob> {
  const { paper, file } = snapshot;
  const sections = buildExportSections(paper, options);
  const sourcePages = options.includeSourcePages ? parsePageRange(options.pageRange, paper.pageCount) : [];
  if (sourcePages.length && !file) throw new Error('原 PDF 不在本机，无法保留图表附录。请恢复完整备份，或取消附录选项。');
  context.report({ message: '准备中文字体与文档版心', done: 0, total: sections.length + sourcePages.length + 2 });
  context.signal.throwIfAborted();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // Full embedding avoids missing composite CJK glyphs in fontkit's subset output.
  const font = await pdf.embedFont(fontBytes ?? await loadFont(context.signal), { subset: false });
  const chars = new Set(font.getCharacterSet());
  const unsupported = new Set<string>();
  const check = (text: string) => { for (const char of normalize(text)) if (char !== '\n' && !chars.has(char.codePointAt(0)!)) unsupported.add(char); };
  [paper.title, paper.authors, paper.year, paper.category, paper.sourceUrl || '', ...paper.warnings].forEach(check);
  for (const section of sections) { check(section.intro); for (const item of section.items) check(item.text); }
  if (unsupported.size) throw new Error(`PDF 字体暂不支持以下字符：${[...unsupported].slice(0, 10).join(' ')}。为避免漏字，已停止导出；可先使用 Word 格式。`);
  pdf.setTitle(`${paper.title} · 阅读整理`); pdf.setAuthor('栖页阅读者'); pdf.setCreator('QIYE · Local Reading Export');
  pdf.setSubject(READING_NOTICE); pdf.setLanguage('zh-CN');
  let page: PDFPage, y = 0, contentPages = 0, lineCount = 0;
  const measureCache = new Map<string, number>();
  const measure = (text: string, size: number) => {
    const key = `${size}:${text}`;
    let result = measureCache.get(key);
    if (result === undefined) { result = font.widthOfTextAtSize(text, size); if (measureCache.size < 12000) measureCache.set(key, result); }
    return result;
  };
  const short = (text: string, max: number, size: number) => {
    let result = '';
    for (const char of text) { if (measure(result + char + '…', size) > max) return result + '…'; result += char; }
    return result;
  };
  const newPage = (cover = false) => {
    if (++contentPages > 600) throw new Error('整理正文超过 600 页，请减少导出章节或拆分文献。');
    page = pdf.addPage(A4); y = A4[1] - 82;
    if (!cover) {
      page.drawText('QIYE  /  栖页阅读整理', { x: M, y: A4[1] - 38, size: 8, font, color: SAGE });
      page.drawText(short(paper.title, 260, 8), { x: A4[0] - M - Math.min(260, measure(short(paper.title, 260, 8), 8)), y: A4[1] - 38, size: 8, font, color: MUTED });
      page.drawLine({ start: { x: M, y: A4[1] - 50 }, end: { x: A4[0] - M, y: A4[1] - 50 }, thickness: .6, color: RULE });
    }
  };
  const ensure = (height: number) => { if (y - height < BOTTOM) newPage(); };
  const text = async (value: string, { size = 10.5, color = INK, indent = 0, gap = 11, tint = false }: { size?: number; color?: RGB; indent?: number; gap?: number; tint?: boolean } = {}) => {
    const leading = size * 1.72;
    const lines = wrapText(normalize(value), WIDTH - indent * 2, value => measure(value, size));
    if (lines.length > 1) ensure(leading * 2);
    for (const line of lines) {
      ensure(leading);
      if (tint) page.drawRectangle({ x: M, y: y - leading + 3, width: WIDTH, height: leading + .3, color: PALE });
      page.drawText(line, { x: M + indent, y: y - size, size, font, color });
      y -= leading;
      if (++lineCount % 36 === 0) await yieldExport(context);
    }
    y -= gap;
  };
  newPage(true);
  page!.drawRectangle({ x: 0, y: A4[1] - 14, width: A4[0], height: 14, color: SAGE });
  page!.drawText('Q I Y E   /   A   Q U I E T   L I B R A R Y', { x: M, y: A4[1] - 69, font, size: 9, color: SAGE });
  y = A4[1] - 147;
  await text('阅读整理', { size: 33, color: SAGE, gap: 20 });
  await text(paper.title, { size: 22, gap: 24 });
  await text(`${paper.authors || '未填写作者'}\n${paper.year || '未填写年份'}  ·  ${paper.category}`, { size: 11, color: MUTED, gap: 20 });
  await text(exportStats(paper), { size: 9.5, color: SAGE });
  await text(`导出时间  ${new Date().toLocaleString('zh-CN', { hour12: false })}`, { size: 9, color: MUTED, gap: 25 });
  if (paper.sample) await text('原创教学示例 · 非发表论文 · 不包含实验成果声明', { size: 9, color: SAGE });
  if (paper.sourceUrl) await text(`文献来源  ${paper.sourceUrl}`, { size: 9, color: MUTED });
  await text(READING_NOTICE, { size: 9, color: MUTED, indent: 12, tint: true, gap: 22 });
  await text('本册内容', { size: 11, color: SAGE, gap: 6 });
  for (const [index, section] of sections.entries()) await text(`${String(index + 1).padStart(2, '0')}    ${section.title}`, { size: 10, gap: 4 });
  if (sourcePages.length) await text(`${String(sections.length + 1).padStart(2, '0')}    原页图表附录  ·  ${sourcePages.length} 页`, { size: 10, gap: 4 });

  for (const [sectionIndex, section] of sections.entries()) {
    context.report({ message: `正在排版${section.title}`, done: sectionIndex + 1, total: sections.length + sourcePages.length + 2 });
    await yieldExport(context); newPage();
    await text(`0${sectionIndex + 1}   /   ${section.title}`, { size: 23, color: SAGE, gap: 17 });
    await text(section.intro, { size: 9, color: MUTED, gap: 27 });
    for (const item of section.items) {
      if (item.kind === 'label') { y -= 10; ensure(90); await text(item.text, { size: 9, color: SAGE, gap: 10 }); }
      else if (item.kind === 'notice') await text(item.text, { size: 8.5, color: MUTED, gap: 12 });
      else if (item.kind === 'quote') await text(item.text, { size: 10, color: MUTED, indent: 12, tint: true, gap: 15 });
      else if (item.kind === 'translation') await text(item.text, { size: 11, color: SAGE, gap: 19 });
      else await text(item.text, { size: 10.5, gap: 16 });
    }
  }
  if (sourcePages.length && file) {
    newPage();
    await text(`${String(sections.length + 1).padStart(2, '0')}   /   原页图表附录`, { size: 23, color: SAGE, gap: 24 });
    await text(SOURCE_NOTICE, { size: 11, gap: 18 });
    await text('以下页面直接复制自导入的 PDF，保留图表、图注、版式及原页尺寸。原页未叠加阅读整理的页眉页脚，避免遮盖任何原始信息。图表文字不会被自动翻译。', { size: 10.5, color: MUTED, gap: 24 });
    await text(`原文页码  ${sourcePages.join('、')}`, { size: 10, color: SAGE });
    await text('阅读整理的页码与原 PDF 页码是两套编号。请按附录排列顺序与上述原文页码对应回查；如只导出部分页，原 PDF 内部跨页跳转不保证保留。', { size: 9, color: MUTED });
    if (paper.warnings.length) { await text('原文解析提示', { size: 11, color: SAGE }); await text(paper.warnings.join('\n'), { size: 9, color: MUTED }); }
    const original = await PDFDocument.load(await file.arrayBuffer());
    if (original.getPageCount() !== paper.pageCount) throw new Error('原 PDF 页数与文献记录不一致，已停止导出以避免附错图表。');
    // One copier deduplicates images/fonts shared by many source pages.
    // Calling copyPages separately for every page duplicates the same resources.
    await yieldExport(context);
    const copiedPages = await pdf.copyPages(original, sourcePages.map(number => number - 1));
    for (const [index, copied] of copiedPages.entries()) {
      context.report({ message: `保留原 PDF 第 ${sourcePages[index]} 页图表`, done: sections.length + index + 1, total: sections.length + sourcePages.length + 2 });
      await yieldExport(context);
      pdf.addPage(copied);
    }
  }
  const pages = pdf.getPages();
  for (let i = 0; i < contentPages; i++) {
    const p = pages[i];
    p.drawLine({ start: { x: M, y: 46 }, end: { x: A4[0] - M, y: 46 }, thickness: .5, color: RULE });
    p.drawText('栖页  ·  每一次理解，都从原文开始', { x: M, y: 30, size: 8, font, color: MUTED });
    const label = `${i + 1} / ${contentPages}  整理正文`;
    p.drawText(label, { x: A4[0] - M - measure(label, 8), y: 30, size: 8, font, color: MUTED });
  }
  context.report({ message: '封装 PDF，请稍候', done: sections.length + sourcePages.length + 1, total: sections.length + sourcePages.length + 2 });
  await yieldExport(context);
  const bytes = await pdf.save({ objectsPerTick: 25 });
  context.signal.throwIfAborted();
  if (bytes.byteLength > 80 * 1024 * 1024) throw new Error('导出文件超过 80 MiB，请缩小原页范围后重试。');
  return new Blob([new Uint8Array(bytes).buffer], { type: 'application/pdf' });
}
