# Mac 订阅批量更新

当前模式：Mac 登录后通过 LaunchAgent 自动检查新信息，每 15 分钟一轮，使用已有 ChatGPT 登录调用 Codex，结果通过现有仓库快照发布到 Cloudflare。网站原有实时 AI 配置保持不变。

## 使用

无需手动启动。登录 macOS 后自动运行，每 15 分钟检查上海/深圳/江苏住建公开栏目及 AIHOT，每来源最多分析 3 条新候选，保存分类结果，再提交新增快照并触发现有 Cloudflare 部署。仅在处理期间阻止空闲睡眠，平时允许正常睡眠；睡眠、关机或未登录期间不执行。网站始终可以展示已发布结果。双击 `tools/ai-bridge/mac-sync.command` 可提前触发一轮，不会创建重复后台服务。

首次部署已复用本机 Codex 的 ChatGPT 登录；登录失效时在终端运行 `codex login` 并由本人完成授权。程序通过官方 CLI 使用登录状态，不读取或复制登录文件，不要求用户填写 OAuth 凭据。新设备需安装 Node.js 22+、Codex、Git、GitHub CLI 和项目依赖，并建立仓库推送权限。

默认模型 `gpt-5.6-luna`、low 推理、只读运行，关闭 shell/web/apps/多代理工具；保留本机安全规则和 hook 配置。API 密钥环境变量不会传给分析子进程。订阅额度照常消耗，不自动重试、不自动换模型或付费 API。CLI 返回的 token 数用于核对调用量，不能换算为准确订阅剩余百分比。

本机 `.data/mac-batch/result.json` 保存已完成结果与判断，避免重复分析；该目录不进入 Git。正文、HTML、附件不保存；目前仅按标题证据分类，摘要不等同于读完原文。已入库 URL/标题不因换模型重复分析。建筑候选复用网站原有关键词召回规则，最终分类仍交给 AI。

## 验证与故障处理

发布前校验栏目、来源、URL 哈希、版本和分类结果，只追加快照中尚不存在的文章，保留旧文章、来源状态和 seen 数据。失败不提交半批 AI 结果。发布写入仓库快照，网站合并展示；不宣称已额外导入 D1。

源码有改动、当前分支不是 main、采集失败、登录失效、超时或推送冲突时停止，终端保留错误。先解决提示的错误再运行；不要删除本机结果文件来重试。意外断电后如发现 `.data/mac-batch/running.lock`，应先确认没有批次正在运行，再清理该锁。

若推送失败，本地提交仍然保留，解决网络或分支冲突后重推即可，不需要重新请求模型。完成提示中的 GitHub Actions 页面可以查看部署结果。当前实时刷新仍走原配置；批量入口与网站实时入口是两条独立通路。

## 本机后台服务

- LaunchAgent：`~/Library/LaunchAgents/com.capx.newsnow.mac-worker.plist`，RunAtLoad=true、StartInterval=900。
- 独立工作目录：`~/Library/Application Support/CapxNewsNow/repo`，不会切换或改动人工开发用的工作目录。
- 最近状态：该独立目录下 `.data/mac-batch/worker-status.json`；输出日志在上一级 `worker.log` 和 `worker-error.log`。
- 登录/网络/模型/发布错误后冷却一小时；单轮不自动重试或切换付费模型。正常轮次只调用尚未处理的新内容。
- 暂停：`launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.capx.newsnow.mac-worker.plist`。恢复：`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.capx.newsnow.mac-worker.plist`。
- Luna/low 首次实测 3 条约 23.1 秒，不能据此宣称已经显著提速；后台执行省去人工等待。
