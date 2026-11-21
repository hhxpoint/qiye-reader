interface ImageStore { has: (id: string) => boolean; get: (id: string) => unknown; }
interface ImagePage { objs: ImageStore; commonObjs: ImageStore; }
interface ImageOps {
  paintImageXObject: number; paintImageXObjectRepeat: number;
  paintImageMaskXObject: number; paintImageMaskXObjectRepeat: number;
  paintInlineImageXObject: number; paintInlineImageXObjectGroup: number;
  paintImageMaskXObjectGroup: number;
}

/** PDF.js can resolve an undecodable external image to null and still finish rendering.
 * Inspect the exact render operation's resolved resources; never export a silently blank figure.
 * Kept independent of PDF.js globals so the failure boundary can be regression-tested. */
export function createImageGuard(page: ImagePage, ops: ImageOps) {
  const fail = () => { throw new Error('原页包含未能解码的图片，已停止导出以避免缺图。请检查网络与 PDF 图片资源，或改用保留原页的 PDF 导出。'); };
  const resolved = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    const store = value.startsWith('g_') ? page.commonObjs : page.objs;
    if (!store.has(value)) return fail();
    return store.get(value);
  };
  const check = (value: unknown) => {
    const image = resolved(value) as { width?: number; height?: number; bitmap?: unknown; data?: { length?: number } } | null;
    if (!image || !(Number(image.width) > 0) || !(Number(image.height) > 0) || (!image.bitmap && !image.data?.length)) fail();
  };
  const mask = (value: unknown) => {
    const image = value as { data?: unknown } | null;
    if (!image) return fail();
    check(typeof image.data === 'string' ? image.data : image);
  };
  return (index: number, list: { fnArray: number[]; argsArray: unknown[][] }): boolean => {
    const fn = list.fnArray[index], args = list.argsArray[index];
    if (fn === ops.paintImageXObject || fn === ops.paintImageXObjectRepeat || fn === ops.paintInlineImageXObject || fn === ops.paintInlineImageXObjectGroup) check(args[0]);
    else if (fn === ops.paintImageMaskXObject || fn === ops.paintImageMaskXObjectRepeat) mask(args[0]);
    else if (fn === ops.paintImageMaskXObjectGroup) {
      if (!Array.isArray(args[0])) fail();
      for (const item of args[0] as unknown[]) mask(item);
    }
    return true;
  };
}
