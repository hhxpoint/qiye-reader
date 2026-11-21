import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Download, FileText, Languages, Loader2, Maximize2, MessageSquare, Pencil, Plus, Quote, Sparkles, Square, X } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import type { Paper, TextBlock, Note, Translation, ModelProgress } from './domain';
import { uid } from './domain';
import { canTranslateBlock, evidenceFor, translationState } from './text';
import { getFile } from './storage';
import PdfPage from './PdfPage';
import { hasBrowserSummarizer } from './engine';
export interface Job { paperId?: string; label: string; done: number; total: number; }
interface Props {
  paper: Paper; selectedId: string; onSelect: (id: string) => void; onBack: () => void;
  onUpdate: (id: string, transform: (paper: Paper) => Paper) => Promise<void>;
  onTranslate: (blocks: TextBlock[]) => void; onCancel: () => void; onExport: () => void;
  onGenerate: (blocks: TextBlock[]) => void; drafts: Record<string, string>;
  job: Job | null; progress: ModelProgress; onModels: () => void; exportDisabled?: boolean;
}
interface NoteDraft { paperId: string; text: string; blockId?: string; revision: string; }
const noteDraftKey = (paperId: string) => `qiye-reader-note-draft:${paperId}`;
export default function Reader({ paper, selectedId, onSelect, onBack, onUpdate, onTranslate, onCancel, onExport, onGenerate, drafts, job, progress, onModels, exportDisabled = false }: Props) {
  const [tab, setTab] = useState('translation');
  const [mode, setMode] = useState('text');
  const [file, setFile] = useState<Blob>();
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  const noteDraftRef = useRef<NoteDraft | null>(null);
  const savingRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selected = paper.blocks.find(b => b.id === selectedId) || paper.blocks.find(b => b.page === paper.currentPage) || paper.blocks[0];
  const translation = selected ? paper.translations[selected.id] : undefined;
  const note = noteDraft?.paperId === paper.id ? noteDraft.text : '';
  const noteBlock = note ? paper.blocks.find(b => b.id === noteDraft?.blockId) : selected;
  const evidence = useMemo(() => evidenceFor(paper, query), [paper.blocks, query]);
  const pageBlocks = paper.blocks.filter(b => b.page === paper.currentPage);
  const { remaining, completed, total, skipped } = translationState(paper);
  const selectedCanTranslate = selected ? canTranslateBlock(selected) : false;
  const reviewed = translation?.engine === '人工校订';
  const allTranslated = total > 0 && remaining.length === 0;
  const exportBusy = saving || Boolean(job) || exportDisabled;
  const evidenceToTranslate = remaining.filter(block => evidence.some(item => item.blockId === block.id));
  useEffect(() => { let alive = true; setFile(undefined); setMode('text'); setEditing(false); setQuery(''); if (paper.kind === 'pdf') getFile(paper.id).then(value => { if (alive) { setFile(value); if (!value) toast.error('原PDF不在本机，仍可阅读已保存文字。可通过完整备份恢复。'); } }).catch(() => toast.error('读取原PDF失败')); return () => { alive = false; }; }, [paper.id]);
  useEffect(() => {
    let draft: NoteDraft | null = null;
    try {
      const raw = sessionStorage.getItem(noteDraftKey(paper.id));
      if (raw !== null) {
        const value = JSON.parse(raw) as Partial<NoteDraft> | null;
        if (!value || typeof value !== 'object' || value.paperId !== paper.id || typeof value.text !== 'string' || !value.text.length || value.text.length > 10000 || typeof value.revision !== 'string' || !value.revision || (value.blockId !== undefined && typeof value.blockId !== 'string')) throw new Error('草稿格式无效');
        draft = { paperId: paper.id, text: value.text, revision: value.revision, ...(value.blockId !== undefined ? { blockId: value.blockId } : {}) };
      }
    } catch { toast.error('手写草稿恢复失败，可能是数据损坏或会话存储不可用；请检查浏览器存储权限。', { id: noteDraftKey(paper.id) }); }
    noteDraftRef.current = draft; setNoteDraft(draft);
  }, [paper.id]);
  useEffect(() => { setEditing(false); }, [selected?.id]);
  useEffect(() => { const node = selected && Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? []).find(element => element.dataset.blockId === selected.id); if (node && mode === 'text') node.scrollIntoView({ block: 'nearest', behavior: 'instant' }); }, [selected?.id, paper.currentPage, mode]);
  const changePage = async (page: number) => { if (page < 1 || page > paper.pageCount) return; try { await onUpdate(paper.id, p => ({ ...p, currentPage: page })); const block = paper.blocks.find(b => b.page === page); if (block) onSelect(block.id); } catch { toast.error('页码保存失败，请检查存储空间。'); } };
  const jump = async (id: string) => { const b = paper.blocks.find(item => item.id === id); if (!b) return; setMode('text'); onSelect(id); await changePage(b.page); onSelect(id); };
  const changeNote = (text: string) => {
    if (savingRef.current) return;
    const current = noteDraftRef.current;
    const blockId = current?.paperId === paper.id && current.text ? current.blockId : selected?.id;
    const draft: NoteDraft | null = text ? { paperId: paper.id, text, revision: uid(), ...(blockId !== undefined ? { blockId } : {}) } : null;
    noteDraftRef.current = draft; setNoteDraft(draft);
    // 每次输入同步暂存，切文献、返回和刷新均不依赖卸载回调。
    try {
      if (draft) sessionStorage.setItem(noteDraftKey(paper.id), JSON.stringify(draft));
      else sessionStorage.removeItem(noteDraftKey(paper.id));
      toast.dismiss(noteDraftKey(paper.id));
    } catch { toast.error('手写草稿暂存失败；切换文献、返回或刷新前请复制文字，并检查存储权限与空间。', { id: noteDraftKey(paper.id) }); }
  };
  const saveNote = async (text: string, block: TextBlock | undefined, clearDraft: boolean) => {
    if (savingRef.current || !text.trim()) return;
    const submittedDraft = clearDraft ? noteDraftRef.current : null;
    if (submittedDraft?.blockId !== undefined && !block) { toast.error('草稿原关联段落已不存在，请先复制文字再重新整理。'); return; }
    savingRef.current = true; setSaving(true);
    try {
      const item: Note = { id: uid(), text: text.trim().slice(0, 10000), ...(block ? { blockId: block.id, quote: block.text } : {}), createdAt: Date.now() };
      let storedDraft = submittedDraft ? JSON.stringify(submittedDraft) : null;
      if (submittedDraft) {
        try { storedDraft = sessionStorage.getItem(noteDraftKey(submittedDraft.paperId)); }
        catch { /* 暂不可读时仅匹配提交版本，保存后的清理失败会单独提示。 */ }
      }
      await onUpdate(paper.id, p => ({ ...p, notes: [...p.notes, item] }));
      if (submittedDraft) {
        if (noteDraftRef.current === submittedDraft) { noteDraftRef.current = null; setNoteDraft(current => current === submittedDraft ? null : current); }
        // 只删除提交的版本，避免旧保存完成后覆盖返回时的新输入。
        try {
          const key = noteDraftKey(submittedDraft.paperId);
          if (sessionStorage.getItem(key) === storedDraft) sessionStorage.removeItem(key);
        } catch { toast.error('笔记已保存，但会话草稿清除失败；刷新后可能再次出现，请勿重复保存。', { id: noteDraftKey(submittedDraft.paperId) }); }
      }
      toast.success('这一点想法，已经收好。');
    } catch { toast.error('笔记未保存，请保留文字并检查本地存储。'); } finally { savingRef.current = false; setSaving(false); }
  };
  const saveEdit = async () => { if (savingRef.current || !selected || !edited.trim()) return; savingRef.current = true; setSaving(true); try { const value: Translation = { text: edited.trim(), engine: '人工校订', createdAt: Date.now(), issues: [] }; await onUpdate(paper.id, p => ({ ...p, translations: { ...p.translations, [selected.id]: value } })); setEditing(false); toast.success('已保存校订译文'); } catch { toast.error('校订未保存，请重试'); } finally { savingRef.current = false; setSaving(false); } };
  const deleteNote = async (item: Note) => {
    if (savingRef.current) return;
    const paperId = paper.id, index = paper.notes.findIndex(n => n.id === item.id);
    try {
      await onUpdate(paperId, p => ({ ...p, notes: p.notes.filter(n => n.id !== item.id) }));
      toast.success('笔记已删除', { id: `deleted-note:${paperId}:${item.id}`, duration: 15000, action: { label: '撤销', onClick: () => {
        void onUpdate(paperId, p => p.notes.some(n => n.id === item.id) ? p : { ...p, notes: [...p.notes.slice(0, index), item, ...p.notes.slice(index)] }).catch(() => toast.error('撤销失败，请检查本地存储。'));
      } } });
    } catch { toast.error('删除失败'); }
  };
  return <div className={`reader-workspace ${focus ? 'focus-mode' : ''}`}>
    <header className="reader-topbar">
      <button className="icon-button" onClick={onBack} aria-label="返回文献库"><ArrowLeft size={19}/></button>
      <div className="reader-title"><span className="eyebrow">IN YOUR READING SPACE</span><h1>{paper.title}</h1></div>
      <button className="icon-button" onClick={() => setFocus(v => !v)} aria-label={focus ? '退出专注模式' : '专注阅读'} aria-pressed={focus}><Maximize2 size={18}/></button>
      <button className="button secondary compact" disabled={exportBusy} onClick={onExport} aria-label="导出阅读整理" title="导出阅读整理"><Download size={16}/><span>导出阅读整理</span></button>
    </header>
    <div className="reader-columns">
      <section className="reading-main" aria-label="原文阅读">
        <div className="reading-toolbar"><div className="segmented"><button className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}><FileText size={15}/>段落阅读</button><button disabled={!file} className={mode === 'pdf' ? 'active' : ''} onClick={() => setMode('pdf')} title={!file ? '文本示例没有原PDF；导入PDF后可用' : '查看原始排版'}><BookOpen size={15}/>原 PDF</button></div><div className="page-control"><button className="icon-button" disabled={paper.currentPage <= 1} onClick={() => void changePage(paper.currentPage - 1)} aria-label="上一页"><ChevronLeft size={17}/></button><span>{paper.currentPage} <i>/ {paper.pageCount}</i></span><button className="icon-button" disabled={paper.currentPage >= paper.pageCount} onClick={() => void changePage(paper.currentPage + 1)} aria-label="下一页"><ChevronRight size={17}/></button></div></div>
        <div className="reading-scroll" ref={scrollRef}>
          {paper.sample && <div className="sample-notice">原创教学示例 · 非发表论文 · 翻译由当前引擎实时生成</div>}
          {paper.warnings.length > 0 && <details className="reading-warning"><summary>解析提示 · {paper.warnings.length} 项需留意</summary>{paper.warnings.map((w, i) => <p key={i}>{w}</p>)}</details>}
          {mode === 'pdf' && file ? <PdfPage file={file} page={paper.currentPage} onError={message => toast.error(message)}/> : <article className="paper-sheet">
            {paper.currentPage === 1 && <header className="paper-heading"><div className="paper-kicker">{paper.category} <span> / </span> {paper.year}</div><h2>{paper.title}</h2><p>{paper.authors}</p><div className="paper-divider"/></header>}
            {!pageBlocks.length && <div className="empty-inline"><FileText size={30}/><h3>这一页暂时没有可读取文字</h3><p>可能是扫描页或特殊编码。请查看原 PDF；本版不会把空白解析成摘要。</p></div>}
            {pageBlocks.map((block, index) => {
              const blockTranslation = paper.translations[block.id];
              const blockReviewed = blockTranslation?.engine === '人工校订';
              const eligible = canTranslateBlock(block);
              return <div key={block.id} data-block-id={block.id} className={`text-block ${selected?.id === block.id ? 'selected' : ''}`}>
                {(index === 0 || pageBlocks[index - 1].section !== block.section) && <h3 className="section-label">{block.section}</h3>}
                <button className="paragraph-select" onClick={() => onSelect(block.id)} aria-label={`选中第 ${paper.blocks.indexOf(block) + 1} 段`}><span>{block.text}</span></button>
                <div className="block-actions">
                  <span>§ {String(paper.blocks.indexOf(block) + 1).padStart(2, '0')}</span>
                  <button onClick={() => { onSelect(block.id); setTab('translation'); if (eligible && !blockReviewed) onTranslate([block]); }} disabled={!blockReviewed && (Boolean(job) || saving || !eligible)} title={blockReviewed ? '查看已校订译文，可在译文卡中继续编辑；不会重新翻译' : !eligible ? '短标题或非英文内容不计入翻译进度' : undefined}>
                    {blockReviewed ? <Check size={14}/> : <Languages size={14}/>}{blockReviewed ? '已校订' : !eligible ? '无需翻译' : blockTranslation ? '重新翻译' : '翻译这一段'}
                  </button>
                  <button onClick={() => { onSelect(block.id); setTab('notes'); }}><Plus size={14}/>记一点想法</button>
                  {blockTranslation && !blockReviewed && <span className="block-translated"><Check size={14}/>已译</span>}
                </div>
              </div>;
            })}
            <footer className="paper-foot">栖页 · 每一次理解，都从原文开始 <span>{paper.currentPage}</span></footer>
          </article>}
        </div>
      </section>
      <aside className="reading-companion" aria-label="阅读助手">
        <Tabs value={tab} onValueChange={setTab} className="companion-tabs">
          <TabsList className="companion-tab-list"><TabsTrigger value="translation"><Languages size={16}/>翻译</TabsTrigger><TabsTrigger value="evidence"><Sparkles size={16}/>提要</TabsTrigger><TabsTrigger value="notes"><Pencil size={16}/>笔记 <small>{paper.notes.length || ''}</small></TabsTrigger></TabsList>
          <div className="companion-scroll">
            {job && <div className="task-card" role="status"><div><Loader2 size={16} className="spin"/><strong>{job.paperId && job.paperId !== paper.id ? `另一篇文献 · ${job.label}` : job.label}</strong><button onClick={onCancel} className="icon-button" aria-label="取消当前任务"><Square size={13}/></button></div><p>{progress.message}</p>{progress.total && progress.loaded !== undefined ? <progress value={progress.loaded} max={progress.total}/> : <div className="indeterminate"/>}<small>已完成 {job.done} / {job.total} · 可随时取消，已保存结果不会丢失</small></div>}
            <TabsContent value="translation" className="panel-content">
              <div className="panel-heading"><span className="eyebrow">A LITTLE MORE CLARITY</span><h2>让理解，再近一点。</h2><p>英文原文 → 中文 · 保留专业表达的分寸</p></div>
              {selected ? <div className="translation-stack">
                <details className="source-reference" key={selected.id}>
                  <summary><span><Quote size={14}/>原文出处</span><span className="source-location">第 {selected.page} 页 · 段落 {paper.blocks.indexOf(selected) + 1}</span><ChevronDown size={15} aria-hidden="true"/></summary>
                  <p>{selected.text}</p>
                </details>
                {translation ? <>
                  <section className="translation-result" aria-label="选中段落译文">
                    <div className="result-meta">
                      <div className="result-origin"><strong>中文译文</strong><span>{reviewed ? <Check size={13}/> : <span className="status-dot"/>}{translation.engine}</span></div>
                      <button className="button secondary compact translation-edit" disabled={saving || editing} onClick={() => { if (savingRef.current) return; setEdited(translation.text); setEditing(true); }} aria-label={reviewed ? '继续校订译文' : '校订译文'}><Pencil size={14}/>{reviewed ? '继续校订' : '校订译文'}</button>
                    </div>
                    {editing ? <>
                      <textarea className="edit-translation" disabled={saving} value={edited} onChange={e => { if (!savingRef.current) setEdited(e.target.value); }} aria-label="校订后的译文" maxLength={12000}/>
                      <div className="action-row"><button className="button primary compact" disabled={saving || !edited.trim()} onClick={() => void saveEdit()}>{saving ? '保存中…' : '保存校订'}</button><button className="button ghost compact" disabled={saving} onClick={() => { if (!savingRef.current) setEditing(false); }}>取消</button></div>
                    </> : <p className="translated-text">{translation.text}</p>}
                  </section>
                  <section className="translation-quality" aria-label="译文质量说明">
                    <h3>译文核对</h3>
                    {translation.issues.length > 0 && <details className="quality-notes"><summary>有 {translation.issues.length} 项值得核对</summary>{translation.issues.map((issue, index) => <p key={index}>{issue}</p>)}</details>}
                    <p>{reviewed ? '人工校订已保存，可随时继续编辑。' : '请结合原文核对术语与细节。校验提示仅供辅助，不代表译文准确率。'}</p>
                  </section>
                </> : selectedCanTranslate ? <div className="translation-empty">
                  <div className="soft-icon"><Languages size={27}/></div><h3>在两种语言之间，搭一座小桥。</h3><p>选中段落的中文译文会出现在这里，原文始终留在身边。</p>
                  <button className="button primary" disabled={Boolean(job) || saving} onClick={() => onTranslate([selected])}><Languages size={16}/>翻译选中段落</button>
                  <button className="text-button" onClick={onModels}>首次使用，了解模型下载</button>
                </div> : <div className="translation-empty translation-unavailable"><div className="soft-icon"><FileText size={25}/></div><h3>这一段无需翻译</h3><p>短标题或非英文内容不计入翻译进度。你仍可阅读原文、记录想法。</p></div>}
              </div> : <p className="reader-empty-copy">当前文献没有可读取的文字，请查看原 PDF。</p>}
              <section className={`translation-batch ${allTranslated ? 'is-complete' : ''}`} aria-label="全文翻译">
                <div className="batch-heading" role="status" aria-live="polite" aria-atomic="true">
                  <span className="batch-icon">{allTranslated ? <Check size={20}/> : total ? <Languages size={20}/> : <FileText size={20}/>}</span>
                  <div><h3>{allTranslated ? '全文翻译已完成' : total ? '全文翻译' : '暂无可译段落'}</h3><p>已译 <strong>{completed}</strong> / 可译 <strong>{total}</strong> 段</p></div>
                </div>
                {total > 0 ? <>
                  <progress className="translation-progress" value={completed} max={total} aria-label="全文翻译进度"/>
                  {skipped > 0 && <p className="batch-skipped">另有 {skipped} 段短标题或非英文内容，未计入进度。</p>}
                  {allTranslated ? <button className="button secondary full-width" disabled={exportBusy} onClick={onExport}><Download size={16}/>导出阅读整理</button> : <button className="button primary full-width" disabled={Boolean(job) || saving} onClick={() => onTranslate(remaining)}><Languages size={16}/>{completed > 0 ? '继续翻译' : '开始翻译'}</button>}
                  <p className="fine-print">译文逐段自动保存，不改动原 PDF。</p>
                </> : <p className="batch-empty-copy">当前没有满足翻译条件的英文段落。可继续阅读原文或整理笔记。</p>}
              </section>
            </TabsContent>
            <TabsContent value="evidence" className="panel-content">
              <div className="panel-heading"><span className="eyebrow">FOLLOW THE EVIDENCE</span><h2>带着出处，抓住重点。</h2><p>从正文抽取的证据提要，不等同于完整综述。</p></div>
              <input className="field evidence-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="用原文关键词查找证据…" aria-label="查找原文证据"/>
              <div className="evidence-meta"><span>选取 {evidence.length} 段 / 全文 {paper.blocks.length} 段</span><button className="text-button" disabled={Boolean(job) || saving || !evidenceToTranslate.length} onClick={() => onTranslate(evidenceToTranslate)} title={!evidenceToTranslate.length ? '所选证据没有待翻译段落' : '仅翻译尚未完成的可译证据'}>翻译这些证据</button></div>
              {evidence.map((item, index) => <div className="evidence-card" key={item.blockId}><button className="evidence-header" onClick={() => void jump(item.blockId)}><span className="evidence-number">{String(index + 1).padStart(2, '0')}</span><strong>{item.section}</strong><span>p. {item.page}<ArrowUpRight size={14}/></span></button><p>{item.text}</p>{paper.translations[item.blockId] && <div className="evidence-translation">{paper.translations[item.blockId].text}</div>}{drafts[item.blockId] && <div className="generated-draft"><span>本地生成草稿 · 待核对</span><p>{drafts[item.blockId]}</p><button className="text-button" disabled={saving} onClick={() => void saveNote(`生成草稿（待核对）：\n${drafts[item.blockId]}`, paper.blocks.find(b => b.id === item.blockId), false)}>存为阅读笔记</button></div>}</div>)}
              {!evidence.length && <p className="empty-inline">没有匹配证据。试试原文中的其他关键词；不会编造答案。</p>}
              <div className="optional-model"><Sparkles size={18}/><div><strong>进一步整理为摘要草稿</strong><p>{hasBrowserSummarizer() ? '使用浏览器本地摘要模型逐段整理，保留证据回链。输出为英文，仍需核对。' : '当前浏览器未开放本地生成摘要。证据提要与翻译仍可使用，无需云端API。'}</p><button className="button secondary compact" disabled={!hasBrowserSummarizer() || Boolean(job) || !evidence.length} onClick={() => onGenerate(evidence.map(e => paper.blocks.find(b => b.id === e.blockId)!))}>生成摘要草稿</button></div></div>
            </TabsContent>
            <TabsContent value="notes" className="panel-content">
              <div className="panel-heading"><span className="eyebrow">MAKE ROOM FOR YOUR THOUGHTS</span><h2>把此刻的想法，留下来。</h2><p>不必写得完整，一句话也很好。</p></div>
              {noteBlock && <div className="note-anchor"><Quote size={15}/><span>关联第 {noteBlock.page} 页 · 段落 {paper.blocks.indexOf(noteBlock) + 1}</span><button className="text-button" onClick={() => void jump(noteBlock.id)}>查看原文</button></div>}
              {note && !noteBlock && <p className="fine-print">{noteDraft?.blockId !== undefined ? '草稿原关联段落已不存在，请先复制文字再重新整理。' : '这条草稿没有关联原文段落。'}</p>}
              <textarea className="field note-input" disabled={saving} value={note} onChange={e => changeNote(e.target.value)} maxLength={10000} placeholder="我读到了什么？还有什么想知道的？" aria-label="阅读笔记"/>
              <button className="button primary full-width" disabled={!note.trim() || saving} onClick={() => void saveNote(note, noteBlock, true)}><Plus size={16}/>收好这条笔记</button>
              <div className="notes-list">{paper.notes.slice().reverse().map(item => <div className="note-card" key={item.id}><div className="note-card-top"><span>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</span><button className="icon-button" aria-label="删除这条笔记" disabled={saving} onClick={() => void deleteNote(item)}><X size={14}/></button></div>{item.quote && <button className="note-quote" onClick={() => item.blockId && void jump(item.blockId)}>{item.quote.slice(0, 150)}{item.quote.length > 150 ? '…' : ''}</button>}<p>{item.text}</p></div>)}{!paper.notes.length && <div className="empty-inline"><MessageSquare size={24}/><p>这里会慢慢长出你的思考。</p></div>}</div>
            </TabsContent>
          </div>
        </Tabs>
        <div className="companion-footer"><span className="status-dot"/>仅存此浏览器 · 记得导出备份</div>
      </aside>
    </div>
  </div>;
}
