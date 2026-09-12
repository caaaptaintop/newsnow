# 个人信息情报站：项目协作与 Agent 规则

本文件是 `caaaptaintop/newsnow` 的长期工程规则唯一真源。`HANDOFF.md` 只记录当前接续现场，`PROGRESS.md` 只记录阶段状态，`docs/AI-COLLABORATION.md` 只解释本文件流程，不得形成第二套长期规则。

优先级：用户当前最新明确要求 > 本文件 > 说明文档 > 既有实现、历史 PR 和旧习惯。长期规则变化时同步更新本文件、相关说明和网页端项目指令；不要把临时 SHA、单次测试数、revision 或单个 PR/CI 的瞬时状态写入长期规则。

## 1. Canonical Repository Identity Gate

Canonical repository identity 固定为 `caaaptaintop/newsnow`（GitHub.com）。任何本地开发会话在 Issue/PR 编排、branch/worktree 创建、文件修改、push 或本机测试前，必须先验证仓库身份和明确指定的工作区根目录。

预先把 `NEWSNOW_EXPECTED_ROOT` 设为当前任务明确指定的绝对 worktree 路径，不能用刚检测到的 cwd 自动回填。身份门只允许安全规范化输出；原始 remote URL、userinfo、credential、token 或 Git trace 不得进入日志、Issue、PR 或模型回复。

```sh
python3 - <<'PY'
import json, os, re, subprocess
from pathlib import Path
from urllib.parse import urlsplit

CANONICAL = 'caaaptaintop/newsnow'
root = branch = identity = 'unknown'
status = ''
reason = 'identity check failed'
passed = False

def git(*args):
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_TRACE')}
    env['GIT_OPTIONAL_LOCKS'] = '0'
    result = subprocess.run(['git', *args], capture_output=True, text=True, env=env, timeout=10)
    if result.returncode != 0:
        raise ValueError('git check failed')
    return result.stdout.rstrip('\n')

def normalize(raw):
    if any(c.isspace() or ord(c) < 32 for c in raw) or any(c in raw for c in '%?#\\'):
        raise ValueError('unsupported URL')
    if raw.startswith(('https://', 'ssh://')):
        url = urlsplit(raw)
        host = url.netloc.rsplit('@', 1)[-1]
        if host != 'github.com' or url.query or url.fragment:
            raise ValueError('unsupported host')
        if url.scheme == 'ssh' and (url.username != 'git' or url.password is not None):
            raise ValueError('unsupported SSH identity')
        path = url.path.removeprefix('/')
    elif raw.startswith('git@github.com:'):
        path = raw[len('git@github.com:'):]
    else:
        raise ValueError('unsupported URL')
    path = path.removesuffix('.git')
    if not re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9_.-]*/[A-Za-z0-9_-][A-Za-z0-9_.-]*', path):
        raise ValueError('ambiguous repository path')
    return path

try:
    root = git('rev-parse', '--show-toplevel')
    branch = git('branch', '--show-current')
    status = git('status', '--short')
    fetch_urls = git('remote', 'get-url', '--all', 'origin').splitlines()
    push_urls = git('remote', 'get-url', '--push', '--all', 'origin').splitlines()
    if len(fetch_urls) != 1 or len(push_urls) != 1:
        raise ValueError('ambiguous origin')
    fetch_id, push_id = normalize(fetch_urls[0]), normalize(push_urls[0])
    if fetch_id != push_id:
        raise ValueError('fetch/push identity mismatch')
    identity = fetch_id
    expected_root = os.environ.get('NEWSNOW_EXPECTED_ROOT', '')
    if identity != CANONICAL:
        reason = 'repository identity mismatch; fail-closed'
    elif not expected_root or not Path(expected_root).is_absolute():
        reason = 'expected root missing; fail-closed'
    elif Path(root).resolve() != Path(expected_root).resolve():
        reason = 'repository root mismatch; fail-closed'
    else:
        passed, reason = True, 'PASS'
except Exception:
    reason = 'identity unavailable or ambiguous; fail-closed'

report = dict(repo_root=root, repository_identity=identity, branch=branch,
              expected_repository_identity=CANONICAL, reason=reason)
if passed:
    report['status'] = status
print(json.dumps(report, ensure_ascii=False))
raise SystemExit(0 if passed else 1)
PY
```

只接受 host 精确为 `github.com` 的 HTTPS、`ssh://` 或 `git@github.com:` 形式；fetch/push 必须各只有一个有效 URL、安全规范化身份一致且精确等于 canonical identity。fork、同名仓库、SSH alias、多目标 remote、额外 path/query/fragment、预期 worktree 缺失或根目录不一致均 fail-closed。

身份门失败时，禁止自动切目录、修改 remote、创建/修改 Issue/PR、创建 branch/worktree、修改文件、push、reset、stash、clean 或猜测用户本来想进入哪个仓库。只报告安全规范化 identity（无法确定则 `unknown`）、repo root、branch、预期 identity 和停止原因。

所有 `gh` 写操作必须显式指定 `--repo caaaptaintop/newsnow`；只读也优先显式绑定。Issue/PR 编号只有在 repository identity 已验证后才有意义。

## 2. 开发治理：local-first + GitHub 正式治理

### 2.1 双层事实模型

- 开发中的未同步事实，以明确指定的本地 worktree、当前 branch 和实际文件状态为权威。未提交/未 push 的 diff、本地测试、Mac 日志和本机运行事实不能由 GitHub 状态替代。
- 已同步的跨设备事实，以 GitHub branch/PR 中实际 push 的 commit 为正式共享与网页端审查依据。网页端正式 review 必须绑定明确 SHA。
- 阶段完成并合并后，以 GitHub `main` 的实际 merge SHA 重新作为共同基线。
- 最终 review、merge、部署或阶段通过，只能针对 clean worktree、明确 commit SHA 和与该 SHA 对应的可复现证据；不得对 dirty working tree 作最终判断。

### 2.2 正式治理链路

默认链路：

`Issue → 独立 branch/worktree → 本地连续开发与测试 → clean fixed candidate → Draft PR → fresh independent review → 修复 → final Head → merge main → 部署/生产验收`

`main` 不作为日常开发分支，不直接承载未经审查的开发改动。local-first 只改变开发和验证的执行位置，不取消 Issue、独立分支、Draft PR、final Head 审查和 main 合并门槛。

GitHub 不承担每一步中间交接。小迭代在本地连续完成，达到正式同步点才 push；禁止把“每修改一个小点就 push + 跑整套 Actions”作为默认流程。

### 2.3 Session bootstrap

每个新的本地开发会话必须：

1. 运行第 1 节 Repository Identity Gate；
2. 读取最新 `AGENTS.md`、`HANDOFF.md`、`PROGRESS.md`；
3. 检查 worktree `git status`、branch、HEAD、实际 `origin/main`；
4. 实时读取当前 branch 关联的 Issue/PR；
5. 检查未知 dirty 状态和并行修改。

聊天中的 branch、PR 状态、main SHA 只能作为线索，正式判断以本地 Git 与 GitHub 实际状态为准。不得自动 `reset`、`stash`、`clean` 或覆盖未知修改。

### 2.4 自动编排

用户只需要提出需求、反馈或“继续”。以下常规流程由执行模型自动判断，不要求用户做项目管理：

- 当前消息属于既有 Issue 的验收目标、实现直接发现的缺陷、必要测试、文档修正或范围内重构：复用原 Issue；
- 独立新功能、独立业务目标、显著改变验收范围、无直接因果的既有缺陷，或需要单独安全/数据/权限跟踪：创建新 Issue；
- 每个独立 Issue 默认独立 branch；需要并行、保留现场或遇到未知 dirty 状态时自动使用独立 worktree；
- branch 使用 `feat/`、`fix/`、`chore/`、`docs/` 等语义前缀；
- 达到 clean fixed candidate、完成风险匹配的本地验证和最终 diff 自审后，才形成同步点并 push；
- 达到正式共享审查、跨设备继续、远端备份或独立 review 需要时，自动创建或更新同一 Draft PR；禁止常规 force push；
- 普通风险 fixed Head 默认路由到 fresh ChatGPT Web/context，对明确 GitHub SHA 做独立复核；发现问题后继续原 Issue、原 branch、同一 Draft PR 修复，形成新 fixed Head 后重新 review。

### 2.5 GitHub Actions 使用策略

GitHub Actions 不是日常本地开发每个中间状态的必要前置。优先本地运行与改动范围匹配的测试；只有 fixed candidate / 正式同步点 push 后，才依赖 Actions 做共享候选验证。

不得为了“看是否绿”而高频提交微小 checkpoint。若实际遇到 Actions 额度/预算阻断，立即停止新增 Actions 消耗并报告原始错误；不得自行充值、提高预算或通过反复 rerun 消耗额度。

### 2.6 Review routing 与高风险升级

普通风险可按上述自动编排推进。以下情形必须暂停自动 merge，固定待审 Head，并进行更高等级独立审查：

- 生产 D1 schema、迁移、数据修复、删除、重建或版本守卫；
- Cloudflare Access、鉴权、密钥、公钥/私钥、权限模型；
- 发布协议、幂等/CAS/事务/恢复、来源配置发布门禁；
- Mac worker / launchd / 900 秒调度、锁、ledger、receipt、outbox、运行副本；
- 附件持久化边界、正文/HTML 数据边界；
- 真实生产写入、不可逆删除或恢复路径；
- CI/部署规则本身改变最终验收门槛；
- 本地证据与 GitHub 状态不一致，或工具/桥接行为无法解释；
- 本治理规则和 review 路由发生实质变化。

高风险升级不等于必须让 Codex 开发；ChatGPT 仍负责方案、源码审查和最终判断，Codex 只做不可替代的本机执行与事实采集。

### 2.7 User decision boundary

Issue 复用/新建、branch/worktree、checkpoint、push、Draft PR、普通 review 路由均由执行模型决定。只有以下情况才询问用户：

- 产品方向存在多个实质不同方案且上下文无法可靠推断；
- 需求歧义会改变目标；
- 真实生产授权、不可逆高价值操作；
- 需要用户选择真实数据对象、账号、环境或物理设备；
- 登录/凭据输入或其他必须由用户完成的交互。

## 3. ChatGPT 与 Codex 分工

ChatGPT 是默认技术负责人、主要开发者和独立审查者，负责需求、架构、实现方案、代码修改方案、测试设计、GitHub 治理、diff 审查、CI/部署审查、合并与云端验收。

在 local-first 工作区中，Codex 是本地工具层：按 ChatGPT 明确的实施方案执行文件读写、Git、Shell、本地测试、GUI、macOS 专项和本机事实采集。Codex 不因承担本地文件修改而取得架构决策权，不自行扩大为重构、另开功能、合并或部署。

若当前网页端 ChatGPT 没有本地桥接，则不得声称看见未 push commit、dirty diff、本地测试或本机文件。需要正式网页端 review 时，先固定 clean commit 并 push 到 GitHub branch/Draft PR，再对明确 SHA 审查。

对于纯 GitHub/云端工作，ChatGPT 现有工具足以完成时直接完成；对于确需本机 worktree、Mac 网络、浏览器、launchd、私钥权限或本地生产状态的步骤，再由 Codex 执行。

Codex 完成后不以“自报通过”替代 ChatGPT 审查。

## 4. 缺陷修复与代码规则

缺陷默认闭环：

`复现 → 根因 → 失败回归 → 最小修复 → 回归 → diff 自审 → fixed candidate → independent review`

禁止通过清缓存、删 ledger/outbox/result/receipt、降低校验、吞错误、扩大重试、绕过发布门禁等方式掩盖根因。

最终合并前至少核对：实际 Head SHA、base、changed files、完整关键 diff、测试、CI、review、已知边界和并行提交。不能只信 PR 描述、绿色标记或 Codex 总结。

## 5. 独立审查与证据分级

输出结论时严格区分：

- **独立确认**：ChatGPT 实际读取源码/完整原始日志、重算或隔离实测；
- **证据支持**：来自 CI、Actions artifact、GitHub Issue/PR 中 Codex 原始日志等可复核证据，但 ChatGPT 未完整重跑；
- **仍待补证**：只有摘要、自报通过或关键原件缺失。

不得混淆：HTTP 200/MIME 正常 ≠ 浏览器实际可读；outbox 为空 ≠ 恢复正确；CI 通过 ≠ Mac 已采用新版；云端部署成功 ≠ 本机 worker 已切换；当前导出 ≠ 历史时点原始证据；RunAtLoad ≠ 900 秒 interval；Codex 自报通过 ≠ ChatGPT 独立验收。

## 6. 当前产品与公开边界

除非用户明确改变：

- 当前公开产品仅启用 `building` 建筑主题，公开免登录；
- 不开放访客登录、访客账号、授权管理后台或访客 AI 设置；
- 内部信息源管理中心是已授权例外，仅供通过 Cloudflare Access JWT 和精确邮箱白名单的管理员访问；缺少配置时失败关闭；
- 建筑主题保留既有二级栏目、搜索、地区/城市等筛选；
- 其他主题定义和历史数据可保留，但默认不采集、不分析、不公开；
- 正常阅读、搜索、翻页、刷新、附件预览不触发 AI；
- Mac 后台采集/分析与公开阅读链路分离。

## 7. 来源配置与采集

- 来源身份官网 `home` 与实际生产采集栏目分离；explicit 配置只抓明确栏目，不因失败自动回退首页；
- 来源配置走草稿、版本基线、与草稿指纹匹配的近期测试和原子发布；发现候选不等于允许发布；历史版本恢复只恢复为草稿，不自动发布；
- 发布配置前必须由真实生产解析路径验证全部启用栏目；配置状态与运行健康分开显示，HTTP 200 不等于解析到真实文章；
- 若 Cloudflare 云端测试仅因自身 DNS/网络环境失败，而生产采集实际运行在 Mac，只允许把该结果标为待本机复核；既有签名 Mac worker 必须在自然周期对完全相同的 draft hash、activeRevision 和 cloud testedAt 使用真实生产解析器复核。Mac 成功结果仍走同一 `sourceTestAllowsPublish` 合同和原子发布门禁；失败、过期或版本漂移均不得发布；
- `source-tests` / `source-test-result` 只能由具备独立 `runtime-source-test` capability 的已登记 Ed25519 签名机器执行；Cloudflare 短期 deployment bearer 不具备该能力。不得用通用 `operate`、HTTP 200、人工浏览器可见或手工摘要替代真实解析验证；
- 对静态 HTML 仅提供页面壳、且页面明确声明同源 JPaas `page/build/unit` 数据单元的站点，只允许按页面内受限参数构造同源 HTTPS 请求，把 `data.html` 交给既有 parser；不执行站点 JavaScript、不用浏览器作为生产采集器、不跨主机、不降级 TLS/HTTP；
- JPaas 分页按已实测协议使用 `paramJson={"pageNo":N,"pageSize":20}`。实际采集只在当前页仍存在尚未处理且命中建筑主题召回的记录时继续，遇到已处理相关记录、空页或重复页即停止；单栏目单轮硬上限 5 页，达到上限只记录 partial/warning，不声称历史已全量补齐。后台配置测试仍只验证第一页可解析性，不为一次发布测试遍历历史分页；
- 官方来源低并发、有限请求；遇到 TLS/403/412/429/521/530/验证码先分类诊断；禁止关闭证书校验、全局 HTTP 降级、绕过验证码、高频重试；
- 不得把导航、栏目名、错误页、登录页、验证码页当文章，也不得把采集时间冒充发布日期；
- 动态站点如需专用读取，只允许确定性、可审查、有限请求的适配，不把浏览器渲染默认化为生产采集方案。

## 8. 数据与附件边界

- 持久层只保存结构化元数据、摘要、分类和原站文章/附件链接；
- 正文与完整 HTML 仅允许临时读取，不长期保存；
- 附件字节不得持久写入 Git、D1、对象存储、服务端缓存或证据包；
- 附件目标是“先预览，再决定是否下载”，覆盖 PDF/DOCX/DOC；优先浏览器直连，必要时使用既有无持久存储 relay；
- 验收必须区分链接发现、传输正常和浏览器实际渲染；
- 真实密钥、Token、Cookie、密码、私钥不得进入 Git/PR/日志/artifact/fixture；Mac Ed25519 私钥只留本机。

## 9. D1 与生产数据保护

- 继续使用既有 D1 和迁移结果；未经用户明确批准，不创建/删除/重建/清空/重新初始化生产数据库；
- 不重复已完成迁移、历史删除或精确归并，不改迁移标记，不用当前数据冒充历史证据；
- 生产写入必须先只读核对，限定精确版本、ID、字段和停止条件，并沿用现有鉴权、版本基线、幂等和原子批次保护；
- 公开 GET 不因读取而做 DDL 或隐式修复；
- 测试默认使用 fixture、隔离 SQLite 或可验证模拟，不为回归调用真实生产 D1。

## 10. Mac worker 与调度保护

- 沿用现有运行副本和 launchd，不新增第二调度器；
- 不为测试缩短 900 秒周期，不把 RunAtLoad 当 interval；
- 不随意 kickstart/bootout/bootstrap/强杀，不在 worker 运行时 checkout/reset/pull；
- 不删除活锁、result、receipt、ledger、outbox 或未知本地改动；
- 观察自然周期时不得手动触发制造“通过”；
- Mac 离线或休眠可停止采集，公开站继续展示最近已发布数据；
- 生产副本和开发 worktree 必须区分，local-first 开发不得把生产运行目录当普通开发 worktree。

## 11. AI 与成本边界

- 未经用户明确同意，不新增收费 API、代理、模型费用或高频推理；
- 能用确定性 fixture/隔离测试完成的回归，不调用真实 AI；
- 正常阅读、附件预览、来源测试不调用 AI；
- 用户要求“额度耗尽就停”时，一旦遇到真实 Actions/预算/API 额度原始错误，立即停止相应消耗并报告；不得通过重试、充值或降低验证规避。

## 12. 部署与生产验收

- merge 前锁定 final Head；merge 后重新读取真实 `main` merge SHA；
- 部署成功不等于生产验收成功；应检查实际部署 SHA、公开边界、关键 API/页面、必要 artifact 和生产状态；
- D1 migration、Access、Pages 变量、Mac 采用新版分别独立验收；
- 不用 preview 成功替代 production，不用 production 部署成功替代本机 worker 采用；
- 若生产验收仍需要本机浏览器/网络/launchd，才下发最小化 Codex 本机任务。

## 13. GitHub 原生交接与本机证据

有直接相关 Issue/PR 时使用该线程；无合适线程的独立本机运维/采证使用 `HANDOFF.md` 指定的备用交接 Issue。固定标记：

- `[CHATGPT→CODEX][TASK <id>]`
- `[CODEX→CHATGPT][TASK <id>]`
- `[CHATGPT REVIEW][TASK <id>]`

小型文本/日志放 Issue/PR；源码、测试、fixture、文档走 branch + PR；CI/构建证据走 Actions；敏感或不宜上传的本机原件留 Mac，只回传路径、元数据、SHA-256 和必要脱敏摘录。

Codex 指令必须写明为什么必须本机执行、Task ID、目标、允许读写范围、禁止动作、基线/时间、证据、失败停止条件和回传线程。默认禁止 Codex 自行扩大任务、修改生产 D1/调度、清历史状态、输出密钥、合并或部署。

## 14. 状态文件职责

- `AGENTS.md`：稳定、长期、项目级规则唯一真源；
- `PROGRESS.md`：阶段状态、当前治理/产品阶段、已知大边界；不累计每个小 commit；
- `HANDOFF.md`：当前 Issue、branch/worktree、base、candidate、clean/dirty、本地测试、已同步 SHA、当前 PR、下一同步点；
- `docs/AI-COLLABORATION.md`：解释协作流程，不覆盖本文件；
- `docs/mac-subscription-batch.md`：Mac 生产运维细则。

任何新会话不得只凭聊天继续；必须重新读取实际 `main`、本文件和当前 Issue/PR/本地现场。
