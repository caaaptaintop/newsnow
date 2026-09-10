# 信息源管理中心

内部入口：`/internal/sources`。页面按主题组织：左侧选择主题，右侧显示该主题的来源健康表；展开来源可查看具体栏目，编辑页支持发现候选栏目、测试、保存草稿、发布配置和从历史版本恢复为草稿。

## 配置模型

代码中的 `shared/official-sources.ts` 仅作为初始目录和无覆盖时的种子。D1 中的已发布配置覆盖种子；发布配置后无需修改代码或重新部署。Mac worker 每轮读取公开的只读配置快照，并保存元数据缓存；读取失败时只使用上次成功缓存，不把管理草稿用于生产。

没有明确栏目配置的历史来源继续以 `legacy-discovery` 迁移状态运行，并在管理中心标为“待配置”。一旦发布明确栏目，该来源改为 `explicit`：只采集已启用的栏目，不再从官网首页猜栏目，也不在栏目无结果时回退抓首页。

## Cloudflare Access

该功能不是访客管理后台。生产必须在 Cloudflare Access 中同时保护：

- `/internal/sources*`
- `/api/internal/source-admin*`

Pages/Worker 环境变量：

- `SOURCE_ADMIN_ACCESS_TEAM_DOMAIN`：Access 团队域名，例如 `example.cloudflareaccess.com`；
- `SOURCE_ADMIN_ACCESS_AUD`：Access 应用 Audience；
- `SOURCE_ADMIN_ALLOWED_EMAILS`：可选，逗号分隔的额外邮箱白名单。

服务端会验证 `Cf-Access-Jwt-Assertion` 的签名、issuer 和 audience。缺少配置时管理 API 以 404 关闭；不以访客登录、前端口令或可伪造的邮箱请求头代替 Access JWT。

## 安全与数据边界

- 只接受 HTTP/HTTPS 标准端口的公开域名；拒绝 localhost、IP 地址和跨主机栏目，避免管理测试成为通用代理。
- 在线测试低并发，仅返回文章标题、日期和附件链接等元数据；不保存页面 HTML、正文或附件字节。
- 发布采用配置总版本和来源版本双重守卫；冲突时刷新后重试。
- 历史版本只可恢复为草稿，仍需重新测试和发布。
- 信息源配置版本与文章内容 revision 分开，不通过修改配置伪造文章更新。
