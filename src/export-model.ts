import type { Paper } from './domain';
import { evidenceFor, translationState } from './text';

export type ExportFormat = 'pdf' | 'docx' | 'md';
export interface ExportOptions {
  format: ExportFormat;
  includeText: boolean;
  includeEvidence: boolean;
  includeNotes: boolean;
  includeSourcePages: boolean;
  pageRange: string;
}
export interface ExportSnapshot { paper: Paper; file?: Blob; }
export interface ExportProgress { message: string; done: number; total: number; }
export interface ExportContext { signal: AbortSignal; report: (progress: ExportProgress) => void; }
export interface ExportItem { kind: 'label' | 'body' | 'quote' | 'translation' | 'notice'; text: string; }
export interface ExportSection { title: string; intro: string; items: ExportItem[]; }
export const EXPORT_LIMIT = 1_200_000;
export const READING_NOTICE = '本文件为个人阅读整理，不是原论文的正式译本。机器译文与证据摘录须对照原文核查；数值、术语与重要结论尤其需要人工确认。';
export const SOURCE_NOTICE = '附录按原 PDF 页面保留图、表与上下文，不做自动裁切、不改写图表数据。请遵守原论文的版权与使用许可。';
export const initialExportOptions = (hasFile: boolean): ExportOptions => ({ format: 'pdf', includeText: true, includeEvidence: true, includeNotes: true, includeSourcePages: hasFile, pageRange: '' });

/** One-based, sorted and deduplicated. Empty means all pages, never a guessed subset. */
export function parsePageRange(input: string, pageCount: number): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 100) throw new Error('原 PDF 页数须在 1–100 页之间。');
  if (input.length > 500) throw new Error('页码范围过长，请简化为 1-5,8 这样的格式。');
  if (!input.trim()) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const pages = new Set<number>();
  for (const raw of input.replace(/，/g, ',').split(',')) {
    const match = raw.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/u);
    if (!match) throw new Error('页码格式有误，请填写如 1-3,5，留空表示全部页。');
    const start = Number(match[1]), end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > pageCount) throw new Error(`页码必须在 1–${pageCount} 之间，且起始页不大于结束页。`);
    for (let page = start; page <= end; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

/** Plain data only. Export is a read-only snapshot and never modifies translations or notes. */
export function buildExportSections(paper: Paper, options: ExportOptions): ExportSection[] {
  const sections: ExportSection[] = [];
  if (options.includeEvidence) {
    const items: ExportItem[] = evidenceFor(paper).flatMap((e, index) => {
      const result: ExportItem[] = [
        { kind: 'label', text: `${String(index + 1).padStart(2, '0')}  ·  ${e.section}  ·  原文第 ${e.page} 页 / 段落 ${paper.blocks.findIndex(b => b.id === e.blockId) + 1}` },
        { kind: 'quote', text: e.text },
      ];
      const t = paper.translations[e.blockId];
      if (t) result.push({ kind: 'translation', text: t.text }, { kind: 'notice', text: `译文来源：${t.engine}${t.engine === '人工校订' ? '' : ' · 待人工核对'}` });
      return result;
    });
    sections.push({ title: '证据提要', intro: '从正文抽取的代表性原句，按原文顺序排列。这是检索式摘录，可能遗漏内容，不等同于生成摘要或完整综述。', items: items.length ? items : [{ kind: 'notice', text: '没有可抽取的证据段落。' }] });
  }
  if (options.includeText) {
    const items: ExportItem[] = [];
    paper.blocks.forEach((block, index) => {
      items.push({ kind: 'label', text: `§ ${String(index + 1).padStart(2, '0')}  ·  ${block.section}  ·  原文第 ${block.page} 页` }, { kind: 'body', text: block.text });
      const translation = paper.translations[block.id];
      if (translation) {
        items.push({ kind: 'notice', text: `中文译文  /  ${translation.engine}${translation.engine === '人工校订' ? '' : ' · 待人工核对'}` }, { kind: 'translation', text: translation.text });
        if (translation.issues.length) items.push({ kind: 'notice', text: `核对提示\n${translation.issues.join('\n')}` });
      } else items.push({ kind: 'notice', text: '本段暂无已保存译文。' });
    });
    sections.push({ title: '原文与译文', intro: '段落编号与原文页码用于回查。排版为重新整理的阅读版；复杂公式、图表和多栏顺序请以原 PDF 为准。', items: items.length ? items : [{ kind: 'notice', text: '暂无可读取的正文。请查看原 PDF 附录。' }] });
  }
  if (options.includeNotes) {
    const items: ExportItem[] = [];
    paper.notes.forEach((note, index) => {
      const block = paper.blocks.find(b => b.id === note.blockId);
      items.push({ kind: 'label', text: `笔记 ${String(index + 1).padStart(2, '0')}  ·  ${new Date(note.createdAt).toISOString().slice(0, 10)}${block ? `  ·  原文第 ${block.page} 页 / 段落 ${paper.blocks.indexOf(block) + 1}` : '  ·  独立笔记'}` });
      if (note.quote) items.push({ kind: 'quote', text: note.quote });
      items.push({ kind: 'body', text: note.text });
    });
    sections.push({ title: '阅读笔记', intro: '以下为阅读者保存的想法与引文，不代表原论文作者观点。未保存的编辑和会话草稿不会包含在导出文件中。', items: items.length ? items : [{ kind: 'notice', text: '尚未保存阅读笔记。' }] });
  }
  const length = sections.reduce((n, s) => n + s.intro.length + s.items.reduce((m, i) => m + i.text.length, 0), 0);
  if (length > EXPORT_LIMIT) throw new Error('本次整理内容超过 120 万字符，请减少导出章节，或分篇整理后重试。');
  return sections;
}

export function exportStats(paper: Paper) {
  const state = translationState(paper);
  return `${paper.pageCount} 页原文  /  ${state.completed} / ${state.total} 段英文已译  /  ${paper.notes.length} 条笔记`;
}

export function safeExportName(title: string, extension: ExportFormat) {
  const clean = [...title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').replace(/[. ]+$/g, '').trim()].slice(0, 100).join('') || '栖页';
  return `${clean}-阅读整理.${extension}`;
}

/** Bounded, lossless wrapping at Unicode code points; explicit line breaks are retained. */
export function wrapText(text: string, width: number, measure: (text: string) => number): string[] {
  if (!(width > 0)) throw new Error('排版区域无效。');
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '', lineWidth = 0;
    const chunks = paragraph.match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)?|[^A-Za-z0-9]/gu) || [''];
    for (const chunk of chunks) {
      const w = measure(chunk);
      if (line && lineWidth + w > width) { lines.push(line); line = ''; lineWidth = 0; }
      if (w <= width) { line += chunk; lineWidth += w; continue; }
      for (const char of chunk) {
        const cw = measure(char);
        if (line && lineWidth + cw > width) { lines.push(line); line = ''; lineWidth = 0; }
        line += char; lineWidth += cw;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function yieldExport(context: ExportContext) {
  context.signal.throwIfAborted();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  context.signal.throwIfAborted();
}
