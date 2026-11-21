export type PaperColor = 'sage' | 'clay' | 'lavender' | 'sand';
export interface TextBlock { id: string; page: number; text: string; section: string; }
export interface Translation { text: string; engine: string; createdAt: number; issues: string[]; }
export interface Note { id: string; blockId?: string; text: string; quote?: string; createdAt: number; }
export interface Paper {
  id: string; title: string; authors: string; year: string; category: string;
  color: PaperColor; kind: 'pdf' | 'text'; pageCount: number;
  blocks: TextBlock[]; translations: Record<string, Translation>; notes: Note[];
  starred: boolean; currentPage: number; createdAt: number; updatedAt: number;
  warnings: string[]; sample?: boolean; sourceUrl?: string;
}
export interface Term { id: string; source: string; target: string; }
export interface Preferences { engine: 'local' | 'browser'; fontSize: number; reduceMotion: boolean; }
export interface Evidence { blockId: string; page: number; section: string; text: string; }
export interface ModelProgress { phase: 'idle' | 'loading' | 'ready' | 'running' | 'error'; message: string; loaded?: number; total?: number; }
export const DEFAULT_PREFERENCES: Preferences = { engine: 'local', fontSize: 17, reduceMotion: false };
export const MODEL_ID = 'onnx-community/opus-mt-en-zh';
export const uid = () => crypto.randomUUID();
