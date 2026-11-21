import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { loadPdf } from './pdf';

type Props = { file: Blob; page: number; onError?: (message: string) => void };

export default function PdfPage({ file, page, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const [status, setStatus] = useState({ message: '正在加载 PDF…', error: false });

  useEffect(() => {
    const container = containerRef.current, canvas = canvasRef.current;
    if (!container || !canvas) return;
    let disposed = false, sequence = 0, frame = 0, lastWidth = -1;
    let pdf: PDFDocumentProxy | undefined, proxy: PDFPageProxy | undefined, renderTask: RenderTask | undefined;
    const fail = (error: unknown) => {
      if (disposed) return;
      const message = error instanceof Error ? error.message : 'PDF 页面加载或渲染失败。';
      setStatus({ message, error: true });
      errorRef.current?.(message);
    };
    const render = async () => {
      const ticket = ++sequence;
      const previous = renderTask;
      previous?.cancel();
      try {
        await previous?.promise.catch(() => {});
        if (disposed || ticket !== sequence || !proxy) return;
        const width = container.clientWidth;
        if (width <= 0) { setStatus({ message: '等待阅读区域显示…', error: false }); return; }
        setStatus({ message: `正在渲染第 ${page} 页…`, error: false });
        const base = proxy.getViewport({ scale: 1 });
        const viewport = proxy.getViewport({ scale: width / base.width });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.ceil(viewport.width * ratio);
        canvas.height = Math.ceil(viewport.height * ratio);
        renderTask = proxy.render({ canvas, viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
        await renderTask.promise;
        if (!disposed && ticket === sequence) setStatus({ message: '', error: false });
      } catch (error) {
        if (!disposed && ticket === sequence && !(error instanceof Error && error.name === 'RenderingCancelledException')) fail(error);
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { void render(); });
    };
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width !== lastWidth) { lastWidth = entry.contentRect.width; schedule(); }
    });
    observer.observe(container);
    setStatus({ message: '正在加载 PDF…', error: false });
    void (async () => {
      try {
        const document = await loadPdf(file);
        if (disposed) { await document.loadingTask.destroy(); return; }
        pdf = document;
        if (!Number.isInteger(page) || page < 1 || page > pdf.numPages) throw new Error(`页码必须在 1–${pdf.numPages} 之间。`);
        proxy = await pdf.getPage(page);
        if (!disposed) schedule();
      } catch (error) { fail(error); }
    })();
    return () => {
      disposed = true; sequence++;
      observer.disconnect(); cancelAnimationFrame(frame);
      renderTask?.cancel();
      if (pdf) void pdf.loadingTask.destroy().catch(() => {});
      canvas.width = 0; canvas.height = 0;
    };
  }, [file, page]);

  return <div ref={containerRef} aria-busy={!!status.message && !status.error}
    style={{ width: '100%', minWidth: 0, minHeight: 160, position: 'relative' }}>
    {status.message && <div role={status.error ? 'alert' : 'status'}
      style={{ padding: 24, color: status.error ? '#9f342d' : 'inherit' }}>{status.message}</div>}
    <canvas ref={canvasRef} aria-label={`PDF 第 ${page} 页`}
      style={{ display: 'block', width: '100%', height: 'auto', visibility: status.message ? 'hidden' : 'visible' }} />
  </div>;
}
