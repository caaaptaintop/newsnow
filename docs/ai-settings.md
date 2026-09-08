# AI 接入与切换

## 改造基线

基于 2026-09-08 的 main `0a34433beaa424f487d6340638a5050466ad83f2`。原 Proma/GLM Messages 实现原样保存在 `server/providers/legacy-ai-provider.ts`，未重新加入实测失败的 adaptive/low 参数。原信息源、主题栏目、D1 v2 元数据存储、仓库快照、采集去重和健宁编辑规则保留；R2 不启用。

这是个人站点的全局配置，不是多租户账单系统。所有主题的后续 AI 请求共用选中的配置。不自动切换到其他提供方；付费 API 和订阅分类请求不自动重试。历史入库文章不因换模型重新处理。健康热点缓存按提供方、模型、配置版本区分；部分失败的结果不写入完整结果缓存。

## 前端使用

右下角打开 **AI 设置**，输入本站管理口令解锁。添加配置，填写名称、模型 ID、接口根地址、协议和密钥。先保留“沿用部署环境配置”，保存备用配置，再读取模型列表或测试连接。测试会真实请求一次模型、消耗该账号额度；模型列表不代表已验证模型权限。JSON 测试成功后，在“当前使用的 AI”中选择并保存。

最多保存 12 个配置。预设包括 ChatGPT/Codex 订阅节点、Grok/OpenCode 订阅节点、OpenAI API、Grok API、Proma、DeepSeek、Anthropic、兼容 API 和 Workers AI。预设是协议模板，不表示账号已经授权。模型 ID 按实际供应商/节点填写；首次保存需先填一个有效模型 ID，随后可读取模型列表调整。本站适配层目前仅处理非流式文字分类，不是通用聊天 API，也未实现持久批量任务队列。

## 一次性启用

Cloudflare Pages `capx-newsnow` → Production 添加：

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `AI_ADMIN_TOKEN` | Secret | 本站 AI 管理口令，独立随机字符串，至少 32 字符 |
| `AI_SETTINGS_ENCRYPTION_KEY` | Secret | 独立随机加密主密钥，至少 32 字符，不得与管理口令相同 |
| `AI_ALLOWED_HOSTS` | 普通变量 | 额外允许的精确接口域名，逗号分隔，不含协议、路径、端口和通配符 |

两个 Secret 可分别用 `openssl rand -hex 32` 在自己的设备生成。不要写入 Git、聊天消息、截图或前端配置文件。首次修改环境变量后重新部署；之后保存/切换配置无需重新部署。保留已有有效 D1 绑定。数据库不可用时设置接口报错，不会冒充已持久保存到浏览器或内存。

未设置加密主密钥时仍走原部署环境配置。设置了主密钥但数据库/选中配置不可用时会报错，不静默回退到其他付费模型。管理口令修改不影响已保存 API 密钥。**加密主密钥须长期保管**：更换后须在面板重新填写各配置密钥；此版本没有自动密钥轮换。

内置许可域名：api.openai.com、api.x.ai、api.proma.cool、api.deepseek.com、api.anthropic.com、open.bigmodel.cn、api.z.ai、generativelanguage.googleapis.com。Gemini 等只有使用兼容协议地址时才适用，并非实现所有厂商原生协议。自建 HTTPS 节点须单独加入 AI_ALLOWED_HOSTS。

## 存储与管理边界

新增 D1 表 `intelligence_ai_settings_v1`。配置名称、模型、根地址、协议等为配置元数据；密钥 AES-GCM 加密，随机 IV，认证绑定到配置 ID、接入类型、地址和认证方式。更换这些字段必须重新输入密钥，防止把旧密钥发到新地址。读取设置只返回 hasKey，不返回明文或密文；revision 校验阻止并发覆盖。

管理接口位于 `/api/intelligence/ai/`，以 x-ai-admin-token 鉴权，写入校验同源并禁止缓存。口令与未保存的 API Key 只保留在面板内存，关闭后清除。模型调用由服务端发起，禁止自动追随重定向和透传上游错误正文；分类请求不能指定任意接口地址。

管理口令只保护配置和探测，不把已有公开资讯站改成私有站。原采集/分类路由访问范围不变；公开部署仍应按规模配置访问控制/限流，防止访客耗用选中的模型额度。

## ChatGPT / Grok 订阅节点

Cloudflare 保存的是**节点网关密钥**，不是订阅登录资料。ChatGPT/Grok OAuth 只留在自己的 Mac/VPS。节点代码 `tools/ai-bridge/server.mjs` 需要 Node.js 22+ 和当前支持相应选项的 Codex/OpenCode CLI。不要在 Cloudflare Workers 中运行 CLI。

### 登录

推荐独立低权限系统账号，至少使用全新的专用 HOME，不指向个人项目或已有插件配置目录。

Codex：

```sh
export AI_BRIDGE_HOME="$HOME/.intelligence-codex-node"
mkdir -p "$AI_BRIDGE_HOME/.codex"
HOME="$AI_BRIDGE_HOME" CODEX_HOME="$AI_BRIDGE_HOME/.codex" \
  codex -c 'cli_auth_credentials_store="file"' login
```

按提示登录 ChatGPT。节点强制 ChatGPT 登录并不继承 OPENAI_API_KEY/CODEX_API_KEY 等环境密钥，不能自动改成 API 计费；登录凭据须使用上述专用目录的文件存储。

Grok：

```sh
export AI_BRIDGE_HOME="$HOME/.intelligence-grok-node"
mkdir -p "$AI_BRIDGE_HOME"
HOME="$AI_BRIDGE_HOME" \
  XDG_CONFIG_HOME="$AI_BRIDGE_HOME/.config" \
  XDG_DATA_HOME="$AI_BRIDGE_HOME/.local/share" \
  XDG_CACHE_HOME="$AI_BRIDGE_HOME/.cache" opencode
```

在 OpenCode 执行 `/connect`，选择 xAI，再选 Grok OAuth 订阅登录或 Headless/Remote/VPS 登录，不选 API Key。节点检查专用目录的 xAI 登录类型为 OAuth，并不继承 XAI_API_KEY。AI_BRIDGE_MODELS 填账号实际提供的裸模型 ID，不含 `xai/` 前缀。

### 启动与连接

```sh
# 保留上一步 AI_BRIDGE_HOME。
export AI_BRIDGE_ENGINE=codex  # Grok 节点改为 grok
export AI_BRIDGE_MODELS='替换为账号实际可用的模型ID'
export AI_BRIDGE_TOKEN="$(openssl rand -hex 32)"
export AI_BRIDGE_PORT=8788
node tools/ai-bridge/server.mjs
```

把 AI_BRIDGE_TOKEN 保存在自己的密码管理器或受限环境文件，并作为面板里的“节点网关密钥”。重启须沿用同一个值，否则需更新网站保存的密钥。不要把 token 放 URL。

节点只监听 127.0.0.1。通过自己的 HTTPS 反向代理或 Cloudflare Tunnel 映射到独立域名，保留 Authorization 头。`https://codex-node.example.com/v1` **只是占位示例，代码不会创建域名或隧道**。实际域名加入 AI_ALLOWED_HOSTS；前端选对应订阅类型、Chat Completions 协议、Bearer 认证。两种订阅各运行一个节点，使用不同端口/域名。

节点默认仅一个并发任务；忙时返回 429，不自动重试。健康分类选择订阅节点时按组串行执行；建筑全来源同时采集仍可能触发忙碌，所以首次从单个来源验证。单次节点执行上限 65 秒，网站配置的请求超时建议设为 75 秒。CLI 不保证严格执行 max_tokens，不能宣称普通 API 的精确 token 上限。

**大批量串行热点可能超过现有健康请求的 90 秒上限。** 此阶段没有持久队列；这类任务宜使用已验证的 API，或在后续队列改造后再验收订阅批量处理。单条测试通过不等于整批订阅分析验收完成。忙碌、超时、额度不足、登录过期均应视作明确错误。

### 权限与保留

Codex 使用非交互、临时会话、只读沙箱，禁用 shell/web/apps/多代理等；OpenCode 使用专用 deny-all 代理和纯净模式。工作目录逐任务创建并清理，不接受请求指定的可执行文件或 shell 命令。节点仅接收许可模型、文本消息和非流式请求；截断、工具调用、错误或未完成事件不计成功，不转发 reasoning 文本。

账号额度和限流照常生效。OpenCode 自身可能在专用 HOME 保存历史；网站 D1 不存正文不等于执行节点或模型供应商零保留，节点历史应按工具自身能力管理。

## 验证与回退

模拟测试无需真实订阅/API Key。部署后先确认设置入口与原 Proma 状态不变，再启用管理密钥。保存备用配置 → JSON 测试 → 单来源真实分类 → 扩大批量并核对耗时、完整批次数与账号用量。

回退时选“沿用部署环境配置”并保存，即回到原 INTELLIGENCE_AI_PROVIDER/PROMA_* 设置，不删除旧文章或改变 D1 v2 数据。

官方依据（核对于 2026-09-08）：
- Codex 非交互：https://developers.openai.com/codex/noninteractive/
- Codex 登录：https://learn.chatgpt.com/docs/auth
- xAI 订阅与 OpenCode：https://x.ai/news/grok-opencode
- OpenCode CLI：https://opencode.ai/docs/cli/
- OpenCode 权限：https://opencode.ai/docs/permissions/
