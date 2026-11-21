# 栖页 · QIYE

一个运行在浏览器里的文献阅读工作台。导入英文 PDF，阅读原文、生成中文译文、回查证据、保存笔记，并把整理结果导出为 PDF、Word 或 Markdown。项目不接收费云模型 API，文献内容不上传到远程模型。

在线体验：https://qiye-library-q5ridqj4azi.qoder.website

2026 Qoder 高校创造力大赛 StudyHack 赛道参赛作品。

## 能做什么

- 导入原生文字 PDF 或粘贴英文正文，在浏览器里按页阅读。
- 使用 OPUS-MT 英中模型在本地 Worker 中翻译，逐段保存，支持取消和人工校订。
- 从正文抽取带页码、可回查的证据提要，不把抽取结果冒充完整综述。
- 保存与原文段落关联的阅读笔记，刷新后仍可恢复草稿。
- 导出 PDF、Word 和 Markdown 阅读整理。PDF 可附上原论文页面，保留矢量图表、图注和原始尺寸；Word 正文可编辑，附录为高清原页图。
- 导出和恢复包含原 PDF、译文、笔记和设置的完整备份。
- 提供减少动态效果、阅读字号和术语表等本地偏好。

## 本地运行

要求 Node.js `^22.13.0` 或 `>=24.0.0`。项目内带有 Node 24 启动器，脚本会通过 `scripts/with-node.mjs` 选择可用运行时。

```sh
npm ci
npm run dev
```

打开 Vite 输出的本机地址。生产构建和预览：

```sh
npm run build
npm run preview
```

自动化检查：

```sh
npm test
```

当前回归检查覆盖存储、文本处理、Worker 通信、导出模型和异常保护，共 54 项。

首次使用本地翻译时，会从公开模型源下载约 290 MB 的 OPUS-MT 权重与运行资源，具体取决于网络。权重使用固定 revision `4dc37afc6deb160f4c9048260d48019ee497658e`，优先从 `hf-mirror.com` 获取，失败时尝试 Hugging Face。模型资源可以缓存，但不承诺所有设备都能运行或永久离线。

## 目录

```text
src/            React 界面、PDF 阅读、翻译 Worker、存储与导出
public/         站点运行资源、PDF.js 资源、分词器、字体与许可
components/     项目使用的界面组件
functions/      Qoder Sites Function 示例（当前站点为纯静态）
tests/          自动化回归、PDF 验收夹具与导出检查
scripts/        构建、Node 启动器和字体生成脚本
vendor/         vendored 样式与许可
```

## 数据与隐私

- 文献、译文、笔记和偏好保存在浏览器的 IndexedDB 或 sessionStorage 中。
- 文档内容不会发送到远程翻译服务；翻译在浏览器 Worker 内完成。
- 页面和公开模型资源需要网络，模型下载服务不会收到文档正文。
- 浏览器存储可能被清理或回收；请使用完整备份保存到独立位置。
- 完整备份包含原 PDF，导出前请自行确认文件的去向和访问权限。

## 导出与论文图表

PDF 导出会嵌入中文字体，重新排版正文、译文、证据和笔记，并在勾选时把原 PDF 页面作为附录复制进去。原页附录保留图表、图注、坐标、表格和横向页面，避免自动裁切造成信息丢失。

Word 导出生成可编辑的正文，附录是原 PDF 整页的 1800 像素长边 PNG。附录图片不可编辑，也不翻译图表内文字。项目不会为了“丰富图表”而编造、改绘或重新绘制论文数据。

PDF 的整理页与原 PDF 页码是两套编号，导出文件会保留原文页码以便回查。选择部分附录页码时，原 PDF 内部的跨页链接不保证保留。

## 边界

当前版本以桌面浏览器和原生文字英文 PDF 为主。扫描 OCR、复杂图表理解、任意设备的生成摘要、云同步和跨标签页并发编辑不在保证范围。机器译文必须对照原文核对，专业术语和数值尤其如此。Qoder Sites 的托管免费期与额度以平台规则为准。

## 仓库范围

本仓库包含可构建的源码、测试和站点运行所需的公开静态资源。以下内容不进入仓库：

- `node_modules/` 和 `dist/` 构建产物；
- `model-assets/` 中的 252 MB 本地 ONNX 权重和字体源文件；
- `tests/artifacts/` 中的生成文件；
- `submission/` 中的比赛提交草稿和带个人信息的材料；
- `.qoder.site` 发布描述符。

模型权重不随仓库分发，应用在首次运行时按固定 revision 从公开模型源获取。`public/models` 中的分词器配置、`public/runtime` 的 ONNX Runtime 资源、PDF.js 资源和导出字体随仓库保留，便于本地构建和复现。

## 第三方许可

本项目使用 React、Vite、pdfjs-dist、Transformers.js、ONNX Runtime Web、pdf-lib、docx 等第三方项目。模型、运行库、字体和示例来源的许可见：

- [PROVENANCE.md](PROVENANCE.md)
- [public/licenses.txt](public/licenses.txt)
- [public/fonts/OFL.txt](public/fonts/OFL.txt)
- `public/runtime/LICENSE.txt` 与 `public/runtime/ThirdPartyNotices.txt`
- `public/pdf-runtime/LICENSE.txt`

第三方组件和资源遵循各自许可。仓库中的原创应用代码尚未单独声明统一的开源许可证。
