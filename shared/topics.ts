import type { SourceID } from "./types"

/**
 * 主题配置。
 * 主题不是新的抓取源，而是从现有热榜源中筛选并聚合相关内容。
 * 后续新增主题时，优先在这里增加配置，而不是复制一套抓取逻辑。
 */
export const healthTopic = {
  id: "health",
  name: "健康管理",
  description: "聚合全网热榜中与运动、体重管理、营养、睡眠和代谢健康相关的内容",
  /** 健康主题单独做更深扫描；普通 NewsNow 页面仍保持原来的 30 条。 */
  sourceLimit: 100,
  /** 跨源去重后送入 GLM 做最终相关性判断的候选上限。关键词命中项优先进入候选。 */
  aiCandidateLimit: 400,
  /** GLM 相关度达到此分数后进入健康管理主题。 */
  aiThreshold: 60,
  /** 直接通过 Cloudflare Workers AI binding 调用，无需第三方 API Key。 */
  aiModel: "@cf/zai-org/glm-4.7-flash",
  aiLabel: "GLM-4.7-Flash",
  /** 深扫描后允许展示更多命中结果。 */
  displayLimit: 80,
  sources: [
    "baidu",
    "weibo",
    "zhihu",
    "toutiao",
    "thepaper",
    "bilibili",
    "hupu",
    "smzdm",
  ] as const satisfies readonly SourceID[],
  keywords: [
    "健康管理",
    "健康",
    "运动",
    "健身",
    "锻炼",
    "减肥",
    "减脂",
    "减重",
    "肥胖",
    "体重",
    "体脂",
    "BMI",
    "跑步",
    "马拉松",
    "步数",
    "力量训练",
    "有氧",
    "无氧",
    "肌肉",
    "增肌",
    "营养",
    "膳食",
    "饮食",
    "蛋白质",
    "热量",
    "卡路里",
    "睡眠",
    "熬夜",
    "血糖",
    "血压",
    "血脂",
    "心率",
    "代谢",
    "控糖",
    "体检",
    "GLP-1",
    "司美格鲁肽",
    "替尔泊肽",
  ],
} as const
