import { OPS, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import { createImageGuard } from './source-image-check';
import { loadPdf } from './pdf';
import { yieldExport, type ExportContext } from './export-model';

export interface RenderedSourcePage {
  page: number;
  /** Lossless PNG bytes; width and height are the encoded image's pixel dimensions. */
  data: Uint8Array;
  width: number;
  height: number;
}

const LONG_EDGE = 1800;
const MAX_IMAGE_BYTES = 60 * 1024 * 1024;
const sizeMessage = '原 PDF 页图累计超过 60 MiB。请选择较少的页码，分批导出；不会省略图片或降低图片质量。';

/** Observe cancellation without leaving a late rejection or an abort listener behind. */
function waitForAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason ?? new DOMException('导出已取消', 'AbortError'));
    };
    work.then(value => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) abort(); else resolve(value);
    }, error => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

function encodePng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob?.size && blob.type === 'image/png') resolve(blob);
      else reject(new Error('浏览器无法生成无损 PNG 页图，请尝试更新浏览器后重试。'));
    }, 'image/png');
  });
}

/**
 * Owns a separate PDF.js document and an off-screen canvas, never the reader's canvas.
 * Consumers must use for-await (or call return()) so early exit also runs finally.
 * Supply the snapshot page count to reject an incorrectly associated source file.
 */
export async function* renderSourcePages(
  file: Blob,
  pages: readonly number[],
  context: ExportContext,
  expectedPageCount?: number,
): AsyncGenerator<RenderedSourcePage, void, unknown> {
  const { signal } = context;
  signal.throwIfAborted();
  if (!file || file.size === 0) throw new Error('缺少原 PDF 文件，无法保留图表附录。请重新关联原文件，或取消勾选原文页图。');
  if (!pages.length) throw new Error('未选择任何原 PDF 页码，请选择页码后重试。');
  if (expectedPageCount !== undefined && (!Number.isInteger(expectedPageCount) || expectedPageCount < 1)) {
    throw new Error('文献记录中的原 PDF 页数无效，请重新导入原文件。');
  }

  let pdf: PDFDocumentProxy | undefined;
  let renderTask: RenderTask | undefined;
  let disposal: Promise<void> | undefined;
  let closed = false;
  let imageBytes = 0;
  const destroy = () => {
    if (!pdf) return Promise.resolve();
    return disposal ??= pdf.loadingTask.destroy().catch(() => {});
  };
  const abort = () => {
    renderTask?.cancel();
    void destroy();
  };
  signal.addEventListener('abort', abort, { once: true });

  try {
    context.report({ message: '正在打开原 PDF，准备保留图表…', done: 0, total: pages.length });
    await yieldExport(context);
    // loadPdf has no signal parameter. If loading finishes after cancellation,
    // dispose its worker here instead of leaking a document the caller never receives.
    const loading = loadPdf(file, true).then(async document => {
      pdf = document;
      if (closed || signal.aborted) {
        await destroy();
        signal.throwIfAborted();
        throw new Error('原 PDF 渲染任务已结束。');
      }
      return document;
    });
    pdf = await waitForAbort(loading, signal);
    signal.throwIfAborted();
    if (expectedPageCount !== undefined && pdf.numPages !== expectedPageCount) {
      throw new Error(`原 PDF 实际为 ${pdf.numPages} 页，与文献记录的 ${expectedPageCount} 页不一致。请重新关联正确的原文件后导出。`);
    }
    if (pages.some(page => !Number.isInteger(page) || page < 1 || page > pdf!.numPages)) {
      throw new Error(`原 PDF 页码必须在 1–${pdf.numPages} 之间，请重新选择页码。`);
    }

    for (const [index, page] of pages.entries()) {
      signal.throwIfAborted();
      context.report({ message: `正在保留原文第 ${page} 页的图表（${index + 1}/${pages.length}）…`, done: index, total: pages.length });
      const proxy = await waitForAbort(pdf.getPage(page), signal);
      let canvas: HTMLCanvasElement | undefined;
      let image: RenderedSourcePage;
      try {
        signal.throwIfAborted();
        // getViewport includes the PDF page's intrinsic rotation.
        const base = proxy.getViewport({ scale: 1 });
        if (![base.width, base.height].every(value => Number.isFinite(value) && value > 0)) {
          throw new Error(`原 PDF 第 ${page} 页的页面尺寸无效，无法完整保留。`);
        }
        const viewport = proxy.getViewport({ scale: LONG_EDGE / Math.max(base.width, base.height) });
        canvas = document.createElement('canvas');
        canvas.width = Math.min(LONG_EDGE, Math.max(1, Math.ceil(viewport.width)));
        canvas.height = Math.min(LONG_EDGE, Math.max(1, Math.ceil(viewport.height)));
        if (!canvas.getContext('2d')) throw new Error('浏览器无法创建 PDF 页图画布。');
        const task = proxy.render({ canvas, viewport, intent: 'print', background: '#ffffff', operationsFilter: createImageGuard(proxy, OPS) });
        renderTask = task;
        task.onContinue = (resume: () => void) => {
          void yieldExport(context).then(resume).catch(() => task.cancel());
        };
        await waitForAbort(task.promise, signal);
        signal.throwIfAborted();
        const png = await waitForAbort(encodePng(canvas), signal);
        if (imageBytes + png.size > MAX_IMAGE_BYTES) throw new Error(sizeMessage);
        const data = new Uint8Array(await waitForAbort(png.arrayBuffer(), signal));
        signal.throwIfAborted();
        imageBytes += data.byteLength;
        image = { page, data, width: canvas.width, height: canvas.height };
      } catch (error) {
        signal.throwIfAborted();
        throw new Error(`保留原文第 ${page} 页失败：${error instanceof Error ? error.message : 'PDF 页面无法渲染，请检查原文件。'}`);
      } finally {
        // Never clear a canvas while PDF.js can still be drawing into it.
        renderTask?.cancel();
        await renderTask?.promise.catch(() => {});
        renderTask = undefined;
        try { proxy.cleanup(); }
        finally {
          if (canvas) { canvas.width = 0; canvas.height = 0; }
        }
      }
      signal.throwIfAborted();
      context.report({ message: `已保留原文第 ${page} 页（无损 PNG）`, done: index + 1, total: pages.length });
      // Release rendering resources before the consumer retains the encoded image.
      yield image;
      await yieldExport(context);
    }
  } finally {
    closed = true;
    signal.removeEventListener('abort', abort);
    renderTask?.cancel();
    await renderTask?.promise.catch(() => {});
    await destroy();
  }
}
