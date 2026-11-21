# 开发指南

## 环境

项目要求 Node.js `^22.13.0` 或 `>=24.0.0`。`scripts/with-node.mjs` 会优先使用项目依赖中的 Node 24 启动器，避免系统 Node 版本不满足 Vite 8 的要求。

```sh
npm ci
npm run dev
```

开发服务器只监听 `127.0.0.1`。生产构建：

```sh
npm run build
npm run preview
```

`npm run build` 先执行 TypeScript 类型检查，再执行静态构建，输出到 `dist/`。

## 测试

```sh
npm test
```

测试入口是 `tests/run.mjs`，加载存储、文本、Worker 和导出测试。PDF 验收和真实 UI 导出检查见 [导出设计](EXPORT.md#验收)。

测试夹具：

- `tests/reading-fixture.pdf` 和 `tests/chart-fixture.pdf` 是原创软件验收文档，不是发表论文，也不包含研究结论。
- `tests/create-chart-fixture.py` 可以重新生成图表夹具，需要 PyMuPDF 和 Pillow。
- `tests/artifacts/` 是本地生成目录，不进入 Git。

## 资源与模型

仓库包含：

- `public/models/onnx-community/opus-mt-en-zh/` 的配置和分词器；
- `public/runtime/` 的 ONNX Runtime Web 资源；
- `public/pdf-runtime/` 的 PDF.js 字体、CMap 和 WASM；
- `public/fonts/QiyeSans-Regular.ttf` 的中文导出字体。

仓库不包含：

- `model-assets/` 中的 252 MB ONNX 权重和可变字体源文件；
- `node_modules/` 和 `dist/`；
- 测试生成文件、比赛提交材料和个人信息。

模型权重在运行时按固定 revision 从公开模型源获取。应用不会把文档正文发送给模型源。

### 生成导出字体

`public/fonts/QiyeSans-Regular.ttf` 是从 Noto Sans SC 可变字体生成的字重 400 静态实例，用于 PDF 完整嵌入。重新生成需要：

- 上游 `NotoSansSC[wght].ttf`，放在 `model-assets/NotoSansSC-variable.ttf`；
- `fontTools`；
- 运行 `python scripts/prepare-export-font.py`。

脚本会校验上游文件大小和 Git blob 哈希，再生成 `QiyeSans-Regular.ttf`。字体许可见 `public/fonts/OFL.txt`。

## 代码约定

- 保持现有 React 19、TypeScript 严格模式、Vite 和 Tailwind/shadcn 结构。
- UI 组件在 `components/ui/`，应用代码在 `src/`。
- 数据写入统一经过 `src/storage.ts` 的严格校验和事务；不要在组件中直接操作 IndexedDB。
- 译文结构保持 `{ text, engine, createdAt, issues }`；Worker 返回结果必须先净化。
- 人工校订的优先级高于自动翻译；任何重译逻辑都不能覆盖人工校订。
- 追加导出格式时，先在 `src/export-model.ts` 定义内容，再实现格式；保持取消、页码、来源和大小限制一致。
- 不提交真实论文、私人笔记、凭据、账号 ID 或含个人信息的截图。
- 不生成或编造论文图表、实验数据和研究结论。

## 目录

```text
src/           应用、阅读器、Worker、存储与导出
components/    UI 组件
public/        同源运行资源、字体、许可
tests/         回归测试、验收夹具、导出检查
scripts/       Node 启动器、构建、字体生成
docs/          架构、导出、开发文档与图片
functions/     Qoder Sites Function 示例（当前为静态站点）
dev/           本地 Function 调试
```

## 发布

静态站点可以部署到任意静态托管。当前线上版本通过 Qoder Sites 发布：

1. `npm run build`
2. 用 `dist/` 作为 webDirectory
3. 使用 Qoder Sites 的静态站点发布流程

站点是纯静态应用，部署时不包含 `model-assets/`。模型权重由浏览器在用户主动准备翻译时获取。

## 常见问题

### 首次翻译很慢

需要下载约 290 MB 的模型和运行资源，速度取决于网络；之后尽量复用缓存。不要在没有明确提示的情况下假设模型已经可用。

### 译文不准确

机器译文只用于阅读辅助。专业术语、数值、否定和不确定性措辞需要对照原文核对；人工校订后不会被自动重译覆盖。

### PDF 页面解析不完整

复杂版式、表格、扫描页或非横排文字可能出现解析提示。原 PDF 页面始终保留，可切换查看；项目不做 OCR。

### 浏览器存储被清理

使用完整备份保存到独立位置。浏览器可能在空间不足或清理数据时移除 IndexedDB 内容，应用无法阻止。

### 导出缺图或停止

先确认原 PDF 仍在本机且页数与文献记录一致；如果图片无法解码，导出会停止而不是生成白页。扫描件和特殊图像解码问题请保留原 PDF。
