import type { SourceID } from "./types"

/**
 * 健宁热点选题的 8 条固定选题线。
 * 这些选题线来自历史文章表现分析，AI 必须完整保留，不以单一健康分类替代。
 */
export const healthTopicLines = {
  public_event: "公众人物 / 热点事件健康转化",
  treatment_decision: "减重药 / 治疗决策",
  symptom_signal: "身体异常 / 症状判别",
  myth_correction: "反常识 / 健康误区",
  stress_body: "生活压力 × 身体结果",
  case_result: "真实案例 / 结果型",
  guideline_policy: "指南 / 研究 / 政策 → 个人决策",
  viral_lifestyle: "爆火食品 / 生活方式 → 怎么吃、怎么做",
} as const

export type HealthTopicLine = keyof typeof healthTopicLines

/**
 * “为什么现在值得写”的热点触发标签。
 * 公众人物是高权重横向触发维度，可以与任意一条选题线组合。
 */
export const healthTopicTriggers = {
  public_figure: "公众人物",
  social_event: "社会事件",
  research_guideline: "新研究 / 指南",
  drug_product: "新药 / 新产品",
  viral_lifestyle: "爆火食品 / 生活方式",
  seasonal: "节气 / 时令",
  online_debate: "网络争议 / 误区",
  sports_event: "体育热点",
  tech_event: "科技热点",
} as const

export type HealthTopicTrigger = keyof typeof healthTopicTriggers

/**
 * 主题配置。
 * 路由仍沿用 health，前端定位已经从“健康新闻筛选”升级为“健宁热点选题雷达”。
 */
export const healthTopic = {
  id: "health",
  navName: "热点选题",
  name: "健宁热点选题",
  description: "从全网热点中发现能自然转化为“好看健宁练”公众号内容的选题机会",
  /** 每个平台只取前 30 条；与普通 NewsNow 页面共用默认缓存，减少抓取与等待时间。 */
  sourceLimit: 30,
  /** 每个来源前 30 条全部作为高位热点候选。 */
  perSourceHotLimit: 30,
  /** 8 个来源理论最多 240 条，跨源去重后通常更少。 */
  aiCandidateLimit: 240,
  /** Gemma 4 采用小批并行处理，避免单次长输出拖慢并降低串题概率。 */
  aiChunkSize: 10,
  /** 单轮最多让模型返回的候选选题数量。 */
  aiResultLimit: 30,
  /** Cloudflare-hosted Gemma 4 MoE；无需第三方 API Key。 */
  aiModel: "@cf/google/gemma-4-26b-a4b-it",
  aiLabel: "Gemma 4 26B A4B",
  /** 页面最多展示的候选选题数量。 */
  displayLimit: 30,
  /**
   * 只引用 shared/sources.json 中实际存在且 Cloudflare 可用的热榜源。
   * 原 smzdm 在当前来源注册表中不存在，改用贴吧热议补足第 8 个社会热点来源。
   */
  sources: [
    "baidu",
    "weibo",
    "zhihu",
    "toutiao",
    "thepaper",
    "bilibili",
    "hupu",
    "tieba",
  ] as const satisfies readonly SourceID[],
  /**
   * 保留为后续候选优先级扩展使用；当前每源只取前 30 条，因此不会额外扫描长尾。
   * 关键词永远不作为最终筛选条件。
   */
  seedKeywords: [
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
    "腰围",
    "BMI",
    "跑步",
    "马拉松",
    "力量训练",
    "肌肉",
    "营养",
    "膳食",
    "饮食",
    "蛋白质",
    "睡眠",
    "失眠",
    "打呼噜",
    "呼吸暂停",
    "皮质醇",
    "血糖",
    "血压",
    "血脂",
    "心率",
    "代谢",
    "胰岛素抵抗",
    "脂肪肝",
    "体检",
    "抗衰",
    "二甲双胍",
    "GLP-1",
    "司美格鲁肽",
    "替尔泊肽",
    "减肥针",
    "原研药",
    "集采",
    "妊娠",
    "生育",
    "代孕",
  ],
} as const
