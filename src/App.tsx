import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, BookMarked, BookOpen, Check, ChevronDown, CircleHelp, CloudOff, Coffee, Download, FileText, FolderOpen, Leaf, Library, Loader2, MoreHorizontal, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Star, Trash2, Upload, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import type { Paper, TextBlock, Term, ModelProgress, Preferences } from './domain';
import { DEFAULT_PREFERENCES, uid } from './domain';
import { getPapers, getFile, savePaper, deletePaper, getSetting, setSetting, exportBackup, restoreBackup } from './storage';
import { fromText, makeSamples, translationIssues, downloadBlob, canTranslateBlock } from './text';
import ExportDialog from './ExportDialog';
import type { ExportSnapshot } from './export-model';
import { cancelEngine, hasBrowserTranslator, prepareEngine, summarizeEvidence, translateText } from './engine';
import Reader, { type Job } from './Reader';

type View = 'library' | 'starred' | 'notes' | 'reader';
function BookMark() { return <svg viewBox="0 0 40 40" aria-hidden="true"><path d="M7 11C14 10 18 13 20 16C22 13 27 10 33 11V31C27 30 23 31 20 34C17 31 13 30 7 31Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M20 16V34M20 11C20 6 25 3 30 4C30 9 26 13 20 11Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>; }
function Cover({ paper, index }: { paper: Paper; index: number }) { return <div className={`paper-cover ${paper.color}`}><span className="cover-index">QIYE / {String(index + 1).padStart(2, '0')}</span><span className="cover-type">{paper.sample ? '教学示例' : paper.kind.toUpperCase()}</span><div className={`cover-art art-${index % 3}`} aria-hidden="true"><i/><i/><i/><i/></div><span className="cover-caption">{paper.category}</span></div>; }
const humanError = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请稍后重试。';
export default function App() {
  const [papers, setPapers] = useState<Paper[]>([]); const papersRef = useRef<Paper[]>([]);
  const [loading, setLoading] = useState(true); const [bootError, setBootError] = useState('');
  const [view, setViewState] = useState<View>(new URLSearchParams(location.search).get('view') === 'reader' ? 'reader' : 'library');
  const [activeId, setActiveId] = useState(''); const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState(''); const [category, setCategory] = useState('全部文献'); const [sort, setSort] = useState('recent');
  const [settingsOpen, setSettingsOpen] = useState(false); const [settingsTab, setSettingsTab] = useState('model'); const [aboutOpen, setAboutOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false); const [textTitle, setTextTitle] = useState(''); const [textInput, setTextInput] = useState(''); const [dragging, setDragging] = useState(false);
  const [terms, setTerms] = useState<Term[]>([]); const termsRef = useRef<Term[]>([]); const termBusyRef = useRef(false); const [termSource, setTermSource] = useState(''); const [termTarget, setTermTarget] = useState('');
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES); const preferencesRef = useRef<Preferences>(DEFAULT_PREFERENCES);
  const [removeTarget, setRemoveTarget] = useState<Paper | null>(null); const [editTarget, setEditTarget] = useState<Paper | null>(null);
  const [job, setJob] = useState<Job | null>(null); const busyRef = useRef(false); const abortRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<ModelProgress>({ phase: 'idle', message: '首次使用时准备模型' });
  const [consent, setConsent] = useState(false); const [pendingTranslation, setPendingTranslation] = useState<TextBlock[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({}); const [dataBusy, setDataBusy] = useState(false); const dataBusyRef = useRef(false); const loadRef = useRef(false);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [exportSnapshot, setExportSnapshot] = useState<ExportSnapshot | null>(null);
  const fileRef = useRef<HTMLInputElement>(null); const backupRef = useRef<HTMLInputElement>(null); const searchRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const operation = queueRef.current.then(work);
    // 调用方仍收到失败，但失败不能阻断后续写入或备份。
    queueRef.current = operation.then(() => {}, () => {});
    return operation;
  }, []);
  const beginData = () => { if (dataBusyRef.current || busyRef.current || loadRef.current) return false; dataBusyRef.current = true; setDataBusy(true); return true; };
  const endData = () => { dataBusyRef.current = false; setDataBusy(false); };
  const active = papers.find(p => p.id === activeId) || papers[0];
  const nav = useCallback((next: View) => { setViewState(next); const url = new URL(location.href); if (next === 'reader') url.searchParams.set('view', 'reader'); else url.searchParams.delete('view'); history.pushState({}, '', url); }, []);
  // 仅在队列内调用；恢复直接刷新，不再入队或补种示例。
  const readLibrary = useCallback(async (initialize = false) => {
    let list = await getPapers();
    if (initialize) {
      const initialized = await getSetting('initialized', false);
      if (!initialized && !list.length) { list = makeSamples(); for (const paper of list) await savePaper(paper); }
      await setSetting('initialized', true);
    }
    const [savedTerms, savedPreferences, last] = await Promise.all([getSetting<Term[]>('terms', []), getSetting<Preferences>('preferences', DEFAULT_PREFERENCES), getSetting('lastPaper', '')]);
    papersRef.current = list; termsRef.current = savedTerms; preferencesRef.current = { ...DEFAULT_PREFERENCES, ...savedPreferences };
    setPapers(list); setTerms(savedTerms); setPreferences(preferencesRef.current); setActiveId(list.find(p => p.id === last)?.id || list[0]?.id || ''); setBootError('');
  }, []);
  const load = useCallback(async () => {
    if (loadRef.current || dataBusyRef.current || busyRef.current) return;
    loadRef.current = true; setLoading(true); setBootError('');
    try { await enqueue(() => readLibrary(true)); }
    catch (error) { setBootError(`无法打开本地文献库：${humanError(error)}。请检查浏览器是否允许本站存储；不会把未保存内容伪装成成功。`); }
    finally { loadRef.current = false; setLoading(false); }
  }, [enqueue, readLibrary]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const handler = () => setViewState(new URLSearchParams(location.search).get('view') === 'reader' ? 'reader' : 'library'); addEventListener('popstate', handler); return () => removeEventListener('popstate', handler); }, []);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === 'k') { event.preventDefault(); if (view === 'reader') nav('library'); requestAnimationFrame(() => searchRef.current?.focus()); } }; addEventListener('keydown', handler); return () => removeEventListener('keydown', handler); }, [view, nav]);
  useEffect(() => { document.documentElement.dataset.reducedMotion = String(preferences.reduceMotion); document.documentElement.style.setProperty('--reading-size', `${preferences.fontSize}px`); }, [preferences]);
  useEffect(() => () => { abortRef.current?.abort(); cancelEngine(); }, []);
  const updatePaper = useCallback((id: string, transform: (paper: Paper) => Paper): Promise<void> => enqueue(async () => {
    const old = papersRef.current.find(p => p.id === id); if (!old) throw new Error('文献已经移除');
    const changed = transform(old); if (changed === old) return;
    const updated = { ...changed, updatedAt: Date.now() }; await savePaper(updated);
    const list = papersRef.current.map(p => p.id === id ? updated : p); papersRef.current = list; setPapers(list);
  }), [enqueue]);
  const openPaper = (paper: Paper, block?: string) => { setActiveId(paper.id); setSelectedId(block || paper.blocks.find(b => b.page === paper.currentPage)?.id || ''); setDrafts({}); nav('reader'); void enqueue(() => setSetting('lastPaper', paper.id)).catch(() => toast.error('阅读位置未保存')); };
  const addPaper = async (paper: Paper, file?: Blob) => {
    const added = await enqueue(async () => {
      const existing = papersRef.current.find(p => p.id === paper.id); if (existing) return existing;
      await savePaper(paper, file); const list = [paper, ...papersRef.current]; papersRef.current = list; setPapers(list); return paper;
    });
    setImportOpen(false); openPaper(added);
  };
  const cancel = () => { abortRef.current?.abort(); cancelEngine(); };
  const importFile = async (file?: File) => {
    if (!file || busyRef.current || dataBusyRef.current || loadRef.current) return;
    if (!/\.pdf$/i.test(file.name)) { toast.error('请选择 PDF 文件；纯文本请使用“粘贴文字”。'); return; }
    busyRef.current = true; const controller = new AbortController(); abortRef.current = controller; setJob({ label: '正在整理文献', done: 0, total: 1 }); setProgress({ phase: 'running', message: '文件仅在此设备解析，不会上传' });
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('首版支持不超过30 MiB的PDF，请先拆分较大文档。');
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer()); const id = `pdf-${Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')}`;
      const existing = papersRef.current.find(p => p.id === id); if (existing) { openPaper(existing); setImportOpen(false); toast.info('这篇文献已经在书房，已为你打开。'); return; }
      const { importPdf } = await import('./pdf'); const paper = await importPdf(file, controller.signal, (page, total) => { setJob({ label: '正在整理文献', done: page, total }); setProgress({ phase: 'running', message: `正在读取第 ${page} / ${total} 页` }); });
      if (controller.signal.aborted) return; await addPaper({ ...paper, id }, file); toast.success('文献已放入书房。');
    } catch (error) { if (!controller.signal.aborted) toast.error(humanError(error), { duration: 10000 }); }
    finally { busyRef.current = false; setJob(null); abortRef.current = null; setProgress({ phase: 'idle', message: '首次使用时准备模型' }); if (fileRef.current) fileRef.current.value = ''; }
  };
  const translate = async (blocks: TextBlock[], confirmed = false) => {
    if (!active || busyRef.current || dataBusyRef.current || loadRef.current) return;
    if (preferences.engine === 'local' && !consent && !confirmed) { setPendingTranslation(blocks); return; }
    const targets = blocks.filter(b => canTranslateBlock(b) && active.translations[b.id]?.engine !== '人工校订');
    if (!targets.length) { toast.info('没有待处理的英文段落；已完成或人工校订的译文会被保留。'); return; }
    const paperId = active.id; busyRef.current = true; const controller = new AbortController(); abortRef.current = controller;
    setJob({ paperId, label: targets.length > 1 ? '正在逐段翻译' : '正在翻译选中段落', done: 0, total: targets.length });
    let done = 0, processed = 0;
    try {
      for (const block of targets) {
        if (controller.signal.aborted) break;
        const result = await translateText(block.text, preferences.engine, setProgress, controller.signal);
        if (controller.signal.aborted) break;
        let saved = false;
        await updatePaper(paperId, p => {
          if (controller.signal.aborted || p.translations[block.id]?.engine === '人工校订') return p;
          saved = true;
          return { ...p, translations: { ...p.translations, [block.id]: { ...result, createdAt: Date.now(), issues: translationIssues(block.text, result.text, termsRef.current) } } };
        });
        if (saved) done++; setJob({ paperId, label: '正在逐段翻译', done: ++processed, total: targets.length });
      }
      if (!controller.signal.aborted) { setProgress({ phase: 'ready', message: '本地翻译已就绪' }); toast.success(`已保存 ${done} 段译文${done < blocks.length ? '，非英文或人工校订段落已跳过' : ''}。`); }
    } catch (error) { if (!controller.signal.aborted) { setProgress({ phase: 'error', message: humanError(error) }); toast.error(humanError(error), { duration: 12000 }); } }
    finally { if (controller.signal.aborted) { toast.info(`任务已取消，已保存的 ${done} 段译文仍在。`); setProgress({ phase: 'idle', message: '任务已取消，可重新准备模型' }); } busyRef.current = false; setJob(null); abortRef.current = null; }
  };
  const prepare = async () => {
    if (busyRef.current || dataBusyRef.current || loadRef.current) return; setConsent(true); busyRef.current = true; const controller = new AbortController(); abortRef.current = controller; setJob({ label: '准备本地翻译模型', done: 0, total: 1 });
    try { await prepareEngine(preferences.engine, value => { if (!controller.signal.aborted) setProgress(value); }, controller.signal); if (!controller.signal.aborted) toast.success('翻译模型已就绪，可以开始阅读了。'); } catch (error) { if (!controller.signal.aborted) { setProgress({ phase: 'error', message: humanError(error) }); toast.error(humanError(error), { duration: 12000 }); } } finally { if (controller.signal.aborted) setProgress({ phase: 'idle', message: '任务已取消，可重新准备模型' }); busyRef.current = false; setJob(null); abortRef.current = null; }
  };
  const generate = async (blocks: TextBlock[]) => {
    if (!active || busyRef.current || dataBusyRef.current || loadRef.current) return; const paperId = active.id; const controller = new AbortController(); abortRef.current = controller; busyRef.current = true; setJob({ paperId, label: '整理本地摘要草稿', done: 0, total: blocks.length });
    try { for (let i = 0; i < blocks.length; i++) { setProgress({ phase: 'running', message: `正在整理第 ${i + 1} 条证据` }); const draft = await summarizeEvidence(blocks[i].text, controller.signal); if (controller.signal.aborted) break; setDrafts(old => ({ ...old, [blocks[i].id]: draft })); setJob({ paperId, label: '整理本地摘要草稿', done: i + 1, total: blocks.length }); } } catch (error) { if (!controller.signal.aborted) toast.error(humanError(error)); } finally { busyRef.current = false; setJob(null); abortRef.current = null; }
  };
  const changePreferences = async (patch: Partial<Preferences>) => {
    try { await enqueue(async () => { const next = { ...preferencesRef.current, ...patch }; await setSetting('preferences', next); preferencesRef.current = next; setPreferences(next); }); }
    catch { toast.error('设置未保存'); }
  };
  const addTerm = async () => {
    const source = termSource.trim(), target = termTarget.trim(); if (!source || !target || termBusyRef.current) return;
    termBusyRef.current = true;
    try {
      await enqueue(async () => {
        const next = [...termsRef.current.filter(t => t.source.toLowerCase() !== source.toLowerCase()), { id: uid(), source, target }];
        if (next.length > 300) throw new Error('术语库最多保存300条');
        await setSetting('terms', next); termsRef.current = next; setTerms(next);
      });
      setTermSource(current => current === termSource ? '' : current); setTermTarget(current => current === termTarget ? '' : current); toast.success('术语已收录，将用于后续译文校验。');
    } catch (error) { toast.error(`术语未保存：${humanError(error)}`); } finally { termBusyRef.current = false; }
  };
  const removeTerm = async (id: string) => {
    try { await enqueue(async () => { const next = termsRef.current.filter(t => t.id !== id); await setSetting('terms', next); termsRef.current = next; setTerms(next); }); }
    catch { toast.error('术语未删除'); }
  };
  const openExport = async () => {
    if (!active || !beginData()) { toast.info('请等当前操作完成后再导出。'); return; }
    const id = active.id;
    try {
      const snapshot = await enqueue(async () => {
        const current = papersRef.current.find(p => p.id === id);
        if (!current) throw new Error('文献已经移除，无法导出。');
        const paper = structuredClone(current);
        const file = paper.kind === 'pdf' ? await getFile(id) : undefined;
        return { paper, file };
      });
      setExportSnapshot(snapshot);
    } catch (error) { toast.error(humanError(error)); }
    finally { endData(); }
  };
  const backup = async () => {
    if (!beginData()) return;
    try { const blob = await enqueue(() => exportBackup()); downloadBlob(blob, `栖页完整备份-${new Date().toISOString().slice(0, 10)}.json`); toast.success('完整备份已导出，请妥善保存。'); }
    catch (error) { toast.error(humanError(error)); } finally { endData(); }
  };
  const restore = async (file?: File) => {
    if (!file || !beginData()) return;
    try {
      if (!window.confirm('恢复将覆盖相同文献 ID 的正文、译文、笔记和原 PDF，并合并备份中的设置；原有其他文献将保留。备份未附 PDF 时会删除同 ID 的旧 PDF。确定继续？')) return;
      const count = await enqueue(async () => {
        const restored = await restoreBackup(file); await readLibrary();
        setLibraryRevision(value => value + 1); setSelectedId(''); setDrafts({}); setEditTarget(null); setRemoveTarget(null);
        return restored;
      });
      toast.success(`已恢复 ${count} 篇文献，不相干的文献已保留。`);
    } catch (error) { toast.error(humanError(error), { duration: 10000 }); } finally { endData(); if (backupRef.current) backupRef.current.value = ''; }
  };
  const visible = useMemo(() => papers.filter(p => (view !== 'starred' || p.starred) && (category === '全部文献' || p.category === category) && (!search.trim() || `${p.title} ${p.authors} ${p.category} ${p.blocks.map(b => b.text).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()))).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'added' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt), [papers, view, category, search, sort]);
  const categories = [...new Set(papers.map(p => p.category))]; const allNotes = papers.flatMap(p => p.notes.map(note => ({ paper: p, note }))).filter(({ note, paper }) => `${note.text} ${paper.title}`.toLowerCase().includes(search.toLowerCase()));
  const models = () => { setSettingsTab('model'); setSettingsOpen(true); };
  return <div className="app-shell">
    <Toaster position="bottom-center" richColors closeButton/>
    <input ref={fileRef} type="file" accept=".pdf,application/pdf" aria-label="选择本地PDF" className="file-input-sr" onChange={event => void importFile(event.target.files?.[0])}/>
    <input ref={backupRef} type="file" accept=".json,application/json" aria-label="选择完整备份" className="file-input-sr" onChange={event => void restore(event.target.files?.[0])}/>
    <aside className="sidebar">
      <button className="brand" onClick={() => nav('library')} aria-label="栖页首页"><span className="brand-symbol"><BookMark/></span><span><strong>栖页</strong><small>QIYE · A QUIET LIBRARY</small></span></button>
      <button className="button primary import-button" disabled={Boolean(job) || dataBusy || Boolean(bootError)} onClick={() => setImportOpen(true)}><Plus size={18}/>放入一篇文献</button>
      <div className="nav-caption">我的空间</div>
      <nav className="main-nav" aria-label="主要导航">
        <button className={view === 'library' || view === 'reader' ? 'active' : ''} onClick={() => { nav('library'); setCategory('全部文献'); }}><Library size={18}/><span>文献书房</span><small>{papers.length}</small></button>
        <button className={view === 'starred' ? 'active' : ''} onClick={() => { nav('starred'); setCategory('全部文献'); }}><Star size={18}/><span>珍藏的篇章</span><small>{papers.filter(p => p.starred).length}</small></button>
        <button className={view === 'notes' ? 'active' : ''} onClick={() => nav('notes')}><BookMarked size={18}/><span>灵感手记</span><small>{papers.reduce((n, p) => n + p.notes.length, 0)}</small></button>
      </nav>
      <div className="nav-caption collection-heading">阅读主题 <span>{categories.length}</span></div>
      <nav className="collections" aria-label="按主题筛选">{categories.map((item, i) => <button key={item} className={category === item && view !== 'reader' ? 'active' : ''} onClick={() => { setCategory(item); nav('library'); }}><span className={`collection-dot tone-${i % 4}`}/>{item}<small>{papers.filter(p => p.category === item).length}</small></button>)}</nav>
      <div className="sidebar-bottom"><div className="quiet-note"><Leaf size={21}/><p>读一点，也很好。</p><span>让理解按自己的节奏发生。</span></div><button className="model-status" onClick={models}><span className={`status-dot ${progress.phase === 'ready' ? '' : 'unready'}`}/><span>本地翻译模型</span><small>{job ? '处理中' : progress.phase === 'ready' ? '已就绪' : '未就绪'}</small></button><button className="settings-link" onClick={() => { setSettingsTab('data'); setSettingsOpen(true); }}><Settings2 size={17}/>设置与数据<ChevronDown size={14}/></button></div>
    </aside>
    <main className="main-surface">
      {view === 'reader' && active ? <Reader key={`${active.id}:${libraryRevision}`} paper={active} selectedId={selectedId} onSelect={setSelectedId} onBack={() => nav('library')} onUpdate={updatePaper} onTranslate={blocks => void translate(blocks)} onCancel={cancel} onExport={() => void openExport()} exportDisabled={dataBusy} onGenerate={blocks => void generate(blocks)} drafts={drafts} job={job} progress={progress} onModels={models}/> : <>
        <header className="topbar"><div className="breadcrumb"><span>我的空间</span><i>/</i><strong>{view === 'notes' ? '灵感手记' : view === 'starred' ? '珍藏的篇章' : '文献书房'}</strong></div><div className="topbar-right"><div className="privacy-pill"><ShieldCheck size={14}/><span>文献留在你的设备</span></div><button className="icon-button" onClick={() => setAboutOpen(true)} aria-label="关于栖页与使用帮助"><CircleHelp size={18}/></button><span className="avatar" aria-label="本地个人空间">栖</span></div></header>
        <div className="library-scroll">
          <section className="welcome-section"><div><span className="eyebrow">A SMALL SPACE FOR BIG IDEAS</span><h1>{view === 'notes' ? <>每个想法，<em>都值得被留下。</em></> : <>给好奇心，<em>留一处安静。</em></>}</h1><p>{view === 'notes' ? '把散落在阅读里的灵光，慢慢连成自己的理解。' : '翻开一篇文献。让复杂的知识，慢慢变得清晰。'}</p><div className="welcome-meta"><span><CloudOff size={14}/>本地处理</span><i/><span><BookOpen size={14}/>原文可追溯</span><i/><span>按自己的节奏阅读</span></div></div><div className="welcome-still-life" aria-hidden="true"><div className="still-orbit"/><div className="still-book back"/><div className="still-book front"><span>one page<br/>at a time.</span><Leaf size={34}/></div><span className="still-caption">TAKE YOUR TIME.</span></div></section>
          <section className="library-section">
            <div className="library-heading"><div><h2>{view === 'notes' ? '灵感手记' : category !== '全部文献' ? category : view === 'starred' ? '珍藏的篇章' : '我的文献'}<span>{view === 'notes' ? allNotes.length : visible.length}</span></h2><p>{view === 'notes' ? '有出处的思考，会在下一次阅读里继续生长。' : '从这里开始一段专注的阅读。'}</p></div><div className="library-tools"><div className="search-field"><Search size={16}/><input ref={searchRef} value={search} onChange={event => setSearch(event.target.value)} placeholder={view === 'notes' ? '搜索笔记…' : '搜索标题、作者或正文…'} aria-label="搜索文献或笔记"/>{search ? <button className="icon-button" onClick={() => setSearch('')} aria-label="清空搜索"><X size={14}/></button> : <kbd>⌘ K</kbd>}</div>{view !== 'notes' && <label className="sort-control"><SlidersHorizontal size={16}/><select value={sort} onChange={e => setSort(e.target.value)} aria-label="文献排序"><option value="recent">最近更新</option><option value="added">最近加入</option><option value="title">标题排序</option></select></label>}</div></div>
            {job && <div className="library-task" role="status"><Loader2 className="spin" size={17}/><div><strong>{job.label}</strong><span>{progress.message}</span></div><button className="button secondary compact" onClick={cancel}>取消</button></div>}
            {loading ? <div className="empty-state"><Loader2 className="spin" size={28}/><p>正在打开你的书房…</p></div> : bootError ? <div className="empty-state"><ShieldCheck size={30}/><h3>暂时无法打开本地存储</h3><p>{bootError}</p><button className="button primary" onClick={() => void load()}>重新尝试</button></div> : view === 'notes' ? <div className="all-notes-grid">{allNotes.map(({ note, paper }) => <article className="all-note" key={note.id}><QuoteMark/><p>{note.text}</p><button onClick={() => openPaper(paper, note.blockId)}><FileText size={14}/>{paper.title}<ArrowRight size={14}/></button></article>)}{!allNotes.length && <div className="empty-state"><BookMarked size={32}/><h3>留一个位置，给下一次灵感。</h3><p>打开文献，在“笔记”里写下你的想法。</p><button className="button secondary" onClick={() => nav('library')}>回到文献书房</button></div>}</div> : <div className="paper-grid">
              {visible.map((paper, index) => <article className="paper-card" key={paper.id} style={{ animationDelay: `${Math.min(index, 5) * 55}ms` }}><button className="paper-open" onClick={() => openPaper(paper)} aria-label={`阅读 ${paper.title}`}><Cover paper={paper} index={index}/><div className="paper-card-body"><div className="paper-category"><span>{paper.category}</span><span>{paper.year}</span></div><h3>{paper.title}</h3><p>{paper.authors}</p></div></button><div className="paper-card-footer"><span><FileText size={13}/>{paper.pageCount} 页<small>·</small>{Object.keys(paper.translations).length > 0 ? `${Object.keys(paper.translations).length} 段已译` : '等待翻开'}</span><div><button className={`icon-button ${paper.starred ? 'starred' : ''}`} aria-label={paper.starred ? `取消收藏 ${paper.title}` : `收藏 ${paper.title}`} onClick={() => void updatePaper(paper.id, p => ({ ...p, starred: !p.starred })).catch(() => toast.error('收藏未保存'))}><Star size={16} fill={paper.starred ? 'currentColor' : 'none'}/></button><button className="icon-button" onClick={() => setEditTarget({ ...paper })} aria-label={`管理 ${paper.title}`}><MoreHorizontal size={18}/></button></div></div></article>)}
              {!search && view !== 'starred' && category === '全部文献' && <button className="new-paper-card" onClick={() => setImportOpen(true)} disabled={Boolean(job) || dataBusy}><span className="new-paper-icon"><Plus size={26}/></span><strong>下一篇，留给你的好奇心。</strong><span>导入 PDF 或粘贴文字</span><small>仅保存在你的浏览器</small></button>}
              {!visible.length && (search || view === 'starred' || category !== '全部文献') && <div className="empty-state"><Search size={29}/><h3>{search ? '没有找到这段线索' : '这里还很安静'}</h3><p>{search ? '换个关键词试试，也可以直接搜索英文正文。' : '收藏一篇文献，让它在这里等你。'}</p></div>}
            </div>}
          </section>
          <footer className="library-footer"><span><Leaf size={14}/>不着急，理解需要一点时间。</span><button onClick={() => { setSettingsTab('data'); setSettingsOpen(true); }}><ArrowDownToLine size={14}/>备份你的书房</button></footer>
        </div>
      </>}
    </main>
    {exportSnapshot && <ExportDialog key={exportSnapshot.paper.id} snapshot={exportSnapshot} onClose={() => setExportSnapshot(null)}/>}
    <Dialog open={importOpen} onOpenChange={setImportOpen}><DialogContent className="qiye-dialog"><DialogHeader><div className="dialog-symbol"><FolderOpen size={24}/></div><DialogTitle>为好奇心，翻开新的一页。</DialogTitle><DialogDescription>文献在你的设备上解析，不上传到云端模型。</DialogDescription></DialogHeader><Tabs defaultValue="pdf"><TabsList className="dialog-tabs"><TabsTrigger value="pdf">导入 PDF</TabsTrigger><TabsTrigger value="text">粘贴文字</TabsTrigger></TabsList><TabsContent value="pdf"><button className={`drop-zone ${dragging ? 'dragging' : ''}`} disabled={Boolean(job)} onClick={() => fileRef.current?.click()} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void importFile(e.dataTransfer.files[0]); }}><Upload size={30}/><strong>把文献轻轻放在这里</strong><span>拖入文件，或点击选择 PDF</span><small>首版支持 30 MiB / 100 页以内 · 原生文字 PDF 优先</small></button><p className="fine-print">扫描件可以查看原页，但本版不做 OCR；复杂版式可能需要校对。请只导入你有权使用的文献。</p></TabsContent><TabsContent value="text"><label className="input-label">文稿标题<input className="field" value={textTitle} onChange={e => setTextTitle(e.target.value)} maxLength={240} placeholder="给这篇文稿一个名字"/></label><label className="input-label">英文正文<textarea className="field paste-text" value={textInput} onChange={e => setTextInput(e.target.value)} maxLength={100000} placeholder="段落之间空一行；章节标题可以使用 # Introduction"/></label><button className="button primary full-width" disabled={!textInput.trim() || dataBusy || Boolean(job)} onClick={async () => { if (!textInput.trim() || !beginData()) return; try { await addPaper(fromText(textTitle, textInput)); setTextInput(current => current === textInput ? '' : current); setTextTitle(current => current === textTitle ? '' : current); } catch (error) { toast.error(humanError(error)); } finally { endData(); } }}>放入书房<ArrowRight size={16}/></button></TabsContent></Tabs></DialogContent></Dialog>
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent className="qiye-dialog settings-dialog"><DialogHeader><DialogTitle>让书房，更适合你。</DialogTitle><DialogDescription>模型、阅读偏好与数据，都由你决定。</DialogDescription></DialogHeader><Tabs value={settingsTab} onValueChange={setSettingsTab}><TabsList className="dialog-tabs"><TabsTrigger value="model">本地模型</TabsTrigger><TabsTrigger value="terms">术语库</TabsTrigger><TabsTrigger value="data">外观与数据</TabsTrigger></TabsList><TabsContent value="model"><div className="model-info"><ShieldCheck size={25}/><div><h3>计算发生在这里，文献也留在这里。</h3><p>英中 OPUS-MT 权重从 hf-mirror.com 下载，失败时尝试 Hugging Face；两者都是公开模型资源源，不接收文献。首次约 290 MB 模型与运行资源，内存需求更高；推荐桌面浏览器。只有主动准备或翻译时才下载。</p></div></div><label className="input-label">翻译引擎<select className="field" value={preferences.engine} disabled={Boolean(job)} onChange={e => { setProgress({ phase: 'idle', message: '引擎已切换，等待准备' }); void changePreferences({ engine: e.target.value as Preferences['engine'] }); }}><option value="local">本站本地模型 · OPUS-MT / WASM</option><option value="browser" disabled={!hasBrowserTranslator()}>浏览器内置翻译{!hasBrowserTranslator() ? '（当前浏览器未开放）' : ''}</option></select></label><div className="model-progress" role="status"><strong>{progress.phase === 'ready' ? '模型已就绪' : job ? '正在处理' : '按需准备，不偷偷下载'}</strong><p>{progress.message}</p>{job && (progress.total && progress.loaded !== undefined ? <progress value={progress.loaded} max={progress.total}/> : <div className="indeterminate"/>)}</div><div className="action-row"><button className="button primary" disabled={Boolean(job)} onClick={() => void prepare()}>{job ? <Loader2 size={16} className="spin"/> : <Download size={16}/>}准备本地翻译</button>{job && <button className="button secondary" onClick={cancel}>取消当前任务</button>}</div><p className="fine-print">缓存可减少重复下载，但不承诺所有设备都能运行或永久离线可用。不会自动切换到收费云端服务。译文供阅读辅助，重要结论请核对。</p><a className="text-button" href="/licenses.txt" target="_blank" rel="noreferrer">查看模型与开源许可<ArrowRight size={13}/></a></TabsContent><TabsContent value="terms"><p className="settings-intro">为你的学科，保留合适的译法。术语会用于翻译后的核对提示，不会机械替换原文，也不保证模型必然采用。</p><div className="term-form"><input className="field" value={termSource} maxLength={80} onChange={e => setTermSource(e.target.value)} placeholder="原词，例如 attention" aria-label="术语原词"/><ArrowRight size={15}/><input className="field" value={termTarget} maxLength={120} onChange={e => setTermTarget(e.target.value)} placeholder="推荐译法，例如 注意力" aria-label="术语译法"/><button className="icon-button" disabled={!termSource.trim() || !termTarget.trim()} onClick={() => void addTerm()} aria-label="添加术语"><Plus size={20}/></button></div><div className="term-list">{terms.map(term => <div key={term.id}><strong>{term.source}</strong><span>{term.target}</span><button className="icon-button" aria-label={`删除术语 ${term.source}`} onClick={() => void removeTerm(term.id)}><X size={14}/></button></div>)}{!terms.length && <div className="empty-inline"><BookMarked size={25}/><p>从一个熟悉的术语开始。</p></div>}</div></TabsContent><TabsContent value="data"><div className="setting-row"><div><strong>阅读文字大小</strong><p>只影响阅读正文，不改变原 PDF。</p></div><select aria-label="阅读文字大小" className="field small-select" value={preferences.fontSize} onChange={e => void changePreferences({ fontSize: Number(e.target.value) })}><option value={16}>舒适 · 16</option><option value={17}>默认 · 17</option><option value={19}>大字 · 19</option><option value={21}>更大 · 21</option></select></div><label className="setting-row"><div><strong>减少动态效果</strong><p>关闭装饰动画；同时尊重系统的减少动态设置。</p></div><input type="checkbox" checked={preferences.reduceMotion} onChange={e => void changePreferences({ reduceMotion: e.target.checked })}/></label><div className="data-backup"><Download size={22}/><h3>给认真留下的东西，多一份安心。</h3><p>完整备份包含原 PDF、正文、译文、笔记与设置。浏览器清理或存储回收可能移除本地内容，备份请保存到独立位置。</p><div className="action-row"><button className="button primary" disabled={dataBusy || Boolean(job)} onClick={() => void backup()}><Download size={16}/>{dataBusy ? '正在处理…' : '导出完整备份'}</button><button className="button secondary" disabled={dataBusy || Boolean(job)} onClick={() => backupRef.current?.click()}><Upload size={16}/>恢复备份</button></div><small>恢复会覆盖同 ID 文献，保留原有其他文献；未附 PDF 时会清除同 ID 的旧文件。</small></div><button className="text-button" onClick={async () => { try { const value = await navigator.storage?.persist?.(); toast.info(value ? '浏览器已允许持久化存储，仍建议定期备份。' : '浏览器暂未授予持久化存储，请使用完整备份。'); } catch { toast.error('无法申请持久化存储'); } }}>请求浏览器保留本站数据<ArrowRight size={14}/></button></TabsContent></Tabs></DialogContent></Dialog>
    <Dialog open={pendingTranslation !== null} onOpenChange={open => { if (!open) setPendingTranslation(null); }}><DialogContent className="qiye-dialog"><DialogHeader><DialogTitle>先为本地翻译，准备一点空间。</DialogTitle><DialogDescription>首次从公开模型源下载约290 MB模型与运行资源，之后尽量复用缓存。镜像不可达时尝试Hugging Face。计算在此设备进行，文献不会上传。</DialogDescription></DialogHeader><p className="settings-intro">推荐桌面浏览器、稳定网络与足够内存。若设备不支持，你仍可阅读、做笔记和查看原文证据。可以随时取消下载或翻译。</p><div className="action-row"><button className="button primary" onClick={() => { const blocks = pendingTranslation || []; setConsent(true); setPendingTranslation(null); void translate(blocks, true); }}><Download size={16}/>准备并开始翻译</button><button className="button secondary" onClick={() => setPendingTranslation(null)}>暂时只阅读</button></div></DialogContent></Dialog>
    <Dialog open={editTarget !== null} onOpenChange={open => { if (!open) setEditTarget(null); }}><DialogContent className="qiye-dialog"><DialogHeader><DialogTitle>整理这篇文献</DialogTitle><DialogDescription>修改阅读元数据，不改动原文件。</DialogDescription></DialogHeader>{editTarget && <><label className="input-label">标题<input className="field" value={editTarget.title} maxLength={240} onChange={e => setEditTarget({ ...editTarget, title: e.target.value })}/></label><label className="input-label">作者 / 来源<input className="field" value={editTarget.authors} maxLength={240} onChange={e => setEditTarget({ ...editTarget, authors: e.target.value })}/></label><div className="form-grid"><label className="input-label">主题<input className="field" value={editTarget.category} maxLength={40} onChange={e => setEditTarget({ ...editTarget, category: e.target.value })}/></label><label className="input-label">年份<input className="field" value={editTarget.year} maxLength={20} onChange={e => setEditTarget({ ...editTarget, year: e.target.value })}/></label></div><div className="action-row spread"><button className="text-button danger" disabled={Boolean(job)} onClick={() => { setRemoveTarget(editTarget); setEditTarget(null); }}><Trash2 size={15}/>移出书房</button><button className="button primary" disabled={!editTarget.title.trim() || dataBusy || Boolean(job)} onClick={async () => { if (!editTarget.title.trim() || !beginData()) return; try { await updatePaper(editTarget.id, p => ({ ...p, title: editTarget.title.trim(), authors: editTarget.authors.trim(), category: editTarget.category.trim() || '未分类', year: editTarget.year.trim() })); setEditTarget(null); toast.success('文献信息已整理好。'); } catch (error) { toast.error(humanError(error)); } finally { endData(); } }}>保存修改</button></div></>}</DialogContent></Dialog>
    <Dialog open={removeTarget !== null} onOpenChange={open => { if (!open) setRemoveTarget(null); }}><DialogContent className="qiye-dialog"><DialogHeader><DialogTitle>将这篇文献移出书房？</DialogTitle><DialogDescription>这会删除本站保存的原文件副本、译文与笔记，不影响你电脑上的原始文件。建议先导出备份。</DialogDescription></DialogHeader><p>{removeTarget?.title}</p><div className="action-row"><button className="button secondary" onClick={() => setRemoveTarget(null)}>保留</button><button className="button danger-button" disabled={dataBusy || Boolean(job)} onClick={async () => { if (!removeTarget || !beginData()) return; try { await enqueue(async () => { await deletePaper(removeTarget.id); const next = papersRef.current.filter(p => p.id !== removeTarget.id); papersRef.current = next; setPapers(next); }); setRemoveTarget(null); toast.success('已移出书房'); } catch (error) { toast.error(humanError(error)); } finally { endData(); } }}>确认移出</button></div></DialogContent></Dialog>
    <Dialog open={aboutOpen} onOpenChange={setAboutOpen}><DialogContent className="qiye-dialog"><DialogHeader><span className="brand-symbol"><BookMark/></span><DialogTitle>栖页 · 为认真阅读，留一处安静。</DialogTitle><DialogDescription>本地优先的文献阅读工作台。</DialogDescription></DialogHeader><ol className="help-steps"><li>导入你的 PDF，或打开标记为教学示例的文稿。</li><li>选中英文段落，主动准备模型后开始翻译。</li><li>在提要中回查原文，在笔记里记录理解。</li><li>导出阅读笔记或完整备份。</li></ol><div className="about-boundary"><strong>让边界也清清楚楚。</strong><p>首版以英文原生文字 PDF 为主；扫描 OCR、图表理解、云同步与任意设备上的生成摘要不在保证范围。证据提要是原文抽取，可能遗漏内容；机器译文需核对。网页可访问不代表浏览器一定能运行模型。</p><p>页面与模型下载需要网络，文献解析和翻译不调用云模型。Qoder Sites 的托管免费期与额度以平台规则为准。</p></div><a href="/licenses.txt" className="text-button" target="_blank" rel="noreferrer">模型、运行库及示例来源<ArrowRight size={14}/></a></DialogContent></Dialog>
  </div>;
}
function QuoteMark() { return <span className="large-quote" aria-hidden="true">“</span>; }
