import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun,
  LineRuleType, Packer, PageNumber, PageOrientation, Paragraph, SectionType,
  ShadingType, Tab, TextRun,
  type IParagraphPropertiesOptions, type IRunPropertiesOptions, type ISectionOptions,
  type IStylesOptions,
} from 'docx';
import {
  buildExportSections, exportStats, READING_NOTICE, SOURCE_NOTICE, parsePageRange, yieldExport,
  type ExportContext, type ExportItem, type ExportOptions, type ExportSnapshot,
} from './export-model';
import { renderSourcePages, type RenderedSourcePage } from './source-pages';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_DOCX_BYTES = 80 * 1024 * 1024;
const A4 = { width: 11906, height: 16838 };
const BODY_MARGIN = 1440;
const SOURCE_MARGIN = 1134;
const SAGE = '526D5B';
const INK = '303B34';
const MUTED = '69756D';
const PALE = 'F1F5EF';
const FONT = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Microsoft YaHei', cs: 'Calibri' };
const RASTER_NOTICE = 'Word 正文、译文与笔记是可编辑文字；附录是由原 PDF 整页渲染的无损 PNG 栅格图像，保留原论文图表及上下文，不是可编辑表格、矢量图或图表译文。图表不翻译、不重绘、不推断数据；原 PDF 仍是核对依据。';
const SAMPLE_NOTICE = '教学样例 · 仅用于功能演示，不可作为真实文献引用。';

const styles: IStylesOptions = {
  default: {
    document: {
      run: { font: FONT, size: 22, color: INK, language: { value: 'en-US', eastAsia: 'zh-CN' } },
      paragraph: { spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 140 }, keepNext: false, keepLines: false },
    },
    heading1: {
      name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { font: FONT, size: 34, color: SAGE, bold: true },
      paragraph: { spacing: { before: 360, after: 220, line: 300, lineRule: LineRuleType.AUTO }, keepNext: true, keepLines: true, outlineLevel: 0 },
    },
    heading2: {
      name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { font: FONT, size: 24, color: SAGE, bold: true },
      paragraph: { spacing: { before: 260, after: 120, line: 300, lineRule: LineRuleType.AUTO }, keepNext: true, keepLines: true, outlineLevel: 1 },
    },
  },
  paragraphStyles: [
    {
      id: 'Normal', name: 'Normal',
      run: { font: FONT, size: 22, color: INK },
      paragraph: { spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 140 }, keepNext: false, keepLines: false },
    },
    {
      id: 'QiyeMeta', name: '栖页 · 书目信息', basedOn: 'Normal', next: 'Normal',
      run: { size: 20, color: MUTED },
      paragraph: { spacing: { line: 320, lineRule: LineRuleType.AUTO, after: 160 } },
    },
    {
      id: 'QiyeQuote', name: '栖页 · 原文引文', basedOn: 'Normal', next: 'Normal',
      run: { color: '526055' },
      paragraph: {
        indent: { left: 240, right: 180 }, shading: { type: ShadingType.CLEAR, fill: PALE },
        border: { left: { style: BorderStyle.SINGLE, color: 'BBCABB', size: 16, space: 10 } },
        spacing: { before: 100, after: 180, line: 360, lineRule: LineRuleType.AUTO },
        keepNext: false, keepLines: false,
      },
    },
    {
      id: 'QiyeTranslation', name: '栖页 · 中文译文', basedOn: 'Normal', next: 'Normal',
      run: { color: '344C3C' },
      paragraph: { spacing: { before: 60, after: 160, line: 360, lineRule: LineRuleType.AUTO }, keepNext: false, keepLines: false },
    },
    {
      id: 'QiyeNotice', name: '栖页 · 阅读提示', basedOn: 'Normal', next: 'Normal',
      run: { size: 18, color: MUTED },
      paragraph: { spacing: { before: 40, after: 160, line: 300, lineRule: LineRuleType.AUTO }, keepNext: false, keepLines: false },
    },
  ],
};

function textRuns(text: string, run: IRunPropertiesOptions = {}): TextRun[] {
  // XML 1.0 cannot contain these control characters or lone UTF-16 surrogates.
  // Replace only invalid characters, preserving real Unicode text, tabs and line breaks.
  const clean = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/gu, '\uFFFD');
  return clean.split(/(\n|\t)/u).filter(part => part !== '').map(part => {
    if (part === '\n') return new TextRun({ ...run, break: 1 });
    if (part === '\t') return new TextRun({ ...run, children: [new Tab()] });
    // Use text, not children: a user's literal "CURRENT" must not become a PAGE field.
    return new TextRun({ ...run, text: part });
  });
}

function paragraph(text: string, properties: IParagraphPropertiesOptions = {}, run: IRunPropertiesOptions = {}): Paragraph {
  return new Paragraph({ widowControl: true, ...properties, children: textRuns(text, run) });
}

function heading(text: string, level: 'first' | 'second', pageBreakBefore = false): Paragraph {
  return paragraph(text, {
    heading: level === 'first' ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
    keepNext: true, keepLines: true, pageBreakBefore,
  });
}

function section(children: Paragraph[], source = false, landscape = false, cover = false): ISectionOptions {
  const margin = source ? SOURCE_MARGIN : BODY_MARGIN;
  return {
    properties: {
      type: SectionType.NEXT_PAGE,
      page: {
        // docx 9.16 swaps these dimensions itself for LANDSCAPE: do not swap twice.
        size: { ...A4, orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
        margin: { top: margin, bottom: margin, left: margin, right: margin, header: 567, footer: 567, gutter: 0 },
      },
    },
    headers: {
      default: new Header({ children: cover ? [new Paragraph({})] : [paragraph(
        source ? 'QIYE  /  栖页     原文图表附录' : 'QIYE  /  栖页     阅读整理',
        {
          spacing: { before: 0, after: 100, line: 240, lineRule: LineRuleType.AUTO },
          border: { bottom: { style: BorderStyle.SINGLE, color: 'DCE5D9', size: 4, space: 7 } },
        },
        { font: FONT, size: 16, color: SAGE },
      )] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
        children: [new TextRun({
          font: FONT, size: 16, color: MUTED,
          children: ['个人阅读整理  ·  第 ', PageNumber.CURRENT, ' 页 / 共 ', PageNumber.TOTAL_PAGES, ' 页'],
        })],
      })] }),
    },
    children,
  };
}

function coverPage(snapshot: ExportSnapshot, sourceCount: number, exportedAt: Date): Paragraph[] {
  const { paper } = snapshot;
  const date = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(exportedAt);
  const children = [
    paragraph('QIYE  /  栖页', { spacing: { before: 900, after: 600 } }, { size: 26, color: SAGE, characterSpacing: 35, bold: true }),
    paragraph('阅读整理', { spacing: { after: 400 }, keepNext: true }, { size: 64, color: SAGE, bold: true }),
  ];
  if (paper.sample) children.push(paragraph(SAMPLE_NOTICE, {
    style: 'QiyeNotice', shading: { type: ShadingType.CLEAR, fill: 'F7EEE4' }, spacing: { before: 60, after: 220 },
  }, { color: '856246', bold: true }));
  children.push(
    paragraph(paper.title, {
      spacing: { before: 120, after: 360, line: 300, lineRule: LineRuleType.AUTO }, keepLines: false,
      border: { bottom: { style: BorderStyle.SINGLE, color: 'B9CBB7', size: 8, space: 18 } },
    }, { size: paper.title.length > 100 ? 36 : 44, color: INK, bold: true }),
    paragraph(`作者  /  ${paper.authors || '未提供'}\n年份  /  ${paper.year || '未提供'}`, { style: 'QiyeMeta', spacing: { before: 220, after: 220 } }),
    paragraph(`整理时间  /  ${date}（本地时间）`, { style: 'QiyeMeta' }),
    paragraph(exportStats(paper), { style: 'QiyeMeta', spacing: { before: 100, after: 160 } }),
    paragraph(sourceCount ? `原文附录  /  本次保留 ${sourceCount} 页原 PDF 页图` : '原文附录  /  本次未包含原 PDF 页图', { style: 'QiyeNotice' }),
    paragraph('把阅读留成可以继续思考的文字。', { spacing: { before: 500, after: 180 } }, { size: 22, color: SAGE }),
    paragraph(READING_NOTICE, { style: 'QiyeNotice' }),
  );
  return children;
}

function itemParagraph(item: ExportItem): Paragraph {
  switch (item.kind) {
    case 'label': return heading(item.text, 'second');
    case 'quote': return paragraph(item.text, { style: 'QiyeQuote' });
    case 'translation': return paragraph(item.text, { style: 'QiyeTranslation' });
    case 'notice': return paragraph(item.text, { style: 'QiyeNotice' });
    case 'body': return paragraph(item.text, { style: 'Normal', keepNext: false, keepLines: false });
  }
}

function sourcePageSection(image: RenderedSourcePage): ISectionOptions {
  const landscape = image.width > image.height;
  const pageWidth = landscape ? A4.height : A4.width;
  const pageHeight = landscape ? A4.width : A4.height;
  // ImageRun uses 96-dpi display pixels (15 twips each), not the PNG's resolution.
  // Reserve 50 pt for captions and 12 pt for inline descent / the section-break paragraph.
  const maxWidth = (pageWidth - 2 * SOURCE_MARGIN) / 15;
  const maxHeight = (pageHeight - 2 * SOURCE_MARGIN - 1000 - 240) / 15;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  return section([
    paragraph(`原文第 ${image.page} 页`, {
      heading: HeadingLevel.HEADING_2, keepNext: true, keepLines: true,
      spacing: { before: 0, after: 100, line: 280, lineRule: LineRuleType.AUTO },
    }),
    paragraph('原 PDF 整页栅格图像  /  图表保留原样，不翻译', {
      style: 'QiyeNotice', keepNext: true,
      spacing: { before: 0, after: 160, line: 240, lineRule: LineRuleType.AUTO },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, keepLines: true, keepNext: false, widowControl: false,
      run: { size: 2 }, spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
      children: [new ImageRun({
        type: 'png', data: image.data,
        transformation: { width: image.width * scale, height: image.height * scale },
        altText: {
          name: `原文第 ${image.page} 页`, title: `原 PDF 第 ${image.page} 页（未经翻译）`,
          description: '由所关联的原 PDF 整页渲染，保留原论文图表和上下文；栅格图像，不能作为可编辑图表。',
        },
      })],
    }),
  ], true, landscape);
}

/** Builds a real OOXML Word document entirely in the browser; never triggers a download. */
export async function exportDocx(snapshot: ExportSnapshot, options: ExportOptions, context: ExportContext): Promise<Blob> {
  context.signal.throwIfAborted();
  if (options.includeSourcePages && (!snapshot.file || snapshot.file.size === 0)) {
    throw new Error('缺少原 PDF 文件，无法导出图表附录。请重新关联原文件，或取消勾选原文页图；不会静默省略附录。');
  }
  const pages = options.includeSourcePages ? parsePageRange(options.pageRange, snapshot.paper.pageCount) : [];
  context.report({ message: '正在编排可编辑的 Word 正文…', done: 0, total: 1 });
  await yieldExport(context);
  const content = buildExportSections(snapshot.paper, options);
  const sections: ISectionOptions[] = [section(coverPage(snapshot, pages.length, new Date()), false, false, true)];
  const body = [
    heading('阅读说明', 'first'),
    paragraph(READING_NOTICE, { style: 'QiyeQuote' }),
    paragraph('正文按当前保存的文献内容重新排版，保留原文页码、译文来源与核对提示；未保存的草稿不包含在内。Word 页码是整理版页码，不等于原论文页码。', { style: 'QiyeNotice' }),
    paragraph('中文采用微软雅黑，英文采用 Calibri；未安装字体时由 Word / WPS 使用本地字体替代，可改选等线或 Noto Sans SC。无法用于 Word 文本的控制字符以替代符显示，请回查原 PDF。', { style: 'QiyeNotice' }),
  ];
  if (snapshot.paper.sample) body.push(paragraph(SAMPLE_NOTICE, { style: 'QiyeQuote' }, { bold: true, color: '856246' }));
  if (snapshot.paper.sourceUrl) body.push(paragraph(`文献记录中的来源  /  ${snapshot.paper.sourceUrl}`, { style: 'QiyeNotice' }));
  if (snapshot.paper.warnings.length) body.push(heading('原文解析提示', 'second'), paragraph(snapshot.paper.warnings.join('\n'), { style: 'QiyeNotice' }));
  if (!options.includeSourcePages) body.push(paragraph('本次未包含原 PDF 页图；正文中的图表提及不是原图表的替代，请另外打开原 PDF 核对。', { style: 'QiyeNotice' }));

  const totalItems = content.reduce((sum, entry) => sum + entry.items.length + 1, 0);
  let done = 0;
  let sinceYield = 0;
  for (const [index, entry] of content.entries()) {
    body.push(heading(`${String(index + 1).padStart(2, '0')}  /  ${entry.title}`, 'first', true));
    body.push(paragraph(entry.intro, { style: 'QiyeNotice' }));
    done++;
    for (const item of entry.items) {
      context.signal.throwIfAborted();
      body.push(itemParagraph(item));
      done++;
      sinceYield += item.text.length;
      if (done % 24 === 0 || sinceYield >= 12000) {
        context.report({ message: `正在编排${entry.title}…`, done, total: totalItems });
        await yieldExport(context);
        sinceYield = 0;
      }
    }
    context.report({ message: `已编排${entry.title}`, done, total: totalItems });
    await yieldExport(context);
  }
  if (options.includeSourcePages) {
    body.push(
      heading('附录  /  原文图表与页面', 'first', true),
      paragraph(SOURCE_NOTICE, { style: 'QiyeQuote' }),
      paragraph(RASTER_NOTICE, { style: 'QiyeNotice' }),
      paragraph(`本次保留的原文页码  /  ${pages.join('、')}\n每张原页图最长边为 1800 像素，按页面方向等比排入独立 A4 分节，不裁切。`, { style: 'QiyeNotice' }),
    );
  }
  sections.push(section(body));

  if (options.includeSourcePages && snapshot.file) {
    // The generator verifies the file's actual page count before rendering, and
    // its finally also runs if an ImageRun fails or this export is cancelled.
    for await (const image of renderSourcePages(snapshot.file, pages, context, snapshot.paper.pageCount)) {
      context.signal.throwIfAborted();
      sections.push(sourcePageSection(image));
      await yieldExport(context);
    }
  }

  context.report({ message: '正在封装 Word 文件，原图表较多时可能需要一些时间…', done: 0, total: 1 });
  await yieldExport(context);
  const document = new Document({
    title: snapshot.paper.title, subject: snapshot.paper.sample ? SAMPLE_NOTICE : '文献个人阅读整理',
    creator: 'QIYE / 栖页', lastModifiedBy: 'QIYE / 栖页',
    description: `${READING_NOTICE}${options.includeSourcePages ? ` ${SOURCE_NOTICE} ${RASTER_NOTICE}` : ''}`,
    // PAGE fields are calculated by Word during layout; do not request updating
    // every field at open, which triggers an unnecessary external-content prompt.
    styles, sections, features: { updateFields: false },
  });
  const blob = await Packer.toBlob(document);
  // Packer cannot be interrupted. Yield once more so a queued cancellation is
  // processed before any caller can download the finished Blob.
  await yieldExport(context);
  if (blob.size > MAX_DOCX_BYTES) {
    throw new Error('Word 文件超过 80 MiB。请选择较少的原文页码分批导出，或减少导出章节；不会省略图片。');
  }
  context.report({ message: 'Word 文件已生成', done: 1, total: 1 });
  context.signal.throwIfAborted();
  return blob.type === DOCX_MIME ? blob : blob.slice(0, blob.size, DOCX_MIME);
}
