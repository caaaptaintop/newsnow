> 当前产品范围（2026-09-13）：仅显式识别为 PDF 的附件提供官方 URL 新标签页入口；所有附件保留原站下载。非 PDF 站内预览暂停，前端不加载 Reader 或触发附件 relay。下文的缓存、解析器及 Mac 备用链为保留实现，当前不从公开界面启用；不继续建设附件云端副本或 Mac 备用服务。

# 附件按需预览（受限临时缓存）

## 操作与格式

信息卡片继续保留附件数量和类型标签。展开后点击文件名进入站内预览弹窗；“原站下载”及弹窗内“下载原文件”均指向原始附件 URL，只有用户主动操作才打开。关闭弹窗不改变主题、筛选或信息流位置。

已接入：Word 97–2003 二进制 DOC、DOCX、PDF（浏览器原生查看器；未启用内嵌查看时提示手动下载）、TXT/CSV、PNG/JPEG/GIF/WebP/BMP，以及带有 Word 标记的 HTML 文档。DOC 是独立二进制解析，不是把 DOC 当 DOCX 使用。识别结合真实文件头，不依赖网址扩展名，支持 download?id=… 形式。

尚未接入：XLS/XLSX/PPT/PPTX/OFD、压缩包、RTF（包括改名为 .doc 的 RTF）、Word 6/95、加密文档。保留原始下载入口，不自动转换，不声称预览成功。DOC 使用结构化段落/表格模型，保留常见文字样式与部分嵌入图片；复杂合并单元格、绘图、修订与精确分页不保证还原。阅读预览不代替正式文件核验。

## 数据路径与存储边界

1. 不预取附件。用户点击后先由浏览器直接读取原站，credentials=omit、cache=no-store、redirect=error。
2. 跨域、跳转或原站直读失败时，向 `/api/intelligence/attachment` POST **topic、articleKey、url 三个定位字段**；不上传文件。
3. 后端用已有信息记录核对附件 URL 和域名，先预留额度；命中短期缓存则读取，否则回源。完整读取并执行大小上限后才向浏览器返回成功，避免半途失败变成不透明的流错误。不给调用者任意 URL 代理能力，不复制浏览器 Cookie、Authorization 或上游 Set-Cookie。
4. 按用户授权，成功且格式预检通过（拒绝已识别的错误页和明显损坏文件，不保证 PDF、OLE DOC 或图片的完整结构有效）、不超过 5 MiB 的文件可进入 Cloudflare Cache API，逻辑有效期 300 秒；读取时再次检查过期时间，缓存可能提前淘汰，各机房不共享命中。TTL 是不可继续读取的边界，不声称提供物理介质精确擦除保证。不新增磁盘、D1附件字节、R2/KV、转换件或第三方查看器。删除文章后先通过文章校验才可能命中缓存，不提供公开缓存文件地址。
5. 原站请求与发给浏览器的转发响应均禁用应用缓存；转发还带 CDN 与 Cloudflare-CDN no-store。现有 PWA 的 self-destroy/清缓存策略不变。附件正文不进入日志、快照或全文索引。
6. 关闭时取消 fetch / DOC Worker，撤销 Blob URL 并释放 UI 引用；已成功读取的边缘缓存按短期有效期处理。DOCX DOM 渲染已开始后可能完成当前解析再释放，但结果不会回写已关闭界面。

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

## 免费资源预算与降级

2026-09-12 已登录核对 Workers 免费套餐：100000 请求/日、10ms CPU/次；D1 免费 500万读行/日、10万写行/日、5GB 总存储。当时账户显示请求5061、读行529.44k、写行4.22k、存储1.88MB，均为取样而非实时承诺。R2 未开通，免费层超额会计费，本方案不引入。

用独立临时 D1 执行真实 reserveRelay/settleRelay SQL，首次日计数和分钟计数均不存在时：预留13写行/13读行，结算2写行/5读行，共15写行/18读行。保守按每次16写行分配48,000写行/日，对应代码最多3000次；生产既有管理员per_day=2000，实际采用较小值，不在本轮修改生产配置。这是全站转发预算，不是每位读者限制；缓存命中也经过额度保护。拒绝、维护、异常及账户其他业务仍消耗资源，不能保证账户实际总量；预算不可用时失败关闭。

撤销此前人为500次和512MiB的额外硬限制。字节限制沿用既有管理员配置（当前5GiB/日），属于运行保护，不冒称Cloudflare免费流量额度；每文件20MiB、边缘缓存5MiB/300秒、全站5并发、单云端实例2并发属于内存/等待保护。失联预留不退款，备用读取失败按最大文件预留计费，避免未知消耗被退回。免费日计量按UTC零点（北京时间08:00）复位。

## 住建部回源与 Mac 备用方案（本地候选，尚未启用）

隔离、无生产绑定的 Cloudflare Worker 直接读取真实 DOCX 返回HTTP530、正文error code:1016；同一云端DNS查询返回SERVFAIL及“No Reachable Authority at delegation mohurd.gov.cn”。本机真实文件200、61634字节，SHA256为0a94f84c91ea49c4ebce3621bd2d7940d848208505c67c3c0e3b270b5071cc25。此证据确认该取样时刻的云端DNS故障；不把它泛化为原站永久故障。临时Worker及临时D1均已删除。

路径：浏览器直读 → 已索引校验/预算 → 边缘缓存 → 云端回源。仅住建部HTTP530触发Mac备用，不对403/429、重定向拒绝或其他来源扩大重试。Mac无响应、忙碌或额度耗尽时展示原网页/下载入口，不建立排队或轮询。

实现入口：server/utils/attachment-backup.ts；tools/attachment-relay/service.ts、start.ts。Mac只监听127.0.0.1:8792，部署时通过专用Cloudflare Tunnel接入HTTPS /attachment。Pages需配置ATTACHMENT_BACKUP_URL和独立随机ATTACHMENT_BACKUP_SECRET；Mac通过进程环境接收相同密钥。禁止复用发布私钥、向浏览器暴露密钥或写入源码。HMAC覆盖完整请求、时间戳及nonce；有效窗口30秒、同一进程生命周期内重复请求拒绝（nonce仅存内存，重启会丢失，不能保证跨重启防重放）、8KiB请求上限、最多5任务同时执行。只允许住建部官方download接口及已实测cms_files附件路径，逐跳校验；证书正常验证，无HTTP降级，不访问任意主机。

备用服务内存读取，不落盘；Mac休眠/离线时首次未缓存附件无法保证站内预览，原页面和原站下载始终保留。它是按需服务，不创建第二采集调度器、不改900秒worker或ledger/outbox。运行部署需选择常驻服务目录、配置专用Tunnel与密钥；本轮未改生产配置、未启动常驻服务或正式Tunnel；仅使用已关闭的临时Quick Tunnel做隔离验证。

验收：签名/重放/越界跳转、云端530选择性回退等隔离测试通过；真实文件通过签名Mac处理器返回200。隔离Cloudflare→Quick Tunnel→Mac→原站实测200/61634字节/808ms，哈希一致；后续首次Mac682ms、缓存7ms；停Mac后缓存仍200/17ms，冷缓存返回503/715ms。真实同文件在Tabbit当前构建预览组件显示标题和1个表格（内存响应替换验证渲染，未冒充生产API验收）。浏览器直接访问临时workers.dev文件端点超时，云端传输与渲染分别取证，不声称该浏览器网络链路端到端通过。最初脚本生成被hook拦截，后改用不读取凭据文件的独立内存渲染验证，未改安全规则。

该候选增加请求认证和短期缓存边界，按项目2.6节需高级独立审查后才能合并；尚未形成clean固定提交，不以本地通过替代最终审查。下一阶段是固定候选及适用独立审查，通过后按生产授权配置专用Named Tunnel/密钥/常驻服务并发布验收。不能将隔离通道成功称为生产预览已恢复。

参考：
- https://developers.cloudflare.com/workers/runtime-apis/cache/
- https://developers.cloudflare.com/workers/platform/pricing/

- Cloudflare Tunnel公开应用无需付费Access套餐：https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/
- Workers DNS故障说明：https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1016/

## 2026-09-13 并发与 PDF 调整

已识别 PDF 的文件名链接直接在新标签页打开官方地址，不调用本站读取、缓存、Mac 或解析器，不占本站名额。隐藏扩展名且读取后才识别的 PDF 不再内嵌渲染，提示使用原站入口。是否直接显示由官方响应头及浏览器设置决定。

其他附件全站最多5个正在转发的文件；返回流读到EOF、取消或错误时释放名额，继续阅读不占名额。单实例保留2个读取及发送名额、同IP保留2个额度租约限制；资源保护可能在未满5个时拒绝请求。Mac备用服务最多5个并发，实际HTTP响应触发finish/close/error后才释放；按背压分块发送，不再在发送前整文件二次arrayBuffer。Cloudflare从占用本实例名额起75秒内结束发送（早于90秒D1租约），Mac发送上限30秒；超时终止流。流完成/Node finish表示已交给运行时或操作系统发送，不代表客户端已读取或渲染；应用层不保证运行时、Tunnel或内核缓冲区的总内存上限。繁忙返回429，用户可稍后重试或直接前往官网，不建立自动队列、不自动轮询。此限制统计请求，不保证按独立读者计数或相同文件请求合并。

## Issue #88 本次固定提交的 ESLint 豁免

2026-09-13 用户明确批准：仅为 Issue #88 本次建立固定本地 commit，一次性绕过已确认的仓库历史 ESLint 配置阻断。当前唯一活动 Git hook 是 pre-commit，其内容仅调用 npx lint-staged（eslint --fix）；使用该次提交进程的 SKIP_SIMPLE_GIT_HOOKS=1，不修改 hook、配置或永久环境。

此豁免不代表 ESLint 检查通过，不修改或关闭测试、类型检查、构建、独立审查、合并或生产部署门槛；形成固定 Head 后停止，等待独立审查，不合并、不部署。现有验证结果和已知边界保留。

独立待修问题：仓库 ESLint 配置与 React 插件版本不兼容，引用不存在的 react-dom/no-children-in-void-dom-elements 规则，导致页面 lint 在配置加载阶段失败；此前还发现 react/ensure-forward-ref-using-ref 缺失。后续单独修复配置与依赖兼容性，验收须恢复真实规则加载并执行受影响页面 lint，不能以关掉规则或本次豁免当作修复。本候选不处理该故障，不将历史诊断记为通过。原始证据见本机 .local/attachment-88/lint-next.txt。


## PENDING：独立审查整改增量

基于审查FAIL的本地Head `13d0c3ee82497742dd839266bf560c288d99e76e`，本轮修复响应发送生命周期。保留完整上游读取校验，Cloudflare缓存/回源共用无预读、64KiB分块的返回流；结算按实际已读取字节计费，取消不退还已消耗字节。Mac HTTP适配层通过pipeline传递背压、发送错误与取消，并以实际响应事件控制名额。

新增回归覆盖缓存/回源慢消费者、最后一块已取但未请求EOF、取消/超时、Mac发送背压及finish/close/error。原实现5个关键回归失败，修复后通过；证据位于 `.local/attachment-88/revision-lifecycle/`。这属于本地整改验证，需原独立审查任务复审增量；不替代官方PDF、正式Tunnel、生产DOC/DOCX、Cache和限流的生产验收。历史一次性hook豁免不延续至本轮。


## PENDING：统一75秒截止整改

上次dirty预审仍发现前置缓存/D1等待没有真正受75秒约束。本轮在实例slot占用时立即建立统一AbortSignal和定时器，D1预留、Cache open/match、缓存key计算、body读取、云端/备用回源及下游交付均沿用同一截止时间；可选缓存失败只在尚未取消/超时时允许回源。每次异步阶段完成及创建成功响应前再次检查绝对时间，避免定时器回调尚未调度时越过截止。

超时在HTTP 200返回前发生时，以424终止等待并只释放一次slot；已经开始的发送则终止流。Cache API与D1操作本身不提供AbortSignal取消：已经发起的操作可能晚到，但不会继续回源或发送。晚到缓存/回源响应取消body；晚到D1预留经waitUntil观察，取得lease后补做一次零读取失败结算。宿主若在晚到结果或结算前终止，仍沿用既有失联预留不退款、lease过期释放占位的fail-closed边界，不保证平台操作或结算一定完成。

尚未确认完成的原站读取在超时时保留最大文件字节预留；缓存body超时按已校验的Content-Length保守结算；完整读取成功后按实际长度结算。不更改D1 SQL、额度上限、Mac实现、签名、白名单和530限定备用条件。

本轮新增8项回归：open/match/body停滞、D1晚到、到达截止而定时器尚未执行、慢open后发送仍沿用原截止、客户端取消时match晚到、回源响应晚到及保守结算。5个核心场景在修复前dirty快照上分别独立执行并失败；记录附完整命令、Head及源码哈希，不冒称该dirty快照就是Head源码。当前8文件104项通过、生产构建通过；本轮证据位于 `.local/attachment-88/revision-deadline/`。历史lint/全库类型诊断及提交、独立复审、生产验收门槛保持。
