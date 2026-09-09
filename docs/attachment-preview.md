# 附件按需预览（不存储文件）

## 操作与格式

信息卡片继续保留附件数量和类型标签。展开后点击文件名进入站内预览弹窗；“原站下载”及弹窗内“下载原文件”均指向原始附件 URL，只有用户主动操作才打开。关闭弹窗不改变主题、筛选或信息流位置。

已接入：Word 97–2003 二进制 DOC、DOCX、PDF（浏览器原生查看器；未启用内嵌查看时提示手动下载）、TXT/CSV、PNG/JPEG/GIF/WebP/BMP，以及带有 Word 标记的 HTML 文档。DOC 是独立二进制解析，不是把 DOC 当 DOCX 使用。识别结合真实文件头，不依赖网址扩展名，支持 download?id=… 形式。

尚未接入：XLS/XLSX/PPT/PPTX/OFD、压缩包、RTF（包括改名为 .doc 的 RTF）、Word 6/95、加密文档。保留原始下载入口，不自动转换，不声称预览成功。DOC 使用结构化段落/表格模型，保留常见文字样式与部分嵌入图片；复杂合并单元格、绘图、修订与精确分页不保证还原。阅读预览不代替正式文件核验。

## 数据路径与存储边界

1. 不预取附件。用户点击后先由浏览器直接读取原站，credentials=omit、cache=no-store、redirect=error。
2. 跨域、跳转或原站直读失败时，向 `/api/intelligence/attachment` POST **topic、articleKey、url 三个定位字段**；不上传文件。
3. 后端用已有信息记录核对附件 URL，按块流式转发原站 GET 响应。不给调用者任意 URL 代理能力，不复制浏览器 Cookie、Authorization 或上游 Set-Cookie。
4. 不写附件到磁盘、数据库、R2/KV/Cache API；不保存转换件，不调用 AI、不向 Google/Microsoft 等查看器上传。沿用既有 metadata-only 存储策略。边缘运行时有暂时的传输缓冲，这不等于持久保存；不承诺操作系统永不交换内存。
5. 原站与转发请求均禁用应用缓存；转发还带 CDN 与 Cloudflare-CDN no-store。现有 PWA 的 self-destroy/清缓存策略不变。附件正文不进入日志、快照或全文索引。
6. 关闭时取消 fetch / DOC Worker，撤销 Blob URL 并释放 UI 引用。DOCX DOM 渲染已开始后可能完成当前解析再释放，但结果不会回写已关闭界面。

## 约束与隔离

文件上限 20 MiB，ZIP 目录预检限制解压声明总量 80 MiB、4096 个条目，DOC Worker 超时 20 秒；上游转发超时 45 秒，最多 3 次重定向。文件大小与 ZIP 预检不是对所有恶意压缩文件的绝对保障。

转发只接受已索引附件；每一跳限制到 `.gov.cn` 或信息源配置中的精确域名。拒绝 IP、localhost/内网形式地址、含凭据 URL、非标准端口、非 HTTP(S) 与 HTTPS 降级；不接受请求体传入域名白名单。确需第三方官方附件 CDN 时，管理员可通过 Cloudflare 运行环境的 `ATTACHMENT_ALLOWED_HOSTS` 添加逗号分隔的精确主机名，不要加入未知用户控制域名。此处信任政府/管理员控制域名的 DNS，不做任意域名 DNS 解析代理。

Word HTML 在 inert template 中清理后进入不含 allow-scripts/allow-same-origin 的 sandbox iframe。CSP 禁止网络、脚本、表单、外部资源；只容许本地样式和内嵌 raster 图片。DOCX 关闭 altChunk、嵌入字体及批注渲染。原始 HTML 登录/验证页不会冒充文件预览。

需要登录 Cookie、验证码、客户端证书或必须 POST 才能取得的原站附件不能普遍处理；失败时使用原网页/原站下载，不绕过权限。不使用第三方云转换兜底。

## 依赖与验证

- `docx-preview@0.4.0`，Apache-2.0，按需加载。
- `legacy-word-reader` 为 `Alpaq92/JSDoc` 的固定 Git 提交 `821695a884e0c0bb8592a635d9524bb3e116cd67` 别名，0BSD。不是 npm 上用于生成代码文档的 `jsdoc`。
- 合成 DOC 由该库的 writer 在测试内存中生成，DOCX/PDF/图片也是合成测试数据；不把真实政府附件写入仓库或 CI 产物。
- `pnpm exec vitest run test/attachment-preview.test.ts test/attachment-route.test.ts`：文件识别、中文 DOC 表格、流转发、取消、大小、跳转、超时与已索引授权。
- `CF_PAGES=1 pnpm run build` 后，CI 用真实 Chrome 加载生产客户端：直接读取/跨域兜底、DOC Worker、DOCX、搜索、隔离、错误回退、PDF/图片 Blob 释放、Esc、手机布局、无自动下载。
- 类型检查沿用仓库规则：改动文件不得新增错误，既有未触及文件的诊断另存 CI 证据；不把“改动文件通过”说成“全仓库零诊断”。
