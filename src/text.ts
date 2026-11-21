import type { Paper, TextBlock, Evidence, Term } from './domain';
import { uid } from './domain';

export function fromText(title: string, text: string): Paper {
  const chunks = text.replace(/\r/g, '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  let section = '正文';
  const blocks: TextBlock[] = [];
  for (const chunk of chunks) {
    if (/^(?:#{1,3}\s|abstract$|introduction$|methods?$|results?$|discussion$|conclusions?$|limitations?$)/i.test(chunk) && chunk.length < 90) { section = chunk.replace(/^#+\s*/, ''); continue; }
    let remaining = chunk;
    while (remaining.length) {
      let end = Math.min(4000, remaining.length);
      if (end < remaining.length) {
        const space = remaining.lastIndexOf(' ', end);
        if (space > end / 2) end = space;
        const code = remaining.charCodeAt(end - 1);
        if (code >= 0xD800 && code <= 0xDBFF) end--;
      }
      const piece = remaining.slice(0, end).trim();
      if (piece) blocks.push({ id: uid(), page: Math.floor(blocks.length / 5) + 1, text: piece, section });
      remaining = remaining.slice(end).trimStart();
    }
  }
  if (!blocks.length) throw new Error('没有找到正文。请粘贴至少一段可阅读的文字。');
  const now = Date.now();
  return { id: uid(), title: title.trim() || '未命名文稿', authors: '本地导入', year: String(new Date().getFullYear()), category: '未分类', color: 'sage', kind: 'text', pageCount: blocks.at(-1)!.page, blocks, translations: {}, notes: [], starred: false, currentPage: 1, createdAt: now, updatedAt: now, warnings: [] };
}

export function evidenceFor(paper: Paper, query = ''): Evidence[] {
  const words = query.toLowerCase().match(/[a-z]{2,}|[\u4e00-\u9fff]+/g) || [];
  const candidates = paper.blocks.filter(b => b.text.length >= 40 && !/references|bibliography|参考文献/i.test(b.section));
  const freq = new Map<string, number>();
  for (const b of candidates) for (const w of new Set(b.text.toLowerCase().match(/[a-z]{5,}/g) || [])) freq.set(w, (freq.get(w) || 0) + 1);
  const ranked = candidates.map((block, index) => {
    const value = block.text.toLowerCase();
    const sectionWeight = /abstract|conclusion|result|limitation|摘要|结论|结果|局限/i.test(block.section) ? 8 : /method|方法/i.test(block.section) ? 4 : 1;
    const matches = words.reduce((sum, word) => sum + (value.includes(word) ? 8 : 0), 0);
    const centrality = [...new Set(value.match(/[a-z]{5,}/g) || [])].reduce((sum, word) => sum + Math.log(1 + (freq.get(word) || 0)), 0) / Math.max(8, Math.sqrt(value.length));
    return { block, index, score: words.length ? matches : sectionWeight + centrality };
  }).filter(item => !words.length || item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: typeof ranked = [];
  const sections = new Set<string>();
  if (!words.length) for (const item of ranked) { if (!sections.has(item.block.section)) { selected.push(item); sections.add(item.block.section); } if (selected.length >= 5) break; }
  for (const item of ranked) { if (selected.length >= 6) break; if (!selected.includes(item)) selected.push(item); }
  return selected.sort((a, b) => a.index - b.index).map(({ block }) => ({ blockId: block.id, page: block.page, section: block.section, text: block.text }));
}

export function translationIssues(source: string, target: string, terms: Term[]): string[] {
  const issues: string[] = [];
  const digits = [...new Set(source.match(/\d+(?:\.\d+)?/g) || [])];
  const missing = digits.filter(n => !target.includes(n));
  if (missing.length) issues.push(`请核对数值：${missing.slice(0, 6).join('、')} 未以原数字出现。`);
  if (/\b(not|no|never|without|unlikely)\b/i.test(source) && !/[不未无非否没]/.test(target)) issues.push('原文含否定表达，请确认译文没有改变方向。');
  if (/\b(may|might|suggest|potential|possibly)\b/i.test(source)) issues.push('原文包含不确定性措辞，请保留其适用条件与语气。');
  for (const term of terms) if (source.toLowerCase().includes(term.source.toLowerCase()) && !target.includes(term.target)) issues.push(`术语建议：${term.source} → ${term.target}。请结合上下文校对。`);
  if (target.trim().length < 3 || target.trim() === source.trim()) issues.push('译文可能未完整生成，请核对或重试。');
  return issues;
}

/** Keep UI progress and the engine's eligibility filter on the same rule. */
export function canTranslateBlock(block: { text: string }): boolean {
  return (block.text.match(/[A-Za-z]+/g)?.length || 0) >= 4;
}

export function translationState(paper: Paper) {
  const eligible = paper.blocks.filter(canTranslateBlock);
  const remaining = eligible.filter(block => !paper.translations[block.id]);
  return { eligible, remaining, completed: eligible.length - remaining.length, total: eligible.length, skipped: paper.blocks.length - eligible.length };
}

export function paperMarkdown(paper: Paper): string {
  const lines = [`# ${paper.title}`, '', `来源：${paper.authors} · ${paper.year}`, '', '> 本地阅读辅助。机器译文和证据摘录须对照原文核查；不代表对论文真实性的验证。', ''];
  for (const b of paper.blocks) { lines.push(`## ${b.section} · 第 ${b.page} 页`, '', b.text, ''); const t = paper.translations[b.id]; if (t) lines.push(`**译文（${t.engine}）**`, '', t.text, '', ...t.issues.map(i => `> 校对提示：${i}`), ''); }
  if (paper.notes.length) lines.push('## 我的笔记', '', ...paper.notes.flatMap(n => [n.quote ? `> ${n.quote}` : '', n.text, '']));
  return lines.join('\n');
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name.replace(/[<>:"/\\|?*]/g, '-'); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function makeSamples(): Paper[] {
  const contents = [
    { title: 'A gentler way to read', category: '阅读与专注', color: 'sage' as const, text: `# Introduction\n\nReading a research paper is not a race. A reader can begin with a question, examine the abstract, and decide which sections deserve closer attention. This teaching note describes a careful reading workflow; it does not report an experiment or establish a scientific effect.\n\n# Method\n\nKeep the original paragraph beside every translation. Mark unfamiliar terms and write down what they mean in this particular paper. A familiar word may have a different meaning in another discipline, so a glossary should remain open to revision.\n\nRead the methods before treating a result as a general conclusion. Record who or what was studied, how observations were collected, and which conditions limit the interpretation. These details may be more important than an attractive headline.\n\n# Key points\n\nA useful reading note separates what the authors report from what the reader infers. Copying an exact passage with its page number can make later checking easier, but a quotation alone does not establish that an interpretation is correct.\n\n# Limitations\n\nThis text is an original tutorial example, not a published research paper. Its purpose is to demonstrate paragraph translation, evidence links, and personal notes. No experimental data or measured improvements are claimed.` },
    { title: 'Evidence before confidence', category: '开放与可复核', color: 'clay' as const, text: `# Abstract\n\nA fluent summary can still omit an important qualification. This original tutorial explores how a reading tool can keep statements connected to their source passages. It offers a workflow for checking claims rather than a guarantee that any particular model is accurate.\n\n# Method\n\nFor each statement, record the source paragraph and its surrounding context. Distinguish direct observations, the authors' interpretation, and your own questions. If a passage does not support a statement, remove the statement or label the uncertainty instead of attaching an unrelated citation.\n\n# Discussion\n\nThe phrase "not statistically significant" does not mean that an effect has been proved absent. Similarly, an association does not by itself demonstrate causation. A translation should preserve these distinctions even when a shorter sentence would sound more natural.\n\n# Limitations\n\nAutomatic checks can flag missing numbers and inconsistent terminology, but they cannot establish the meaning of every sentence. Evidence selection can also omit relevant passages. Human review remains necessary for important scientific decisions.` },
    { title: 'Your library, your own space', category: '数字自主', color: 'lavender' as const, text: `# Introduction\n\nLocal processing allows a reading application to work with a document on the reader's own device. The document does not need to be sent to a cloud model. The initial download of an application or model, however, still requires a network connection.\n\n# Design\n\nA local library can store documents, notes, and translation results in browser storage. Exporting a backup provides a separate copy that the reader can move to another device. This is different from automatic cloud synchronization.\n\n# Limitations\n\nBrowser storage may be cleared by the user or affected by storage limits. A model that runs on one computer may not run well on another. A dependable interface should explain these limits, preserve completed work, and avoid hiding failures behind an endless loading animation.\n\n# Conclusion\n\nPrivacy and reliability are properties to verify, not slogans. A clear record of what was processed, what remains uncertain, and how to export the work can help people make informed choices about their reading tools.` }
  ];
  return contents.map((item, i) => ({ ...fromText(item.title, item.text), id: `qiye-sample-${i + 1}`, category: item.category, color: item.color, sample: true, authors: '栖页原创教学示例 · 非发表论文', year: '2026', createdAt: Date.now() - i * 86400000 }));
}
