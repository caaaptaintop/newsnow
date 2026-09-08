# 信息源核验与修复记录

核验日期：2026-09-08（Mac 实际读取与 Luna 低推理分类）。

## 结论

- building：54 个来源；21 完成，22 部分完成，11 失败。
- ai：4 个来源；0 完成，4 部分完成，0 失败。
- finance：2 个来源；1 完成，1 部分完成，0 失败。
- health：8 个来源；0 完成，8 部分完成，0 失败。

“完成”仅指本轮公开列表及新增候选处理完成，不代表该机构历史文章、所有栏目或全文已经全部收集。“部分完成”明确保留栏目解析缺口或待分析数量；失败来源保持失败，不填充演示内容。

## 已确认的根因与修复

- `mac-worker.mjs` 原来只列出 4 个来源；现在遍历全部 68 个来源，单源失败继续其他来源。
- `merge-batch.ts` / `apply-batch.ts` 原来只追加文章、不发布检查状态；现在即使没有新文章也更新真实来源状态。
- `use-health.ts` 原来在打开页面时调用旧服务；情报工作区在 Mac 模式下四个主题统一读取后台快照，保留健宁原有八条选题线与事实桥梁。
- `intelligence-parser.ts` 漏掉郑州 `.jhtml` 文章，并误排除辽宁长数字目录下的 `index.shtml` 文章。两种模板均已添加回归测试。
- 温州、嘉兴、台州、厦门原域名无法解析；核对官方目录和页面身份后修正，并实际复采。
- Hacker News 网页抓取返回 403；改用[官方公开 API](https://github.com/HackerNews/API)，实际取回 30 条排行新闻，保留原讨论页链接。

## 地址核验依据

- [温州市住房和城乡建设局](https://zjj.wenzhou.gov.cn/)
- [嘉兴市住房和城乡建设局](https://jsj.jiaxing.gov.cn/)
- [浙江省建设厅目录](https://jst.zj.gov.cn/)链接指向[台州市住建局](https://jsj.zjtz.gov.cn/)。
- [厦门市住房和建设局政务公开](https://szjj.xm.gov.cn/zwgk/)，与[福建省政府公布的年度网站报表](https://www.fujian.gov.cn/zwgk/ztzl/qszfwzndbb/2024/sxq/sms/szzfwz/202501/P020250122809033221456.pdf)一致。

## 逐源结果

| 主题 | 来源 | 结果 | 候选数 | 本轮接受 | 未完成原因 |
|---|---|---|---:|---:|---|
| building | [住房和城乡建设部](https://www.mohurd.gov.cn/) | 部分完成 | 60 | 11 | 建设要闻：栏目未解析到文章；专门栏目尚未完整适配，本轮仅读取首页公开文章 |
| building | [北京市住房和城乡建设委员会](https://zjw.beijing.gov.cn/) | 失败 | 0 | 0 | 政策文件：栏目未解析到文章 |
| building | [天津市住房和城乡建设委员会](https://zfcxjs.tj.gov.cn/) | 完成 | 34 | 2 | — |
| building | [河北省住房和城乡建设厅](https://zfcxjst.hebei.gov.cn/) | 部分完成 | 1 | 0 | 建设要闻：官网返回 HTTP 412；政策解读：官网返回 HTTP 412；政策文件：官网返回 HTTP 412；公告公示：官网返回 HTTP 412；专门栏目尚未完整适配，本轮仅读取首页公开文章 |
| building | [山西省住房和城乡建设厅](https://zjt.shanxi.gov.cn/) | 部分完成 | 55 | 4 | 公示公告：栏目未解析到文章 |
| building | [内蒙古自治区住房和城乡建设厅](https://zjt.nmg.gov.cn/) | 部分完成 | 15 | 0 | 政策解读：栏目未解析到文章 |
| building | [辽宁省住房和城乡建设厅](https://zjt.ln.gov.cn/) | 完成 | 43 | 3 | — |
| building | [吉林省住房和城乡建设厅](https://jst.jl.gov.cn/) | 完成 | 13 | 0 | — |
| building | [黑龙江省住房和城乡建设厅](https://zfcxjst.hlj.gov.cn/) | 完成 | 58 | 0 | — |
| building | [上海市住房和城乡建设管理委员会](https://zjw.sh.gov.cn/) | 完成 | 10 | 0 | — |
| building | [江苏省住房和城乡建设厅](https://jsszfhcxjst.jiangsu.gov.cn/) | 完成 | 20 | 0 | — |
| building | [浙江省住房和城乡建设厅](https://jst.zj.gov.cn/) | 部分完成 | 41 | 6 | 公告公示：栏目未解析到文章；专门栏目尚未完整适配，本轮仅读取首页公开文章 |
| building | [安徽省住房和城乡建设厅](https://dohurd.ah.gov.cn/) | 部分完成 | 16 | 0 | 政策文件：栏目未解析到文章；政策解读：栏目未解析到文章 |
| building | [福建省住房和城乡建设厅](https://zjt.fujian.gov.cn/) | 部分完成 | 195 | 12 | 7 条候选待后续批次分析 |
| building | [江西省住房和城乡建设厅](https://zjt.jiangxi.gov.cn/) | 失败 | 0 | 0 | 官网安全连接失败（ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED），未降低证书或加密校验 |
| building | [山东省住房和城乡建设厅](https://zjt.shandong.gov.cn/) | 失败 | 0 | 0 | 官网安全连接失败（ERR_TLS_CERT_ALTNAME_INVALID），未降低证书或加密校验 |
| building | [河南省住房和城乡建设厅](https://hnjs.henan.gov.cn/) | 完成 | 44 | 6 | — |
| building | [湖北省住房和城乡建设厅](https://zjt.hubei.gov.cn/) | 完成 | 14 | 0 | — |
| building | [湖南省住房和城乡建设厅](https://zjt.hunan.gov.cn/) | 失败 | 0 | 0 | 官网安全连接失败（ERR_SSL_BAD_ECPOINT），未降低证书或加密校验 |
| building | [广东省住房和城乡建设厅](https://zfcxjst.gd.gov.cn/) | 完成 | 39 | 1 | — |
| building | [广西壮族自治区住房和城乡建设厅](https://zjt.gxzf.gov.cn/) | 失败 | 0 | 0 | 官网安全连接失败（ERR_SSL_TLSV1_UNRECOGNIZED_NAME），未降低证书或加密校验 |
| building | [海南省住房和城乡建设厅](https://zjt.hainan.gov.cn/) | 部分完成 | 15 | 4 | 行业动态：栏目未解析到文章；通知公告：栏目未解析到文章 |
| building | [重庆市住房和城乡建设委员会](https://zfcxjw.cq.gov.cn/) | 部分完成 | 31 | 1 | 政策文件：栏目未解析到文章 |
| building | [四川省住房和城乡建设厅](https://jst.sc.gov.cn/) | 部分完成 | 60 | 6 | 专门栏目尚未完整适配，本轮仅读取首页公开文章 |
| building | [贵州省住房和城乡建设厅](https://zfcxjst.guizhou.gov.cn/) | 部分完成 | 30 | 4 | 公告公示：栏目未解析到文章；政策文件：栏目未解析到文章 |
| building | [云南省住房和城乡建设厅](https://zfcxjst.yn.gov.cn/) | 部分完成 | 40 | 2 | 政策文件：栏目未解析到文章 |
| building | [西藏自治区住房和城乡建设厅](https://zjt.xizang.gov.cn/) | 完成 | 58 | 0 | — |
| building | [陕西省住房和城乡建设厅](https://js.shaanxi.gov.cn/) | 完成 | 19 | 2 | — |
| building | [甘肃省住房和城乡建设厅](https://zjt.gansu.gov.cn/) | 失败 | 0 | 0 | 官网返回 HTTP 412 |
| building | [青海省住房和城乡建设厅](https://zjt.qinghai.gov.cn/) | 失败 | 0 | 0 | 官网返回 HTTP 412 |
| building | [宁夏回族自治区住房和城乡建设厅](https://jst.nx.gov.cn/) | 完成 | 30 | 0 | — |
| building | [新疆维吾尔自治区住房和城乡建设厅](https://zjt.xinjiang.gov.cn/) | 部分完成 | 23 | 1 | 政策解读：栏目未解析到文章 |
| building | [雄安新区建设和交通管理局（官方门户）](https://www.xiongan.gov.cn/service/jshjtglj.htm) | 完成 | 18 | 0 | — |
| building | [保定市住房和城乡建设局](https://zjj.baoding.gov.cn/) | 失败 | 0 | 0 | 未解析到文章，需要专用栏目适配 |
| building | [沈阳市城乡建设局](https://jw.shenyang.gov.cn/) | 完成 | 30 | 0 | — |
| building | [哈尔滨市住房和城乡建设局（政府信息公开）](https://www.harbin.gov.cn/haerbin/c107373/bmzfxxgk_zn.shtml) | 部分完成 | 3 | 0 | 专门栏目尚未完整适配，本轮仅读取首页公开文章 |
| building | [南京市城乡建设委员会](https://sjw.nanjing.gov.cn/) | 部分完成 | 37 | 6 | 部门文件：栏目未解析到文章；部门文件：栏目未解析到文章；政策解读：栏目未解析到文章；专门栏目尚未完整适配，本轮仅读取首页公开文章 |
| building | [苏州市住房和城乡建设局](https://zfcjj.suzhou.gov.cn/) | 完成 | 29 | 0 | — |
| building | [温州市住房和城乡建设局](https://zjj.wenzhou.gov.cn/) | 部分完成 | 36 | 2 | 政策文件：栏目未解析到文章；政策解读：栏目未解析到文章；通知公告：栏目未解析到文章；专门栏目尚未完整适配，本轮仅读取首页公开文章 |
| building | [嘉兴市住房和城乡建设局](https://jsj.jiaxing.gov.cn/) | 部分完成 | 53 | 5 | 公告公示：栏目未解析到文章；专门栏目尚未完整适配，本轮仅读取首页公开文章 |
| building | [台州市住房和城乡建设局](https://jsj.zjtz.gov.cn/) | 部分完成 | 52 | 0 | 通知公告：栏目未解析到文章；专门栏目尚未完整适配，本轮仅读取首页公开文章 |
| building | [合肥市城乡建设局](https://cxjsj.hefei.gov.cn/) | 失败 | 0 | 0 | 官网返回 HTTP 521 |
| building | [厦门市住房和建设局](https://szjj.xm.gov.cn/) | 部分完成 | 37 | 8 | 工作动态：栏目未解析到文章；专门栏目尚未完整适配，本轮仅读取首页公开文章 |
| building | [青岛市住房和城乡建设局](https://sjw.qingdao.gov.cn/) | 完成 | 28 | 1 | — |
| building | [郑州市城乡建设局](https://zzjsj.zhengzhou.gov.cn/) | 完成 | 30 | 6 | — |
| building | [武汉市自然资源和城乡建设局](https://zrzyhcxjs.wuhan.gov.cn/) | 部分完成 | 18 | 8 | 公示公告：官网返回 HTTP 404；公示公告：栏目未解析到文章 |
| building | [武汉市住房和城市更新局](https://zgj.wuhan.gov.cn/) | 部分完成 | 52 | 1 | 3 条候选待后续批次分析 |
| building | [长沙市住房和城乡建设局](https://szjw.changsha.gov.cn/) | 失败 | 0 | 0 | 官网安全连接失败（ERR_TLS_CERT_ALTNAME_INVALID），未降低证书或加密校验 |
| building | [广州市住房和城乡建设局](https://zfcj.gz.gov.cn/) | 部分完成 | 60 | 6 | 部门文件：栏目未解析到文章；规范性文件：栏目未解析到文章；政策解读：栏目未解析到文章；工作动态：栏目未解析到文章；专门栏目尚未完整适配，本轮仅读取首页公开文章 |
| building | [深圳市住房和建设局](https://zjj.sz.gov.cn/) | 完成 | 20 | 0 | — |
| building | [佛山市住房和城乡建设局](https://fszj.foshan.gov.cn/) | 完成 | 19 | 6 | — |
| building | [成都市住房和城乡建设局](https://cdzj.chengdu.gov.cn/) | 失败 | 0 | 0 | 官网返回 HTTP 412 |
| building | [西安市住房和城乡建设局](https://zjj.xa.gov.cn/) | 完成 | 68 | 4 | — |
| building | [乌鲁木齐市住房和城乡建设局（官方门户）](https://www.wlmq.gov.cn/wlmqs/c119234/bm_com_list.shtml) | 完成 | 54 | 0 | — |
| ai | [IT之家](https://www.ithome.com/) | 部分完成 | 30 | 2 | 11 条候选待后续批次分析 |
| ai | [AIHOT](https://aihot.virxact.com/all) | 部分完成 | 30 | 9 | 7 条候选待后续批次分析 |
| ai | [Hacker News](https://news.ycombinator.com/) | 部分完成 | 30 | 2 | 18 条候选待后续批次分析 |
| ai | [GitHub Trending](https://github.com/trending) | 部分完成 | 16 | 4 | 3 条候选待后续批次分析 |
| finance | [华尔街见闻](https://wallstreetcn.com/) | 部分完成 | 10 | 0 | Incomplete classifications; no results saved |
| finance | [财联社](https://www.cls.cn/) | 完成 | 13 | 9 | — |
| health | [百度热搜](https://www.baidu.com) | 部分完成 | 30 | 2 | 18 条候选待后续批次分析 |
| health | [微博](https://weibo.com) | 部分完成 | 30 | 1 | 18 条候选待后续批次分析 |
| health | [知乎](https://www.zhihu.com) | 部分完成 | 20 | 1 | 8 条候选待后续批次分析 |
| health | [今日头条](https://www.toutiao.com) | 部分完成 | 30 | 3 | 18 条候选待后续批次分析 |
| health | [澎湃新闻](https://www.thepaper.cn) | 部分完成 | 20 | 2 | 8 条候选待后续批次分析 |
| health | [哔哩哔哩](https://www.bilibili.com) | 部分完成 | 30 | 0 | 18 条候选待后续批次分析 |
| health | [虎扑](https://hupu.com) | 部分完成 | 20 | 1 | 8 条候选待后续批次分析 |
| health | [百度贴吧](https://tieba.baidu.com) | 部分完成 | 30 | 1 | 18 条候选待后续批次分析 |

## 验证边界

已执行全部启用来源的网络/解析检查、真实模型分类、相关回归测试及生产构建。所有文章保存来源链接和证据等级；本文核验的是来源身份及采集通路，未逐条核查报道事实或完整附件。

浏览器访问被自动安全审核拒绝，原因是管理员策略无法核验。本轮使用接口和构建验收，未宣称完成浏览器视觉验收。
