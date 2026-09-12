# 开发接续
- 目标/阶段：Issue #74 / Draft PR #84；住建部正文与附件边界整改，等待用户启动新 Head 高级复审。
- 分支：codex/mohurd-source-maintenance-74；base：0a63231dfa23602651ad7c7616944428a7c5dd2a。
- candidate：本整改提交；精确 SHA、已同步 SHA 和 clean/dirty 在接续时以 git status、git rev-parse HEAD 和 PR #84 headRefOid 交叉核对，避免提交内自引用 SHA。
- 历史候选：102bd0831ee9208bafa2c58aa597a20ed6c03e94 已提交并推送，独立审查未通过；其“本地暂存、无 PR、远端仅 base”描述已过期。
- 已完成：识别 editorContent 模板后限定精确正文根；不合格正文停止提取，禁止宽泛 wrapper/body 和全局静态下载区回退；有效正文保留同级附件及原去重逻辑。
- 验证：新增短正文、外层 article 回归先失败后通过；36 项相关测试、CF_PAGES 构建、新测试 lint 通过；解析器 lint 仍有历史 55 错误 1 警告；正式类型检查改动文件无诊断，范围外 53 条；三篇实网正文 293/279/292、附件 2/1/1、日期正常。
- 执行归属：当前本地开发任务；本次仅修改解析器、回归测试和两份状态文档。历史 lint hook 豁免沿用用户对本修复的授权，不改变钩子配置。
- 未完成：新 fixed Head 高级独立复审；未合并、未部署、未发布来源配置。历史候选审查不覆盖本整改提交。
- 下一同步点：将本整改提交推送至同一 Draft PR #84，核对远端 Head 与 CI；用户启动该 Head 高级复审后再推进发布门槛。
