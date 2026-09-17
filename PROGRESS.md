# Issue #128：辽宁栏目范围收紧与湖北结构化列表适配

当前阶段：本地实现和候选验证完成，Draft PR #129 已建立；完成本状态提交并固定 Head 后进行独立 review。基线为 `origin/main` `42395881e28f8d31971be73e8baf789b5a2d6df8`。

辽宁四个生产草稿栏目均有 2026-09-17 官网 HTML fixture。旧实现会优先返回各页面共同的公共区链接；failure-first 回归已复现。当前 parser 只有在页面存在至少两个与栏目目录具有稳定路径亲和的文章候选时才收紧到栏目簇，否则保留旧跨目录 CMS 行为。规范性文件实际使用 32 位十六进制 CMS article id，因此 article-index 识别扩展为受限的长数字或 24–64 位十六进制 id，普通目录 `index.shtml` 仍排除。四栏目真实 preview 已在 fixture/source-test 回归中相互区分，静态/JPaas 分页既有回归保持通过。

湖北已通过 Tabbit 独立确认两个错误栏目均使用官网结构化数据：`/zfxxgk/zc/gfxwj/zcwj.json` 与 `/zfxxgk/zc/qtzdgkwj/zcwj.json`。后者不是从规范性文件类推，而是从“其他公开文件”页面真实资源请求核验。adapter 通过同源静态 CMS 脚本模板识别，不依赖 sourceId 或栏目显示名；命中后在 HTML 假阳性之前读取同目录 JSON，错误 JSON、跳转、错误 MIME、非 UTF-8、超限响应或错误 schema 均 fail-closed，不退回机构侧栏。

结构化读取继续走既有 `sourceHttp`，manual redirect、12 秒 timeout；endpoint 要求同 origin、同协议。官网 JSON 中同 host 的旧 `http://` 文章链接只做 HTTPS 升级后再经过 allowlist 校验，不允许 HTTPS 降级或跨 host。响应上限 4 MiB、最多 5000 rows，只输出前 60 个有效同站候选；当前官网实测规范性文件约 138 KiB / 168 rows，其他公开文件约 1.19 MiB / 1560 rows。无任意 JavaScript 执行、无 challenge bypass。

为避免历史待处理候选继续沿用旧 parser 语义，collection scope 增加 `liaoning-column-scope-v1` 与 `hubei-structured-json-v1` runtime revision。它们只用于候选 scope 失效，不参与 parser 选择。

验证结果：

- failure-first：辽宁原始 5 项全部失败；湖北原始 6 项全部失败，均准确复现当前后台错误。
- focused + source config/admin/dynamic-list/collection-scope：24 files / 210 tests PASS。
- full Vitest：60 files / 573 tests PASS。
- production build：PASS，并通过 public-build boundary check；生成的 `shared/intelligence-snapshot.ts` 构建副作用已恢复，不进入候选。
- changed-file ESLint：PASS；`git diff --check` PASS。
- full typecheck：历史失败；clean `origin/main` 与当前标准化日志均 315 行且完全一致，本轮 0 新诊断。
- full lint：历史 3585 problems（3573 errors / 12 warnings）；clean `origin/main` 与当前标准化日志完全一致，本轮修改文件 0 lint error。

生产边界未改变：辽宁、湖北和海南均未启用，本阶段未触发“立即采集并上线”；河北 #126 未处理。未 merge、未 deploy。固定候选独立 review 通过后，仍需用户明确授权 merge/deploy；部署新版后才可在生产后台重新测试辽宁/湖北草稿并把真实 preview 交用户确认。
