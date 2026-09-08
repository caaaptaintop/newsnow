import { healthTopic } from "./topics"
import { sources } from "./sources"
import type { IntelligenceSource } from "./intelligence"

/** Official directory seeds. A configured entry is NOT a successful scrape.
 * Seed directory; current reachability and parser verification are recorded in docs/source-verification.md.
 * Columns without an explicit URL are discovered from the institution's own navigation.
 */
const provincial: [string, string, string, string][] = [
  ["beijing", "北京", "北京市住房和城乡建设委员会", "zjw.beijing.gov.cn"],
  ["tianjin", "天津", "天津市住房和城乡建设委员会", "zfcxjs.tj.gov.cn"],
  ["hebei", "河北", "河北省住房和城乡建设厅", "zfcxjst.hebei.gov.cn"],
  ["shanxi", "山西", "山西省住房和城乡建设厅", "zjt.shanxi.gov.cn"],
  ["neimenggu", "内蒙古", "内蒙古自治区住房和城乡建设厅", "zjt.nmg.gov.cn"],
  ["liaoning", "辽宁", "辽宁省住房和城乡建设厅", "zjt.ln.gov.cn"],
  ["jilin", "吉林", "吉林省住房和城乡建设厅", "jst.jl.gov.cn"],
  ["heilongjiang", "黑龙江", "黑龙江省住房和城乡建设厅", "zfcxjst.hlj.gov.cn"],
  ["shanghai", "上海", "上海市住房和城乡建设管理委员会", "zjw.sh.gov.cn"],
  ["jiangsu", "江苏", "江苏省住房和城乡建设厅", "jsszfhcxjst.jiangsu.gov.cn"],
  ["zhejiang", "浙江", "浙江省住房和城乡建设厅", "jst.zj.gov.cn"],
  ["anhui", "安徽", "安徽省住房和城乡建设厅", "dohurd.ah.gov.cn"],
  ["fujian", "福建", "福建省住房和城乡建设厅", "zjt.fujian.gov.cn"],
  ["jiangxi", "江西", "江西省住房和城乡建设厅", "zjt.jiangxi.gov.cn"],
  ["shandong", "山东", "山东省住房和城乡建设厅", "zjt.shandong.gov.cn"],
  ["henan", "河南", "河南省住房和城乡建设厅", "hnjs.henan.gov.cn"],
  ["hubei", "湖北", "湖北省住房和城乡建设厅", "zjt.hubei.gov.cn"],
  ["hunan", "湖南", "湖南省住房和城乡建设厅", "zjt.hunan.gov.cn"],
  ["guangdong", "广东", "广东省住房和城乡建设厅", "zfcxjst.gd.gov.cn"],
  ["guangxi", "广西", "广西壮族自治区住房和城乡建设厅", "zjt.gxzf.gov.cn"],
  ["hainan", "海南", "海南省住房和城乡建设厅", "zjt.hainan.gov.cn"],
  ["chongqing", "重庆", "重庆市住房和城乡建设委员会", "zfcxjw.cq.gov.cn"],
  ["sichuan", "四川", "四川省住房和城乡建设厅", "jst.sc.gov.cn"],
  ["guizhou", "贵州", "贵州省住房和城乡建设厅", "zfcxjst.guizhou.gov.cn"],
  ["yunnan", "云南", "云南省住房和城乡建设厅", "zfcxjst.yn.gov.cn"],
  ["xizang", "西藏", "西藏自治区住房和城乡建设厅", "zjt.xizang.gov.cn"],
  ["shaanxi", "陕西", "陕西省住房和城乡建设厅", "js.shaanxi.gov.cn"],
  ["gansu", "甘肃", "甘肃省住房和城乡建设厅", "zjt.gansu.gov.cn"],
  ["qinghai", "青海", "青海省住房和城乡建设厅", "zjt.qinghai.gov.cn"],
  ["ningxia", "宁夏", "宁夏回族自治区住房和城乡建设厅", "jst.nx.gov.cn"],
  ["xinjiang", "新疆", "新疆维吾尔自治区住房和城乡建设厅", "zjt.xinjiang.gov.cn"],
]
const cities: [string, string, string, string, string][] = [
  ["xiongan", "河北", "雄安新区", "雄安新区建设和交通管理局（官方门户）", "https://www.xiongan.gov.cn/service/jshjtglj.htm"],
  ["baoding", "河北", "保定", "保定市住房和城乡建设局", "https://zjj.baoding.gov.cn/"],
  ["shenyang", "辽宁", "沈阳", "沈阳市城乡建设局", "https://jw.shenyang.gov.cn/"],
  ["harbin", "黑龙江", "哈尔滨", "哈尔滨市住房和城乡建设局（政府信息公开）", "https://www.harbin.gov.cn/haerbin/c107373/bmzfxxgk_zn.shtml"],
  ["nanjing", "江苏", "南京", "南京市城乡建设委员会", "https://sjw.nanjing.gov.cn/"],
  ["suzhou", "江苏", "苏州", "苏州市住房和城乡建设局", "https://zfcjj.suzhou.gov.cn/"],
  ["wenzhou", "浙江", "温州", "温州市住房和城乡建设局", "https://zjj.wenzhou.gov.cn/"],
  ["jiaxing", "浙江", "嘉兴", "嘉兴市住房和城乡建设局", "https://jsj.jiaxing.gov.cn/"],
  ["taizhou", "浙江", "台州", "台州市住房和城乡建设局", "https://jsj.zjtz.gov.cn/"],
  ["hefei", "安徽", "合肥", "合肥市城乡建设局", "https://cxjsj.hefei.gov.cn/"],
  ["xiamen", "福建", "厦门", "厦门市住房和建设局", "https://szjj.xm.gov.cn/"],
  ["qingdao", "山东", "青岛", "青岛市住房和城乡建设局", "https://sjw.qingdao.gov.cn/"],
  ["zhengzhou", "河南", "郑州", "郑州市城乡建设局", "https://zzjsj.zhengzhou.gov.cn/"],
  ["wuhan", "湖北", "武汉", "武汉市自然资源和城乡建设局", "https://zrzyhcxjs.wuhan.gov.cn/"],
  ["wuhan-housing", "湖北", "武汉", "武汉市住房和城市更新局", "https://zgj.wuhan.gov.cn/"],
  ["changsha", "湖南", "长沙", "长沙市住房和城乡建设局", "https://szjw.changsha.gov.cn/"],
  ["guangzhou", "广东", "广州", "广州市住房和城乡建设局", "https://zfcj.gz.gov.cn/"],
  ["shenzhen", "广东", "深圳", "深圳市住房和建设局", "https://zjj.sz.gov.cn/"],
  ["foshan", "广东", "佛山", "佛山市住房和城乡建设局", "https://fszj.foshan.gov.cn/"],
  ["chengdu", "四川", "成都", "成都市住房和城乡建设局", "https://cdzj.chengdu.gov.cn/"],
  ["xian", "陕西", "西安", "西安市住房和城乡建设局", "https://zjj.xa.gov.cn/"],
  ["urumqi", "新疆", "乌鲁木齐", "乌鲁木齐市住房和城乡建设局（官方门户）", "https://www.wlmq.gov.cn/wlmqs/c119234/bm_com_list.shtml"],
]
const explicitColumns: Record<string, { name: string, url: string }[]> = {
  liaoning: [
    { name: "规范性文件", url: "https://zjt.ln.gov.cn/zjt/tfwj/gfxwj/index.shtml" },
    { name: "厅发通知", url: "https://zjt.ln.gov.cn/zjt/tftz/index.shtml" },
    { name: "公示公告", url: "https://zjt.ln.gov.cn/zjt/gsgg/index.shtml" },
    { name: "政策解读", url: "https://zjt.ln.gov.cn/zjt/zcjd/index.shtml" },
  ],
  shanghai: [{ name: "主动公开文件", url: "https://zjw.sh.gov.cn/zdgk/" }],
  jiangsu: [{ name: "政府信息公开", url: "https://jsszfhcxjst.jiangsu.gov.cn/module/xxgk/subjectinfo.jsp?area=014000052" }],
  shenzhen: [{ name: "通知公告", url: "https://zjj.sz.gov.cn/xxgk/tzgg/" }],
  foshan: [{ name: "通知公告", url: "https://fszj.foshan.gov.cn/zwgk/txgg/" }],
  xiongan: [{ name: "住建领域公开", url: "https://www.xiongan.gov.cn/zwgk/zfxxgk/fdgknr/zdlyxxgk/zfhcxjs.html" }],
  urumqi: [{ name: "部门公开", url: "https://www.wlmq.gov.cn/wlmqs/c119234/bm_com_list.shtml" }],
}
export const officialIntelligenceSources: IntelligenceSource[] = [
  { id: "official-mohurd", name: "住房和城乡建设部", home: "https://www.mohurd.gov.cn/", group: "住建官方", level: "国家", region: "全国", city: "", priority: 100, topic: "building", enabled: true },
  ...provincial.map(([id, region, name, host]) => ({
    id: `official-${id}`, name, home: `https://${host}/`, group: "住建官方", level: "省级", region,
    city: ["北京", "天津", "上海", "重庆"].includes(region) ? region : "", priority: id === "shanghai" ? 105 : id === "jiangsu" ? 103 : 90,
    topic: "building" as const, enabled: true, columns: explicitColumns[id],
  })),
  ...cities.map(([id, region, city, name, home]) => ({
    id: `official-${id}`, name, home, group: "住建官方", level: "市级", region, city,
    priority: id === "shenzhen" ? 104 : 85, topic: "building" as const, enabled: true, columns: explicitColumns[id],
  })),
]

export const mediaIntelligenceSources: IntelligenceSource[] = [
  ["ai", "ithome", "IT之家", "https://www.ithome.com/"],
  ["ai", "aihot", "AIHOT", "https://aihot.virxact.com/all"],
  ["ai", "hackernews", "Hacker News", "https://news.ycombinator.com/"],
  ["ai", "github-trending-today", "GitHub Trending", "https://github.com/trending"],
  ["finance", "wallstreetcn-hot", "华尔街见闻", "https://wallstreetcn.com/"],
  ["finance", "cls-hot", "财联社", "https://www.cls.cn/"],
].map(([topic, id, name, home]) => ({
  id: `newsnow-${topic}-${id}`, newsnowId: id, name, home, group: "NewsNow", level: "媒体", region: "", city: "",
  priority: 50, topic: topic as "ai" | "finance", enabled: true,
}))
export const healthIntelligenceSources: IntelligenceSource[] = (healthTopic.sources as readonly string[]).flatMap((id) => {
  const source = (sources as Record<string, { name: string, home?: string }>)[id]
  return source ? [{ id: `newsnow-health-${id}`, newsnowId: id, name: source.name, home: source.home ?? "", group: "NewsNow", level: "平台", region: "", city: "", priority: 50, topic: "health" as const, enabled: true }] : []
})
export const intelligenceSources = [...officialIntelligenceSources, ...mediaIntelligenceSources, ...healthIntelligenceSources]
