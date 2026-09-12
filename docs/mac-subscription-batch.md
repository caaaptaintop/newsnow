# 建筑资讯：Mac 采集与 D1 增量发布

## 范围

当前仅启用 `building`。网站公开免登录，不建设访客账户。七个建筑栏目及原有来源保留；其他主题的定义与历史记录保留，但不采集、不分析、不公开返回。

后台继续使用现有本机 Codex 登录与模型设置。正常阅读、搜索、翻页、刷新或附件预览不触发 AI。Mac 离线或休眠时停止采集，网站继续显示最近已发布数据。

## 运维授权

开发模型与协作流程见 [AGENTS.md](../AGENTS.md) 第 2–3 节；生产保护见第 6–12 节。自动开发编排不授权操作生产运行副本、数据、调度或真实发布；本文件以下步骤仅在对应生产任务明确授权后执行。

## 云端与本机必须分开验收

部署工作流先迁移、校验已有建筑元数据，迁移完整性检查通过前，D1 新读取接口不对外返回半成品。可信临时预览使用短期凭据；清理临时凭据、数据库绑定和临时部署后，才允许发布生产版本。旧表和仓库历史不删除，生产构建不包含资讯快照。

云端上线不代表本机已切换。只有完成下述准备并运行一次真实采集发布，才算本机切换成功。

## 本机切换

原有独立运行副本通常位于 `~/Library/Application Support/CapxNewsNow/repo`，原任务标签为 `com.capx.newsnow.mac-worker`。先核对真实 launchd plist 的 ProgramArguments、WorkingDirectory 和日志位置；不要假定手动开发副本就是任务使用副本。

先暂停任务调度，等待已运行的旧任务退出；备份本机 `.data/mac-batch` 和任务配置。禁止删除待发布结果、发布回执、文件锁或未知工作区改动。仅在干净的 `main` 上 `git pull --ff-only origin main`，安装锁定依赖。

运行：

```sh
node tools/ai-bridge/publisher.mjs prepare
```

首次准备会在 `.data/building-publisher/private-key.pem` 生成 Ed25519 私钥，目录 0700、私钥 0600。私钥不离开本机、不进入 Git 或日志。只将公钥及允许的机器操作登记到 `shared/building-publisher-keys.json`，生成一次配置提交并推送。服务器必须部署公钥后才接受该机器发布；等待期间 prepare 拒绝继续，不调用 AI。

公钥部署成功后再次 prepare，然后：

```sh
node tools/ai-bridge/publisher.mjs status
```

确认数据库为 D1、migrationComplete 为 true，且公钥身份可正常认证，再运行一轮现有 Mac worker。准备失败时不要恢复无限重试式手动运行，不得改为匿名发布或临时关闭签名检查。

如公钥曾登记后被移除，程序不自动重新授权，需维护者核实。私钥缺失时先检查原运行目录及备份，不覆盖既有身份。

## 正常发布链路

`mac-worker.mjs` 拉取代码后先执行 publisher prepare，再检查 Codex 登录，最后采集与分析。采集去重使用后台已发布副本和签名 known 查询，不依赖公开第一页。

`apply-batch.ts` 发送最多 20 条一批的元数据，带版本基线和唯一批次号；一个采集轮次可能包含多个原子批次。发布失败保留待发布结果；收到响应前网络断开时，重试利用回执防重复写入。日常资讯发布不修改两个历史 snapshot 文件，不提交 `chore(data)`，不触发整站部署。

本机 `.data/mac-batch/published.json`、`published-ledger.json`、`publish-outbox.json` 用于同步、去重与恢复，不可作为可随意删除的临时文件。

只保存结构化元数据、摘要和原站附件链接。正文和 HTML 可在分析时临时读取，不持久保存；附件字节不写入文件、数据库、对象存储或缓存。

## 运维

仅有机器凭据的维护者可执行：

```sh
node tools/ai-bridge/publisher.mjs status
node tools/ai-bridge/publisher.mjs pause-relay
node tools/ai-bridge/publisher.mjs resume-relay
node tools/ai-bridge/publisher.mjs maintain
```

暂停转发不关闭资讯阅读与原站入口。正常验证不应耗尽线上额度或对原站做压力测试。

默认转发上限：单文件 20 MiB，每 IP 每分钟 6 次、最多同时 2 次；全站每天 2000 次、预留上限 5 GiB、最多同时 20 次。全站额度由 D1 原子预留，完成后幂等结算；不明消耗保留最大预留，不因超时自动退款。该额度是运行保护，不是云账单金额上限。

## 验收证据

记录代码 SHA、公钥 ID（不含私钥）、云端部署状态、本机一次任务起止时间、发布前后内容版本、数据库记录数、发布回执和工作区状态。没有新资讯时明确记录本轮新增 0，不构造假文章或改发布时间制造更新。公钥配置完成后的日常轮次不得出现数据提交或整站部署。

原状态文件通常为 `.data/mac-batch/worker-status.json`，日志通常为 `~/Library/Application Support/CapxNewsNow/worker.log`，以本机任务配置核实为准。恢复原调度前确认没有重复任务或遗留旧进程。
