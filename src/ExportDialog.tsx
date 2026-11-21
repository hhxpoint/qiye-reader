import { useEffect, useRef, useState } from 'react';
import { Check, Download, FileText, Image, Loader2, LockKeyhole, Square } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { downloadBlob } from './text';
import { buildExportSections, exportStats, initialExportOptions, parsePageRange, READING_NOTICE, safeExportName, type ExportFormat, type ExportOptions, type ExportProgress, type ExportSnapshot } from './export-model';
import './export.css';

const formats = [
  { id: 'pdf', name: 'PDF', note: '精美排版 · 原页保真', label: 'PDF 文档' },
  { id: 'docx', name: 'Word', note: '可编辑正文 · 高清页图', label: 'Word 文档' },
  { id: 'md', name: 'Markdown', note: '轻量文字 · 便于整理', label: 'Markdown 文档' },
] as const;

export default function ExportDialog({ snapshot, onClose }: { snapshot: ExportSnapshot; onClose: () => void }) {
  const { paper, file } = snapshot;
  const [options, setOptions] = useState<ExportOptions>(() => initialExportOptions(Boolean(file)));
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<ExportProgress>({ message: '', done: 0, total: 1 });
  const controllerRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; controllerRef.current?.abort(); }, []);
  // StrictMode effect replay must leave the live instance mounted.
  useEffect(() => { mounted.current = true; }, []);
  const cancel = () => { if (controllerRef.current) { controllerRef.current.abort(new DOMException('导出已取消', 'AbortError')); setCancelling(true); } };
  const patch = (value: Partial<ExportOptions>) => { if (!controllerRef.current) { setOptions(current => ({ ...current, ...value })); setError(''); setProgress({ message: '', done: 0, total: 1 }); } };
  const chooseFormat = (format: ExportFormat) => patch({ format, includeSourcePages: format !== 'md' && Boolean(file) });
  let pageCount = 0, pageError = '';
  if (options.includeSourcePages) {
    try { pageCount = parsePageRange(options.pageRange, paper.pageCount).length; }
    catch (error) { pageError = error instanceof Error ? error.message : '页码无效'; }
  }
  const empty = !options.includeText && !options.includeEvidence && !options.includeNotes && !options.includeSourcePages;
  const generate = async () => {
    if (controllerRef.current || pageError || empty) return;
    const controller = new AbortController(); controllerRef.current = controller;
    setBusy(true); setError(''); setCancelling(false);
    setProgress({ message: '正在准备文献快照', done: 0, total: 1 });
    const context = { signal: controller.signal, report: (next: ExportProgress) => { if (mounted.current && !controller.signal.aborted) setProgress(next); } };
    try {
      let blob: Blob;
      if (options.format === 'pdf') {
        const { exportPdf } = await import('./export-pdf');
        blob = await exportPdf(snapshot, options, context);
      } else if (options.format === 'docx') {
        const { exportDocx } = await import('./export-docx');
        blob = await exportDocx(snapshot, options, context);
      } else {
        const sections = buildExportSections(paper, options);
        const lines = [`# ${paper.title}`, '', `${paper.authors} · ${paper.year}`, '', `> ${READING_NOTICE}`, '', ...sections.flatMap(section => [`## ${section.title}`, '', section.intro, '', ...section.items.flatMap(item => [item.kind === 'label' ? `### ${item.text}` : item.kind === 'quote' || item.kind === 'notice' ? item.text.split('\n').map(line => `> ${line}`).join('\n') : item.text, ''])])];
        blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
      }
      controller.signal.throwIfAborted();
      if (!mounted.current) return;
      downloadBlob(blob, safeExportName(paper.title, options.format));
      toast.success(`已生成 ${options.format === 'docx' ? 'Word' : options.format.toUpperCase()} 阅读整理，请在浏览器下载中查看。`);
      setProgress({ message: `文件已生成 · ${(blob.size / 1024 / 1024).toFixed(2)} MiB`, done: 1, total: 1 });
    } catch (error) {
      if (!mounted.current) return;
      if (controller.signal.aborted) { setProgress({ message: '已取消，原文和笔记没有改变。', done: 0, total: 1 }); }
      else { setError(error instanceof Error ? error.message : '导出未完成，请重试。原文与笔记没有改变。'); setProgress({ message: '', done: 0, total: 1 }); }
    } finally {
      controllerRef.current = null;
      if (mounted.current) { setBusy(false); setCancelling(false); }
    }
  };
  const chapters = [options.includeEvidence && '证据提要', options.includeText && '原文与译文', options.includeNotes && '阅读笔记', options.includeSourcePages && '原页图表附录'].filter(Boolean);
  return <Dialog open onOpenChange={open => { if (!open) { if (controllerRef.current) cancel(); else onClose(); } }}>
    <DialogContent className="qiye-dialog export-dialog" onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><span className="eyebrow">TAKE YOUR UNDERSTANDING WITH YOU</span><DialogTitle>把理解，整理成册。</DialogTitle><DialogDescription>在本机生成一份有出处、可保存的阅读整理。无需上传文献或付费服务。</DialogDescription></DialogHeader>
      <div className="export-layout">
        <aside className="export-preview" aria-label="导出排版示意">
          <div className="export-mini-page"><span className="mini-brand">QIYE / 栖页</span><div className="mini-rule"/><span className="mini-kicker">READING COMPANION</span><strong>阅读整理</strong><h3>{paper.title}</h3><p>{paper.authors}</p><span className="mini-date">{paper.year} · {paper.pageCount} 页原文</span><div className="mini-contents">{chapters.map((chapter, i) => <div key={String(chapter)}><span>{String(i + 1).padStart(2, '0')}</span>{chapter}</div>)}</div><div className="mini-footer">每一次理解，都从原文开始。</div></div>
          <p>排版示意 · 实际页数按内容自动生成</p>
          <div className="export-preview-spec"><span>A4 版心</span><span>来源页码</span><span>分级标题</span></div>
        </aside>
        <div className="export-controls">
          <fieldset disabled={busy} className="export-fieldset"><legend>选择文件格式</legend><div className="export-formats">{formats.map(format => <label className={`export-format ${options.format === format.id ? 'selected' : ''}`} key={format.id}><input type="radio" name="export-format" value={format.id} checked={options.format === format.id} onChange={() => chooseFormat(format.id)} aria-label={format.label}/><span><strong>{format.name}</strong><small>{format.note}</small></span>{options.format === format.id && <Check size={15}/>}</label>)}</div></fieldset>
          <fieldset disabled={busy} className="export-fieldset export-chapters"><legend>整理哪些内容</legend>{([
            ['includeEvidence', '证据提要', '保留原句、译文和出处'], ['includeText', '原文与译文', '逐段对照，标明校订状态'], ['includeNotes', '已保存笔记', `${paper.notes.length} 条想法与关联引文`],
          ] as const).map(([key, title, detail]) => <label className="export-check" key={key}><input type="checkbox" checked={options[key]} onChange={event => patch({ [key]: event.target.checked })}/><span><strong>{title}</strong><small>{detail}</small></span></label>)}</fieldset>
          <div className={`export-source-box ${options.includeSourcePages ? 'enabled' : ''}`}>
            <label className="export-check"><input type="checkbox" checked={options.includeSourcePages} disabled={busy || !file || options.format === 'md'} onChange={event => patch({ includeSourcePages: event.target.checked })}/><span><strong><Image size={15}/>保留原论文图表</strong><small>{options.format === 'md' ? 'Markdown 不包含图片，请选择 PDF 或 Word。' : !file ? paper.kind === 'pdf' ? '原 PDF 不在本机，请先恢复完整备份。' : '文字文稿没有原 PDF 图表。' : options.format === 'pdf' ? '直接附入原 PDF 页面，保留矢量图表与图注。' : '附入高清整页图片，图表不裁切；图片内容不可编辑。'}</small></span></label>
            {options.includeSourcePages && <label className="export-range">附录页码 <span>留空为全部 {paper.pageCount} 页</span><input className="field" aria-label="附录原文页码" aria-invalid={Boolean(pageError)} aria-describedby={pageError ? 'export-page-error' : undefined} value={options.pageRange} disabled={busy} maxLength={500} onChange={event => patch({ pageRange: event.target.value })} placeholder="全部页，或 1-3,5,8"/>{pageError ? <small id="export-page-error" className="export-error">{pageError}</small> : <small>将附上 {pageCount} 页原文；不自动翻译图表内文字。</small>}</label>}
          </div>
          <p className="export-disclosure"><LockKeyhole size={14}/><span>只导出此刻已保存的内容；未保存编辑不会包含。机器译文仍需核对，原论文版权归原作者。</span></p>
        </div>
      </div>
      <div className="export-bottom"><div className="export-summary"><FileText size={17}/><span>{exportStats(paper)}</span></div>{empty && <p className="export-error" role="alert">请至少选择一项导出内容。</p>}{error && <p className="export-error" role="alert">{error}</p>}{progress.message && <div className="export-progress" role="status"><span>{cancelling ? '正在停止，当前步骤结束后取消…' : progress.message}</span>{busy && <progress value={progress.done} max={Math.max(1, progress.total)}/>}</div>}<div className="export-actions"><span>全程本地处理</span>{busy ? <button className="button secondary" disabled={cancelling} onClick={cancel}><Square size={14}/>{cancelling ? '正在取消' : '取消导出'}</button> : <button className="button secondary" onClick={onClose}>返回阅读</button>}<button className="button primary" onClick={() => void generate()} disabled={busy || Boolean(pageError) || empty}>{busy ? <Loader2 size={17} className="spin"/> : <Download size={17}/>} {busy ? '正在整理' : `生成 ${options.format === 'docx' ? 'Word' : options.format === 'md' ? 'Markdown' : 'PDF'}`}</button></div></div>
    </DialogContent>
  </Dialog>;
}
