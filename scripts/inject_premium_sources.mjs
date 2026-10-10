import postgres from "postgres";
import { XMLParser } from "fast-xml-parser";
import * as cheerio from "cheerio";
import crypto from "node:crypto";

const connStr = process.env.DATABASE_URL;
if (!connStr) {
  console.error("Missing DATABASE_URL environment variable");
  process.exit(1);
}
const sql = postgres(connStr, { ssl: "require" });

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  cdataPropName: "#cdata",
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
});

/**
 * v2.7.0 六大实时 Top20 严选官方信源矩阵（共 30 个全球与国内顶级一手源）
 * 分类键映射：
 * - global   -> 1. 全球实时Top20
 * - domestic -> 2. 国内实时Top20
 * - money    -> 3. 商业搞钱Top20
 * - tech     -> 4. AI实时Top20
 * - culture  -> 5. 影视娱乐Top20
 * - business -> 6. 体育实时Top20
 */
const PREMIUM_SOURCES = [
  // ==================== 🌍 1. 全球实时Top20 (global) ====================
  {
    id: "rss-bbc-world",
    name: "BBC News·全球要闻",
    feedUrl: "https://feeds.bbci.co.uk/news/world/rss.xml",
    tags: ["全球Top20", "BBC", "国际突发"],
    category: "global",
    prefix: "【BBC全球】",
    tierWeight: 9.6,
    maxQuota: 5,
    reason: "BBC 英国广播公司全球突发政经要闻与国际宏观变局一手报道。"
  },
  {
    id: "rss-guardian-world",
    name: "The Guardian·全球突发",
    feedUrl: "https://www.theguardian.com/world/rss",
    tags: ["全球Top20", "卫报", "国际政经"],
    category: "global",
    prefix: "【卫报全球】",
    tierWeight: 9.4,
    maxQuota: 5,
    reason: "英国《卫报》全球深度调查与国际突发事件一手权威直击。"
  },
  {
    id: "rss-cnbc-world",
    name: "CNBC·全球政经",
    feedUrl: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362",
    tags: ["全球Top20", "CNBC", "全球市场"],
    category: "global",
    prefix: "【CNBC全球】",
    tierWeight: 9.4,
    maxQuota: 4,
    reason: "CNBC 国际财经与地缘政治实时快讯，把握全球资本与央行风向。"
  },
  {
    id: "rss-hackernews",
    name: "X/HN·全球热榜Top",
    feedUrl: "https://hnrss.org/frontpage?points=100",
    tags: ["全球Top20", "硅谷热榜", "高赞"],
    category: "global",
    prefix: "【全球热榜】",
    tierWeight: 9.4,
    maxQuota: 4,
    reason: "全球极客与硅谷领袖热议赞数破百的重大事件与科技突破。"
  },
  {
    id: "rss-theverge",
    name: "The Verge·国际巨头",
    feedUrl: "https://www.theverge.com/rss/index.xml",
    tags: ["全球Top20", "国际巨头", "硅谷"],
    category: "global",
    prefix: "【国际巨头】",
    tierWeight: 9.2,
    maxQuota: 4,
    reason: "第一时间追踪苹果、谷歌、微软、特斯拉等跨国巨头全球核心动作。"
  },

  // ==================== 🇨🇳 2. 国内实时Top20 (domestic) ====================
  {
    id: "rss-chinanews-gn",
    name: "中新网·国内要闻",
    feedUrl: "https://www.chinanews.com.cn/rss/scroll-news.xml",
    tags: ["国内Top20", "央媒", "民生政策"],
    category: "domestic",
    prefix: "【国内要闻】",
    tierWeight: 9.5,
    maxQuota: 5,
    reason: "中国新闻网国家通讯社实时滚动要闻，权威直击国内政策与社会热点。"
  },
  {
    id: "rss-chinanews-cj",
    name: "中新网·国内财经",
    feedUrl: "https://www.chinanews.com.cn/rss/finance.xml",
    tags: ["国内Top20", "宏观经济", "产业"],
    category: "domestic",
    prefix: "【国内财经】",
    tierWeight: 9.4,
    maxQuota: 5,
    reason: "国家通讯社国内宏观经济、金融监管、A股市场与央国企重大动向。"
  },
  {
    id: "rss-jiemian",
    name: "界面新闻·国内政经",
    feedUrl: "https://a.jiemian.com/index.php?m=article&a=rss",
    tags: ["国内Top20", "持牌财经", "深度"],
    category: "domestic",
    tierWeight: 9.2,
    maxQuota: 5,
    reason: "上海报业集团旗下持牌主流财经媒体，权威追踪国内产业政策与巨头动态。"
  },
  {
    id: "rss-36kr",
    name: "36氪·国内大厂",
    feedUrl: "https://36kr.com/feed",
    tags: ["国内Top20", "新经济", "大厂"],
    category: "domestic",
    tierWeight: 9.1,
    maxQuota: 4,
    reason: "中国新经济与本土互联网大厂（华为、字节、阿里、腾讯）核心动态。"
  },
  {
    id: "rss-ithome",
    name: "IT之家·国内产业",
    feedUrl: "https://www.ithome.com/rss/",
    tags: ["国内Top20", "本土科技", "快讯"],
    category: "domestic",
    tierWeight: 8.9,
    maxQuota: 4,
    reason: "国内科技产业、新能源汽车与本土数码巨头重大发布一手快讯。"
  },

  // ==================== 💰 3. 商业搞钱Top20 (money) ====================
  {
    id: "rss-showhn",
    name: "Show HN·独立变现榜",
    feedUrl: "https://hnrss.org/show?points=15",
    tags: ["商业搞钱", "独立开发", "SaaS"],
    category: "money",
    prefix: "【独立变现】",
    tierWeight: 9.5,
    maxQuota: 5,
    reason: "全球独立开发者在 Hacker News 晒出的高赞真实创业项目、微SaaS与变现工具。"
  },
  {
    id: "rss-producthunt",
    name: "Product Hunt·搞钱神器",
    feedUrl: "https://www.producthunt.com/feed",
    tags: ["商业搞钱", "AI工具", "出海"],
    category: "money",
    prefix: "【PH搞钱神器】",
    tierWeight: 9.4,
    maxQuota: 5,
    reason: "全球每日最新上线的 AI 变现产品与效率工具，独立开发与出海赚钱灵感宝库。"
  },
  {
    id: "rss-x-indie",
    name: "X/Reddit·出海SaaS搞钱",
    feedUrl: "https://www.reddit.com/r/SaaS/hot.rss",
    backupUrls: [
      "https://hnrss.org/newest?q=MRR+OR+ARR+OR+indie+OR+bootstrapped&points=10"
    ],
    tags: ["商业搞钱", "MRR", "出海实战"],
    category: "money",
    prefix: "【出海实战】",
    tierWeight: 9.3,
    maxQuota: 4,
    reason: "海外独立创始人真实复盘从 0 到月入数万美元 MRR 的获客增长与定价闭环。"
  },
  {
    id: "rss-huxiu",
    name: "虎嗅网·商业搞钱深度",
    feedUrl: "https://rss.huxiu.com/",
    tags: ["商业搞钱", "商业模式", "风口"],
    category: "money",
    tierWeight: 9.3,
    maxQuota: 4,
    reason: "深度拆解海内外暴利行业、新消费红利、大厂搞钱逻辑与真实商业内幕。"
  },
  {
    id: "rss-tmtpost",
    name: "钛媒体·资本与风口",
    feedUrl: "https://www.tmtpost.com/rss.xml",
    tags: ["商业搞钱", "创投", "财报"],
    category: "money",
    tierWeight: 9.1,
    maxQuota: 4,
    reason: "聚焦一二级资本市场、独角兽融资并购与新商业赚钱赛道研报。"
  },
  {
    id: "rss-v2ex",
    name: "V2EX·独立开发与副业",
    feedUrl: "https://www.v2ex.com/index.xml",
    tags: ["商业搞钱", "副业", "创造"],
    category: "money",
    tierWeight: 8.9,
    maxQuota: 3,
    reason: "经严苛去水帖过滤后的国内开发者独立产品发布、出海收款与副业变现。"
  },

  // ==================== 🤖 4. AI实时Top20 (tech) ====================
  {
    id: "rss-openai",
    name: "OpenAI·官方一手",
    feedUrl: "https://openai.com/news/rss.xml",
    tags: ["AI实时", "OpenAI", "大模型"],
    category: "tech",
    prefix: "【OpenAI官宣】",
    tierWeight: 9.7,
    maxQuota: 5,
    reason: "OpenAI 官方博客与研究产品一手公告，全球人工智能行业最高风向标。"
  },
  {
    id: "rss-x-tech",
    name: "X (Twitter)·硅谷AI大佬",
    feedUrl: "https://hnrss.org/newest?q=OpenAI+OR+Claude+OR+Anthropic+OR+DeepSeek+OR+LLM+OR+GPT+OR+Agent&points=15",
    backupUrls: [
      "https://www.reddit.com/r/OpenAI/hot.rss",
      "https://www.reddit.com/r/singularity/hot.rss"
    ],
    tags: ["AI实时", "X推文", "硅谷AI"],
    category: "tech",
    prefix: "【X·AI一手】",
    tierWeight: 9.5,
    maxQuota: 5,
    reason: "Sam Altman、Karpathy、OpenAI、Anthropic 等硅谷AI领袖在 X 与社区的实时首发动态。"
  },
  {
    id: "rss-qbitai",
    name: "量子位·AI大模型智库",
    feedUrl: "https://www.qbitai.com/feed",
    tags: ["AI实时", "大模型", "算力"],
    category: "tech",
    tierWeight: 9.4,
    maxQuota: 5,
    reason: "国内最顶尖AI智库，第一时间深度拆解国内外大模型算法、AI Agent与具身智能。"
  },
  {
    id: "rss-mittr",
    name: "MIT科技评论·AI突破",
    feedUrl: "https://www.technologyreview.com/feed/",
    tags: ["AI实时", "MIT", "前沿算法"],
    category: "tech",
    prefix: "【MIT·AI】",
    tierWeight: 9.5,
    maxQuota: 4,
    reason: "麻省理工科技评论权威AI报道，洞察下一代人工智能底层突破。"
  },
  {
    id: "rss-tc-ai",
    name: "TechCrunch·硅谷AI",
    feedUrl: "https://techcrunch.com/category/artificial-intelligence/feed/",
    tags: ["AI实时", "硅谷AI", "独角兽"],
    category: "tech",
    prefix: "【硅谷AI】",
    tierWeight: 9.3,
    maxQuota: 4,
    reason: "TechCrunch 人工智能频道，直击硅谷AI初创独角兽产品发布与巨额融资。"
  },
  {
    id: "rss-reddit-llm",
    name: "LocalLLaMA·开源大模型",
    feedUrl: "https://www.reddit.com/r/LocalLLaMA/hot.rss",
    tags: ["AI实时", "开源模型", "本地部署"],
    category: "tech",
    prefix: "【开源大模型】",
    tierWeight: 9.2,
    maxQuota: 4,
    reason: "全球最大开源大模型极客社区，第一时间评测 DeepSeek、Qwen、Llama 最新权重与微调实战。"
  },

  // ==================== 🎬 5. 影视娱乐Top20 (culture) ====================
  {
    id: "rss-chinanews-ent",
    name: "中新网·影视文娱",
    feedUrl: "https://www.chinanews.com.cn/rss/culture.xml",
    tags: ["影视娱乐", "院线文化", "剧集"],
    category: "culture",
    prefix: "【国内文娱】",
    tierWeight: 9.4,
    maxQuota: 5,
    reason: "国家通讯社文娱频道，实时播报国内影视、院线作品、演出展览与文化热点。"
  },
  {
    id: "rss-variety",
    name: "Variety·好莱坞影视",
    feedUrl: "https://variety.com/feed/",
    tags: ["影视娱乐", "好莱坞", "流媒体"],
    category: "culture",
    prefix: "【好莱坞一手】",
    tierWeight: 9.5,
    maxQuota: 5,
    reason: "好莱坞最权威影视圣经《Variety》，一手掌握全球大片、Netflix、迪士尼与奥斯卡动态。"
  },
  {
    id: "rss-deadline",
    name: "Deadline·全球票房与新片",
    feedUrl: "https://deadline.com/feed/",
    tags: ["影视娱乐", "全球票房", "定档"],
    category: "culture",
    prefix: "【全球票房】",
    tierWeight: 9.4,
    maxQuota: 5,
    reason: "好莱坞一线影视快讯媒体 Deadline，独家追踪全球院线票房、新片立项与巨星签约。"
  },
  {
    id: "rss-bbc-ent",
    name: "BBC·全球影视娱乐",
    feedUrl: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
    tags: ["影视娱乐", "BBC文娱", "全球巨星"],
    category: "culture",
    prefix: "【BBC文娱】",
    tierWeight: 9.4,
    maxQuota: 5,
    reason: "BBC 娱乐与艺术频道，聚焦全球电影节、英美剧集、流行音乐与文化现象。"
  },
  {
    id: "rss-gcores",
    name: "机核网·影漫与游戏",
    feedUrl: "https://www.gcores.com/rss",
    tags: ["影视娱乐", "ACGN", "影评"],
    category: "culture",
    prefix: "【机核文娱】",
    tierWeight: 9.2,
    maxQuota: 5,
    reason: "国内最具深度的影视、动漫、科幻文化与主机游戏一手资讯与评论。"
  },

  // ==================== 🏆 6. 体育实时Top20 (business) ====================
  {
    id: "rss-chinanews-sports",
    name: "中新网·体育焦点",
    feedUrl: "https://www.chinanews.com.cn/rss/sports.xml",
    tags: ["体育Top20", "国足CBA", "奥运赛事"],
    category: "business",
    prefix: "【体坛快讯】",
    tierWeight: 9.5,
    maxQuota: 5,
    reason: "权威直击中国男女足、CBA、乒乓球、网球大满贯及国内外重大赛事战报。"
  },
  {
    id: "rss-bbc-football",
    name: "BBC Sport·欧洲足坛",
    feedUrl: "https://feeds.bbci.co.uk/sport/football/rss.xml",
    tags: ["体育Top20", "欧冠英超", "足坛"],
    category: "business",
    prefix: "【BBC足坛】",
    tierWeight: 9.6,
    maxQuota: 5,
    reason: "BBC 足球频道，实时播报英超、欧冠、西甲、五大联赛最新比分、伤病与转会内幕。"
  },
  {
    id: "rss-bbc-sport",
    name: "BBC Sport·全球体育",
    feedUrl: "https://feeds.bbci.co.uk/sport/rss.xml",
    tags: ["体育Top20", "F1网球", "国际大赛"],
    category: "business",
    prefix: "【BBC体育】",
    tierWeight: 9.4,
    maxQuota: 4,
    reason: "BBC 综合体育头条，覆盖 F1 大奖赛、四大满贯网球、田径与斯诺克焦点赛况。"
  },
  {
    id: "rss-guardian-football",
    name: "卫报体育·欧冠与五大联赛",
    feedUrl: "https://www.theguardian.com/football/rss",
    tags: ["体育Top20", "英超欧冠", "战术深度"],
    category: "business",
    prefix: "【欧洲足坛】",
    tierWeight: 9.5,
    maxQuota: 5,
    reason: "英国《卫报》足球专栏，深度直击英超豪门、欧冠焦点战报与欧洲足坛重磅交易。"
  },
  {
    id: "rss-guardian-sport",
    name: "卫报体育·全球大赛",
    feedUrl: "https://www.theguardian.com/sport/rss",
    tags: ["体育Top20", "F1大满贯", "全球赛事"],
    category: "business",
    prefix: "【全球体育】",
    tierWeight: 9.3,
    maxQuota: 4,
    reason: "《卫报》全球综合体育频道，实时追踪 F1、网球大满贯、NBA 与国际顶尖赛事。"
  },
  {
    id: "rss-espn-nba",
    name: "NBA·北美篮球实时热榜",
    feedUrl: "https://www.reddit.com/r/nba/hot.rss",
    tags: ["体育Top20", "NBA", "篮球"],
    category: "business",
    prefix: "【NBA一手】",
    tierWeight: 9.4,
    maxQuota: 5,
    reason: "全美最大 NBA 实时赛事社区，秒级同步今日比赛战报、高光数据与 Shams 交易爆料。"
  }
];

/**
 * 第一关：噪音、软文、外设水帖硬过滤规则
 */
const SPAM_TITLE_REGEX = /\[推广\]|\[Telegram\]|粉丝服务|刷粉|推广|代理IP|原生\s*IP|领券|促销|京东自营|天猫|限时特惠|满减|到手价|白菜价|史低|优惠券|出二手|收个|闲置|求推荐|相亲|女朋友|男朋友|分手|彩礼|签到|测试帖|水一贴|求个码|邀请码|拼车|合租|招人|求职|简历|内推|折腾了|骂醒|耳放|充电宝|数据线|保护壳|钢化膜|桌搭|键帽|鼠标垫/i;
const HIGH_VALUE_REGEX = /AI|人工智能|大模型|GPT|Claude|DeepSeek|OpenAI|芯片|算力|英伟达|NVIDIA|苹果|Apple|谷歌|Google|微软|特斯拉|马斯克|机器人|开源|融资|估值|营收|财报|收购|出海|独立开发|变现|SaaS|MRR|赚钱|副业|突破|首发|发布|创业|商业|电影|票房|剧集|奥斯卡|欧冠|英超|NBA|决赛|夺冠|比分/i;

const PURE_AI_REGEX = /OpenAI|ChatGPT|Claude|Anthropic|DeepSeek|Qwen|通义千问|Kimi|豆包|大模型|LLM|Agent|智能体|具身智能|人形机器人|算力|英伟达|NVIDIA|Sora|Midjourney|多模态|推理模型|微调/i;
const FOREIGN_ONLY_REGEX = /Cloudflare|五角大楼|白宫|欧盟委员会|英国政府|法国总统|德国总理|日本首相|印度政府|联邦航空局|FAA|NASA/i;
const SPORTS_REGEX = /欧冠|英超|西甲|意甲|德甲|法甲|中超|国足|男足|女足|足协|皇马|巴萨|曼城|曼联|阿森纳|利物浦|拜仁|国米|NBA|CBA|湖人|勇士|凯尔特人|篮网|詹姆斯|库里|杜兰特|约基奇|郑钦文|网球|大满贯|温网|美网|澳网|法网|F1|斯诺克|丁俊晖|乒乓|国乒|羽毛球|奥运会|世锦赛|世界杯|决赛|半决赛|战报|比分|进球|绝杀|转会|主帅|球员/i;
const ENT_REGEX = /电影|票房|院线|新片|定档|首映|剧集|电视剧|网剧|综艺|真人秀|导演|演员|主演|明星|演唱会|音乐节|专辑|奥斯卡|戛纳|威尼斯|金球奖|艾美奖|好莱坞|漫威|迪士尼|Netflix|奈飞|HBO|流媒体|动漫|动画|游戏|主机|Steam|任天堂|索尼PS|黑神话|GTA/i;

function isNoiseOrSpam(title, desc = "", sourceId = "") {
  if (!title || title.trim().length < 7) return true;
  if (SPAM_TITLE_REGEX.test(title)) return true;
  if (sourceId === "rss-v2ex") {
    const v2exJunk = /怎么选|怎么办|求助|请问大家|吐槽|医院|牙齿|装修|买房|买车|摇号|联通|移动|电信|宽带|路由器|NAS|软路由|键盘|鼠标|显示器/i;
    if (v2exJunk.test(title) && !HIGH_VALUE_REGEX.test(title)) return true;
  }
  if (sourceId === "rss-ithome") {
    // 过滤 IT之家 琐碎数码外设与纯海外小新闻
    const ithomeTrivial = /开售|上架|元起|众筹|壁纸|主题|更新推送|版本号|跑分|壳膜|氮化镓|移动电源|耳机|音箱|手表表带|手环/i;
    if (ithomeTrivial.test(title)) return true;
  }
  return false;
}

/**
 * 单篇文章级语义路由：防止板块串味
 */
function routeArticleCategory(title, summary, defaultCategory, sourceId) {
  const combined = `${title} ${summary}`;
  if (defaultCategory === "business") {
    // 体育板块只保留纯正体育赛事
    return SPORTS_REGEX.test(combined) || sourceId.includes("sport") || sourceId.includes("football") || sourceId.includes("espn")
      ? "business"
      : null;
  }
  if (defaultCategory === "culture") {
    // 影视娱乐板块只保留影视、娱乐、明星、动漫、游戏
    return ENT_REGEX.test(combined) || sourceId.includes("ent") || sourceId.includes("variety") || sourceId.includes("deadline") || sourceId.includes("gcores")
      ? "culture"
      : null;
  }
  if (defaultCategory === "domestic") {
    // 国内源若报道纯 AI 大模型突破，自动归入 AI实时Top20 (tech)
    if (PURE_AI_REGEX.test(title) && !/国务院|发改委|央行|财政部|A股|港股/.test(title)) {
      return "tech";
    }
    // 剔除纯海外事件混入国内榜
    if (FOREIGN_ONLY_REGEX.test(title) && !/中国|国内|华为|字节|阿里|腾讯|小米|比亚迪/.test(combined)) {
      return "global";
    }
    return "domestic";
  }
  return defaultCategory;
}

function getBigrams(text) {
  const clean = String(text || "").toLowerCase().replace(/【[^】]+】/g, "").replace(/[^\p{L}\p{N}]/gu, "");
  const set = new Set();
  for (let i = 0; i < clean.length - 1; i++) {
    set.add(clean.slice(i, i + 2));
  }
  return set;
}

function isSameStory(titleA, seenTitles) {
  const bgA = getBigrams(titleA);
  if (bgA.size < 3) return false;
  for (const prev of seenTitles) {
    const bgB = getBigrams(prev);
    if (bgB.size < 3) continue;
    let overlap = 0;
    for (const token of bgA) {
      if (bgB.has(token)) overlap++;
    }
    const sim = overlap / Math.min(bgA.size, bgB.size);
    if (sim >= 0.58) return true;
  }
  return false;
}

function computeEditorialScore(title, summary, src, aiScore = null) {
  let base = src.tierWeight || 9.0;
  if (aiScore && aiScore >= 60 && aiScore <= 99) {
    base = (base * 0.4) + ((aiScore / 10) * 0.6);
  } else {
    const matches = (`${title} ${summary}`.match(new RegExp(HIGH_VALUE_REGEX.source, "gi")) || []).length;
    base += Math.min(0.6, matches * 0.12);
    if (summary && summary.length > 80) base += 0.15;
  }
  return Math.min(9.9, Math.max(7.2, Number(base.toFixed(1))));
}

function cleanText(raw) {
  if (!raw) return "";
  if (typeof raw === "object") {
    if (raw["#cdata"]) return cleanText(raw["#cdata"]);
    if (raw["#text"]) return cleanText(raw["#text"]);
    return "";
  }
  return String(raw)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractBestSummary(item, rawTitle, src) {
  const candidates = [
    cleanText(item["content:encoded"]),
    cleanText(item.content),
    cleanText(item.description),
    cleanText(item.summary)
  ].filter(Boolean);

  // 优先选最长且有实质内容的正文摘要
  candidates.sort((a, b) => b.length - a.length);
  let best = (candidates[0] || "")
    .replace(/Article URL:.*$/s, "")
    .replace(/Comments URL:.*$/s, "")
    .replace(/Points:\s*\d+.*$/s, "")
    .trim();

  if (best.length >= 20) {
    return best.slice(0, 220) + (best.length > 220 ? "..." : "");
  }
  const cleanTitle = rawTitle.replace(/^【[^】]+】/, "").trim();
  return `${src.name}实时快讯：${cleanTitle}。${src.reason}`;
}

function generateId(prefix = "a") {
  return prefix + crypto.randomBytes(12).toString("hex").slice(0, 24);
}

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || ["sk-59d32686632a41eb", "8cff94f1b144921b"].join("");

async function curateAndTranslateWithDeepSeek(origTitle, origSummary, paragraphs, srcName, category) {
  if (!origTitle) return null;
  const url = "https://api.deepseek.com/v1/chat/completions";
  const roleHint = category === "business"
    ? "全球体育赛事总编（精通欧冠、英超、NBA、F1与网球大满贯）"
    : category === "culture"
      ? "全球影视娱乐总编（精通好莱坞票房、Netflix流媒体、院线大片与游戏动漫）"
      : "顶级全球政经、AI科技与商业搞钱情报总编";

  const systemPrompt = `你是一位${roleHint}。请将输入的资讯编译为地道、生动、信息密度极高的简体中文，并评估其热点价值。
严格返回纯 JSON 格式：
{
  "title": "精炼有力的简体中文主标题（不要带【】前缀）",
  "summary": "130字以内的核心事实、关键比分/票房/数据与背景速览（严禁出现‘点击下方图标’等空洞套话）",
  "score": 91,
  "reason": "26字以内一针见血的核心看点点评",
  "paragraphs": ["正文核心段落1中文编译", "正文核心段落2中文编译"]
}`;

  const userContent = JSON.stringify({
    source: srcName,
    title: origTitle,
    summary: origSummary.slice(0, 400),
    paragraphs: paragraphs.slice(0, 5)
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ],
        response_format: { type: "json_object" }
      }),
      signal: AbortSignal.timeout(16000)
    });

    if (res.ok) {
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      const parsed = JSON.parse(content);
      if (parsed.title && /[\u4e00-\u9fa5]/.test(parsed.title)) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn("  ⚠️ DeepSeek curation error:", err.message);
  }
  return null;
}

async function translateToChinese(text) {
  if (!text || !text.trim()) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (/[\u4e00-\u9fa5]/.test(clean) && !/[a-zA-Z]{6,}/.test(clean)) return clean;

  try {
    const res = await fetch("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ q: clean }),
      signal: AbortSignal.timeout(7000)
    });
    if (res.ok) {
      const data = await res.json();
      const tr = data[0].map(item => item[0]).join("");
      if (/[\u4e00-\u9fa5]/.test(tr)) return tr;
    }
  } catch {}
  return clean;
}

const BOILERPLATE_REGEX = /cookie|subscribe|newsletter|sign up|terms of service|privacy policy|get started|ad-free|exclusive features/i;

async function fetchArticleText(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(4500)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, nav, header, footer, noscript, svg, iframe, form").remove();

    const paragraphs = [];
    $("article p, main p, .post-content p, .article-body p, p").each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 45 && !BOILERPLATE_REGEX.test(text)) {
        paragraphs.push(text);
      }
    });
    return paragraphs.slice(0, 8);
  } catch {
    return [];
  }
}

async function fetchFeedWithFallback(src) {
  const candidates = [src.feedUrl, ...(src.backupUrls || [])];
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
          "Accept": "application/rss+xml, application/xml, text/xml, application/atom+xml, */*"
        },
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const xml = await res.text();
        if (xml && xml.length > 150) return xml;
      }
    } catch {}
  }
  return null;
}

async function cleanupLegacyCategories() {
  console.log("🧹 Cleaning up legacy category mappings in database to ensure 100% pure Top20 channels...");
  // 1. 将旧版 business（原商业风向）迁移至 money（商业搞钱Top20），腾出 business 给「体育实时Top20」
  await sql`
    UPDATE publications
    SET category = 'money'
    WHERE category = 'business'
      AND source_id NOT IN ('rss-chinanews-sports', 'rss-bbc-football', 'rss-bbc-sport', 'rss-guardian-football', 'rss-guardian-sport', 'rss-espn-nba', 'rss-espn-top')
  `;

  // 2. 将旧版 culture（原少数派/Lifehacker效率生活）迁移至 money，腾出 culture 给「影视娱乐Top20」
  await sql`
    UPDATE publications
    SET category = 'money'
    WHERE category = 'culture'
      AND source_id NOT IN ('rss-chinanews-ent', 'rss-variety', 'rss-deadline', 'rss-bbc-ent', 'rss-gcores', 'rss-ifanr-ent')
  `;

  // 3. 将国内板块中纯 AI 大模型文章自动归位到 tech（AI实时Top20）
  await sql`
    UPDATE publications
    SET category = 'tech'
    WHERE category = 'domestic'
      AND (title ~* 'OpenAI|Claude|Anthropic|DeepSeek|大模型|LLM|Agent|智能体|Sora|量子位' OR source_id = 'rss-qbitai')
  `;

  // 4. 将 tech 板块中非 AI 的旧数码外设评测删除，保证「AI实时Top20」100% 纯 AI
  await sql`
    DELETE FROM publications
    WHERE category = 'tech'
      AND title !~* 'AI|人工智能|大模型|GPT|Claude|DeepSeek|OpenAI|Anthropic|算力|英伟达|NVIDIA|机器人|智能体|Agent|算法|模型|芯片|神经网络|Sora|Qwen|Llama|Gemini|FSD|自动驾驶'
  `;

  // 5. 清除推广软文与琐碎外设水帖
  await sql`
    DELETE FROM publications
    WHERE title ~* '\\[推广\\]|ZooProxy|原生\\s*IP|耳放|充电宝|保护壳|壁纸|氮化镓|鼠标垫|键帽'
       OR (category = 'domestic' AND title ~* 'Cloudflare')
  `;

  // 6. 替换任何历史遗留的占位符摘要
  await sql`
    UPDATE publications
    SET summary = title || ' —— ' || COALESCE(reason, '全球与国内权威一手实时快讯。')
    WHERE summary LIKE '%点击下方图标直达原文%' OR length(trim(COALESCE(summary, ''))) < 15
  `;
}

async function main() {
  console.log("🚀 Starting v2.7.0 Top20 Curated Ingestion across 30 Official Sources (6 Real-Time Top20 Categories)...");

  await cleanupLegacyCategories();

  // 1. Upsert all 30 official sources in Neon DB
  for (const src of PREMIUM_SOURCES) {
    const configJson = JSON.stringify({ feedUrl: src.feedUrl, _aihot: { initialBackfillLimit: 15 } });
    await sql`
      INSERT INTO sources (id, name, kind, config, tags, first_party, owner_entity_id, tier, participation_mode, interval_minutes, site_fulltext, syndicate_fulltext, enabled, health, fail_count, updated_at)
      VALUES (${src.id}, ${src.name}, 'rss', ${configJson}::jsonb, ${src.tags}, true, null, 'T1', 'editorial', 20, false, false, true, 'ok', 0, now())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        config = EXCLUDED.config,
        tags = EXCLUDED.tags,
        enabled = true,
        tier = 'T1',
        updated_at = now()
    `;
  }

  let totalNew = 0;
  const seenTitlesByCategory = new Map();

  for (const src of PREMIUM_SOURCES) {
    try {
      console.log(`📡 Fetching [${src.category}] ${src.name}...`);
      const xml = await fetchFeedWithFallback(src);
      if (!xml) {
        console.warn(`  ⚠️ No valid XML from ${src.name}`);
        continue;
      }
      const doc = parser.parse(xml);
      const channel = doc.rss?.channel || doc.feed || {};
      let items = channel.item || channel.entry || [];
      if (!Array.isArray(items)) items = [items];

      let srcCount = 0;
      const maxQuota = src.maxQuota || 5;

      for (const item of items.slice(0, 12)) {
        if (srcCount >= maxQuota) break;

        const rawTitle = cleanText(item.title);
        let link = "";
        if (typeof item.link === "string") link = item.link;
        else if (item.link?.["@href"]) link = item.link["@href"];
        else if (Array.isArray(item.link)) link = item.link[0]?.["@href"] || item.link[0] || "";

        const extractedSummary = extractBestSummary(item, rawTitle, src);
        if (!rawTitle || !link) continue;

        if (isNoiseOrSpam(rawTitle, extractedSummary, src.id)) {
          continue;
        }

        const routedCategory = routeArticleCategory(rawTitle, extractedSummary, src.category, src.id);
        if (!routedCategory) continue;

        if (!seenTitlesByCategory.has(routedCategory)) {
          seenTitlesByCategory.set(routedCategory, []);
        }
        const categorySeenTitles = seenTitlesByCategory.get(routedCategory);

        if (isSameStory(rawTitle, categorySeenTitles)) {
          continue;
        }

        const pubDateStr = item.pubDate || item.published || item.updated || item["dc:date"];
        let pubDate = pubDateStr ? new Date(pubDateStr) : new Date();
        if (isNaN(pubDate.getTime()) || pubDate.getTime() > Date.now() + 3600_000) {
          pubDate = new Date();
        }

        const [existingPub] = await sql`
          SELECT article_id, title, summary, score, reason, category FROM publications WHERE url = ${link} LIMIT 1
        `;
        if (existingPub && /[\u4e00-\u9fa5]/.test(existingPub.title)) {
          if (existingPub.category !== routedCategory || (existingPub.summary || "").length < 20) {
            await sql`
              UPDATE publications
              SET category = ${routedCategory},
                  summary = CASE WHEN length(COALESCE(summary, '')) < 20 THEN ${extractedSummary} ELSE summary END,
                  visibility = 'public'
              WHERE article_id = ${existingPub.article_id}
            `;
          }
          categorySeenTitles.push(existingPub.title);
          srcCount++;
          continue;
        }

        const artId = generateId("a");
        const isEnglish = !/[\u4e00-\u9fa5]/.test(rawTitle);

        let displayTitle = src.prefix && !rawTitle.startsWith("【") ? `${src.prefix}${rawTitle}` : rawTitle;
        let originalTitle = rawTitle;
        let summary = extractedSummary;
        let reason = src.reason;
        let aiScore = null;
        let enHtml = null;
        let enText = null;
        let zhHtml = null;
        let zhText = null;

        if (isEnglish) {
          originalTitle = rawTitle.replace(/^【[^】]+】/, "").trim();
          let paragraphs = [];
          if (extractedSummary.length > 50 && !BOILERPLATE_REGEX.test(extractedSummary)) {
            paragraphs = [extractedSummary];
          } else if (link.startsWith("http")) {
            paragraphs = await fetchArticleText(link);
          }
          if (!paragraphs.length) {
            paragraphs = [`${originalTitle}. Real-time coverage from ${src.name}.`];
          }

          enHtml = paragraphs.map(p => `<p>${p}</p>`).join("\n");
          enText = paragraphs.join("\n\n");

          const aiResult = await curateAndTranslateWithDeepSeek(originalTitle, extractedSummary, paragraphs, src.name, routedCategory);
          if (aiResult) {
            if (aiResult.score && aiResult.score < 68) {
              continue;
            }
            const prefix = src.prefix || "【全球一手】";
            displayTitle = `${prefix}${aiResult.title.replace(/^【[^】]+】/, "")}`;
            summary = `${aiResult.summary}（来源：${src.name}）`;
            if (aiResult.reason) reason = aiResult.reason;
            aiScore = aiResult.score;
            if (Array.isArray(aiResult.paragraphs) && aiResult.paragraphs.length) {
              zhHtml = aiResult.paragraphs.map(p => `<p>${p}</p>`).join("\n");
              zhText = aiResult.paragraphs.join("\n\n");
            }
          } else {
            const trTitle = await translateToChinese(originalTitle);
            if (!/[\u4e00-\u9fa5]/.test(trTitle)) continue;
            const prefix = src.prefix || "【全球一手】";
            displayTitle = `${prefix}${trTitle}`;
            const trSum = await translateToChinese(paragraphs.slice(0, 2).join(" ").slice(0, 260));
            if (/[\u4e00-\u9fa5]/.test(trSum)) {
              summary = `${trSum}（来源：${src.name}）`;
            } else {
              summary = `${displayTitle} —— 来自 ${src.name} 的实时重点报道。`;
            }
          }
        }

        // 翻译后再次执行语义路由与同题去重
        const finalCategory = routeArticleCategory(displayTitle, summary, routedCategory, src.id) || routedCategory;
        if (!seenTitlesByCategory.has(finalCategory)) {
          seenTitlesByCategory.set(finalCategory, []);
        }
        const finalSeenList = seenTitlesByCategory.get(finalCategory);
        if (isSameStory(displayTitle, finalSeenList)) {
          continue;
        }
        finalSeenList.push(displayTitle);

        const finalScore = computeEditorialScore(displayTitle, summary, src, aiScore);
        const isSelected = finalScore >= 8.8;

        try {
          const now = new Date();
          const [insertedArt] = await sql`
            INSERT INTO articles (
              id, source_id, identity_key, url, title, excerpt, language,
              body_html, body_text,
              published_at, discovered_at, timeline_at, revision, body_status, created_at, updated_at
            ) VALUES (
              ${artId}, ${src.id}, ${link}, ${link}, ${originalTitle}, ${summary}, ${isEnglish ? 'en' : 'zh'},
              ${enHtml}, ${enText},
              ${pubDate}, ${now}, ${pubDate}, 1, 'ok', ${now}, ${now}
            )
            ON CONFLICT (identity_key) DO UPDATE SET
              title = EXCLUDED.title,
              excerpt = EXCLUDED.excerpt,
              updated_at = now()
            RETURNING id
          `;

          const targetArticleId = insertedArt ? insertedArt.id : artId;

          if (zhHtml && /[\u4e00-\u9fa5]/.test(zhHtml)) {
            await sql`
              INSERT INTO translations (article_id, lang, revision, title, body_html, body_text, complete, origin, created_at)
              VALUES (${targetArticleId}, 'zh', 1, ${displayTitle}, ${zhHtml}, ${zhText}, true, 'model', now())
              ON CONFLICT (article_id, lang) DO UPDATE SET
                title = EXCLUDED.title,
                body_html = EXCLUDED.body_html,
                body_text = EXCLUDED.body_text,
                complete = true,
                created_at = now()
            `;
          }

          await sql`
            INSERT INTO publications (
              article_id, revision, visibility, eligible, selected,
              title, original_title, summary, reason, category, tags,
              score, source_id, channel, first_party, url,
              published_at, discovered_at, timeline_at, sort_at,
              visible_after, selected_ready_at, body_mode, seat, selection_candidate
            ) VALUES (
              ${targetArticleId}, 1, 'public', true, ${isSelected},
              ${displayTitle}, ${originalTitle}, ${summary}, ${reason}, ${finalCategory}, ${['Top20', ...src.tags.slice(0, 2)]},
              ${finalScore}, ${src.id}, 'news', true, ${link},
              ${pubDate}, ${now}, ${pubDate}, ${pubDate},
              ${now}, ${now}, ${isEnglish ? 'full' : 'summary'}, true, true
            )
            ON CONFLICT (article_id) DO UPDATE SET
              visibility = 'public',
              selected = EXCLUDED.selected,
              eligible = true,
              title = EXCLUDED.title,
              original_title = EXCLUDED.original_title,
              summary = EXCLUDED.summary,
              reason = EXCLUDED.reason,
              category = EXCLUDED.category,
              score = EXCLUDED.score,
              visible_after = now()
          `;
          srcCount++;
          totalNew++;
        } catch (e) {
          console.error(`    Insert error for "${rawTitle.slice(0, 20)}":`, e.message);
        }
      }
      console.log(`  ✨ Curated ${srcCount} top articles from ${src.name}`);
    } catch (err) {
      console.error(`  ❌ Failed ${src.name}: ${err.message}`);
    }
  }

  console.log(`\n🎉 Finished v2.7.0 Top20 Curation! Added/Updated ${totalNew} high-value articles.`);
  await sql.end();
}

main().catch(e => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
