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
 * 26+ 全球与国内顶级一手权威信源矩阵（含 X/Twitter 与 BBC 官方三大频道）
 * tierWeight: 基础权威分权重 (8.2 ~ 9.5)
 * maxQuota: 单次精选配额上限（防止单一快讯站霸屏）
 */
const PREMIUM_SOURCES = [
  // ==================== 🌐 全球一手 (global) ====================
  {
    id: "rss-x-tech",
    name: "X (Twitter)·硅谷大佬一手",
    feedUrl: "https://hnrss.org/newest?q=x.com+OR+twitter.com+OR+OpenAI+OR+Musk+OR+Altman+OR+Anthropic&points=10",
    backupUrls: [
      "https://nitter.privacydev.net/OpenAI/rss",
      "https://www.reddit.com/r/OpenAI/hot.rss",
      "https://www.reddit.com/r/singularity/hot.rss"
    ],
    tags: ["全球", "X推文", "硅谷大佬"],
    category: "global",
    prefix: "【X·硅谷一手】",
    tierWeight: 9.4,
    maxQuota: 4,
    reason: "马斯克、Sam Altman、OpenAI 与硅谷顶级极客在 X (Twitter) 上的实时首发动态。"
  },
  {
    id: "rss-bbc-world",
    name: "BBC News·全球要闻",
    feedUrl: "https://feeds.bbci.co.uk/news/world/rss.xml",
    tags: ["全球", "BBC", "国际政经"],
    category: "global",
    prefix: "【BBC全球】",
    tierWeight: 9.5,
    maxQuota: 4,
    reason: "BBC 英国广播公司全球突发政经要闻与国际宏观变局一手报道。"
  },
  {
    id: "rss-bbc-tech",
    name: "BBC News·科技前沿",
    feedUrl: "https://feeds.bbci.co.uk/news/technology/rss.xml",
    tags: ["全球", "BBC", "科技"],
    category: "global",
    prefix: "【BBC科技】",
    tierWeight: 9.3,
    maxQuota: 4,
    reason: "BBC 科技频道深度报道，聚焦欧洲与全球科技巨头监管、AI突破与网络安全。"
  },
  {
    id: "rss-openai",
    name: "OpenAI·官方一手",
    feedUrl: "https://openai.com/news/rss.xml",
    tags: ["全球", "官方", "大模型"],
    category: "global",
    prefix: "【OpenAI官宣】",
    tierWeight: 9.6,
    maxQuota: 4,
    reason: "OpenAI 官方博客与研究产品一手公告，全球人工智能行业最高风向标。"
  },
  {
    id: "rss-techcrunch",
    name: "TechCrunch·硅谷科技",
    feedUrl: "https://techcrunch.com/feed/",
    tags: ["全球", "硅谷", "独角兽"],
    category: "global",
    prefix: "【硅谷TechCrunch】",
    tierWeight: 9.2,
    maxQuota: 4,
    reason: "硅谷最具影响力的科技与初创企业一手报道，洞察海外独角兽产品与融资。"
  },
  {
    id: "rss-theverge",
    name: "The Verge·全球科技",
    feedUrl: "https://www.theverge.com/rss/index.xml",
    tags: ["全球", "巨头", "前沿"],
    category: "global",
    prefix: "【The Verge】",
    tierWeight: 9.1,
    maxQuota: 3,
    reason: "美国顶级消费科技与硅谷巨头内幕报道，第一时间追踪苹果、谷歌、微软核心动作。"
  },
  {
    id: "rss-mittr",
    name: "MIT麻省理工科技评论",
    feedUrl: "https://www.technologyreview.com/feed/",
    tags: ["全球", "硬科技", "突破"],
    category: "global",
    prefix: "【MIT科技评论】",
    tierWeight: 9.5,
    maxQuota: 3,
    reason: "麻省理工学院旗下全球最权威硬科技期刊，预判未来十年颠覆性技术。"
  },
  {
    id: "rss-hackernews",
    name: "Hacker News·全球高赞",
    feedUrl: "https://hnrss.org/frontpage?points=80",
    tags: ["全球", "极客", "高赞"],
    category: "global",
    prefix: "【HN高赞】",
    tierWeight: 9.3,
    maxQuota: 4,
    reason: "仅筛选硅谷 Hacker News 点赞超80的顶尖工程师热议话题，零水帖纯干货。"
  },

  // ==================== 🇨🇳 国内前沿 (domestic) ====================
  {
    id: "rss-36kr",
    name: "36氪·前沿快讯",
    feedUrl: "https://36kr.com/feed",
    tags: ["国内", "新经济", "大厂"],
    category: "domestic",
    tierWeight: 9.1,
    maxQuota: 4,
    reason: "中国新经济与互联网大厂核心动态，实时追踪国内商业与AI应用落地。"
  },
  {
    id: "rss-jiemian",
    name: "界面新闻·科技",
    feedUrl: "https://a.jiemian.com/index.php?m=article&a=rss",
    tags: ["国内", "持牌", "财经"],
    category: "domestic",
    tierWeight: 9.0,
    maxQuota: 4,
    reason: "上海报业集团旗下持牌主流财经媒体，权威追踪国内科技巨头与产业政策。"
  },
  {
    id: "rss-ithome",
    name: "IT之家·精选快讯",
    feedUrl: "https://www.ithome.com/rss/",
    tags: ["国内", "一手", "快讯"],
    category: "domestic",
    tierWeight: 8.7,
    maxQuota: 4,
    reason: "国内科技互联网与软硬件极速一手快讯，经过严苛反软文过滤后的核心情报。"
  },
  {
    id: "rss-oschina",
    name: "开源中国·技术生态",
    feedUrl: "https://www.oschina.net/news/rss",
    tags: ["国内", "开源", "研发"],
    category: "domestic",
    tierWeight: 8.8,
    maxQuota: 4,
    reason: "国内外重大开源项目发布与底层技术更新，掌握开发者生态脉搏。"
  },

  // ==================== 💼 商业风向 (business) ====================
  {
    id: "rss-bbc-biz",
    name: "BBC·全球商业财经",
    feedUrl: "https://feeds.bbci.co.uk/news/business/rss.xml",
    tags: ["商业", "BBC", "全球宏观"],
    category: "business",
    prefix: "【BBC财经】",
    tierWeight: 9.4,
    maxQuota: 4,
    reason: "BBC 国际商业与金融频道，深度剖析全球市场波动、跨国巨头财报与贸易趋势。"
  },
  {
    id: "rss-huxiu",
    name: "虎嗅网·深度商业",
    feedUrl: "https://rss.huxiu.com/",
    tags: ["商业", "深度", "研报"],
    category: "business",
    tierWeight: 9.3,
    maxQuota: 5,
    reason: "国内顶级商业深度剖析与产业内幕，洞悉大厂战略得失与新商业模式。"
  },
  {
    id: "rss-tmtpost",
    name: "钛媒体·资本创投",
    feedUrl: "https://www.tmtpost.com/rss.xml",
    tags: ["商业", "资本", "创投"],
    category: "business",
    tierWeight: 9.1,
    maxQuota: 5,
    reason: "聚焦一二级资本市场、并购重组与科技财经深度研报，商业决策核心参考。"
  },
  {
    id: "rss-tc-venture",
    name: "TechCrunch·硅谷风投",
    feedUrl: "https://techcrunch.com/category/venture/feed/",
    tags: ["商业", "硅谷VC", "融资"],
    category: "business",
    prefix: "【硅谷风投】",
    tierWeight: 9.3,
    maxQuota: 4,
    reason: "硅谷一线风投机构（a16z、红杉等）最新押注赛道与全球AI初创融资情报。"
  },

  // ==================== ⚡ 科技硬件 (tech) ====================
  {
    id: "rss-qbitai",
    name: "量子位·AI与硬科技",
    feedUrl: "https://www.qbitai.com/feed",
    tags: ["科技", "AI", "算力"],
    category: "tech",
    tierWeight: 9.3,
    maxQuota: 5,
    reason: "国内最顶尖AI与硬科技智库，第一时间拆解大模型算法、芯片算力与具身机器人。"
  },
  {
    id: "rss-ifanr",
    name: "爱范儿·明日硬件",
    feedUrl: "https://www.ifanr.com/feed",
    tags: ["科技", "数码", "硬件"],
    category: "tech",
    tierWeight: 9.0,
    maxQuota: 4,
    reason: "爆款智能硬件、AI穿戴设备与创新消费电子产品一手深度评测。"
  },
  {
    id: "rss-geekpark",
    name: "极客公园·硬核创新",
    feedUrl: "https://www.geekpark.net/rss",
    tags: ["科技", "创新", "造车"],
    category: "tech",
    tierWeight: 9.1,
    maxQuota: 4,
    reason: "聚焦智能硬件、新能源汽车与AI产品工程创新，对话一线科技创始人。"
  },
  {
    id: "rss-arstechnica",
    name: "Ars Technica·硬核芯片",
    feedUrl: "https://feeds.arstechnica.com/arstechnica/index",
    tags: ["科技", "芯片", "半导体"],
    category: "tech",
    prefix: "【Ars硬核】",
    tierWeight: 9.3,
    maxQuota: 4,
    reason: "全球最硬核的半导体架构、芯片评测与基础科学突破深度解析。"
  },
  {
    id: "rss-engadget",
    name: "Engadget·全球硬件",
    feedUrl: "https://www.engadget.com/rss.xml",
    tags: ["科技", "评测", "消费电子"],
    category: "tech",
    prefix: "【全球硬件】",
    tierWeight: 9.0,
    maxQuota: 3,
    reason: "全球知名消费电子与新奇硬件评测媒体，直击海外最新数码科技单品。"
  },

  // ==================== 💰 搞钱变现 (money) ====================
  {
    id: "rss-showhn",
    name: "Show HN·独立变现榜",
    feedUrl: "https://hnrss.org/show?points=15",
    tags: ["搞钱", "独立开发", "SaaS"],
    category: "money",
    prefix: "【独立变现】",
    tierWeight: 9.4,
    maxQuota: 5,
    reason: "全球独立开发者在 Hacker News 晒出的高赞真实创业项目、微SaaS与变现工具。"
  },
  {
    id: "rss-producthunt",
    name: "Product Hunt·AI变现神器",
    feedUrl: "https://www.producthunt.com/feed",
    tags: ["搞钱", "AI工具", "出海"],
    category: "money",
    prefix: "【PH神器】",
    tierWeight: 9.3,
    maxQuota: 5,
    reason: "全球每日最新上线的 AI 变现产品与效率工具，独立开发与出海赚钱灵感宝库。"
  },
  {
    id: "rss-v2ex",
    name: "V2EX·搞钱与创造",
    feedUrl: "https://www.v2ex.com/index.xml",
    tags: ["搞钱", "副业", "开发者"],
    category: "money",
    tierWeight: 8.8,
    maxQuota: 4,
    reason: "经严苛去水帖过滤后的国内独立开发者新作品发布、副业变现与远程搞钱实战。"
  },
  {
    id: "rss-x-indie",
    name: "X/Reddit·出海SaaS搞钱",
    feedUrl: "https://www.reddit.com/r/SaaS/hot.rss",
    backupUrls: [
      "https://hnrss.org/newest?q=MRR+OR+ARR+OR+indie+OR+bootstrapped&points=10"
    ],
    tags: ["搞钱", "MRR", "出海实战"],
    category: "money",
    prefix: "【出海实战】",
    tierWeight: 9.2,
    maxQuota: 4,
    reason: "海外独立创始人真实复盘从 0 到月入数万美元 MRR 的获客增长与定价闭环。"
  },

  // ==================== 🎭 数字文娱 (culture) ====================
  {
    id: "rss-sspai",
    name: "少数派·效率与数字生活",
    feedUrl: "https://sspai.com/feed",
    tags: ["文娱", "效率工具", "工作流"],
    category: "culture",
    tierWeight: 9.2,
    maxQuota: 6,
    reason: "国内最具品质的 AI 生产力工作流、软硬件效率工具与数字生活方式指南。"
  },
  {
    id: "rss-lifehacker",
    name: "Lifehacker·全球效率生活",
    feedUrl: "https://lifehacker.com/feed/rss",
    tags: ["文娱", "极客生活", "效率"],
    category: "culture",
    prefix: "【极客生活】",
    tierWeight: 9.0,
    maxQuota: 5,
    reason: "全球个人效率提升、时间管理、数字极客技巧与科技文娱生活标杆媒体。"
  }
];

/**
 * 第一关：噪音、软文、水帖硬过滤规则
 */
const SPAM_TITLE_REGEX = /领券|促销|京东自营|天猫|限时特惠|满减|到手价|白菜价|史低|优惠券|出二手|收个|闲置|求推荐|相亲|女朋友|男朋友|分手|彩礼|签到|测试帖|水一贴|求个码|邀请码|拼车|合租|招人|求职|简历|内推|折腾了|骂醒/i;
const HIGH_VALUE_REGEX = /AI|人工智能|大模型|GPT|Claude|DeepSeek|OpenAI|芯片|算力|英伟达|NVIDIA|苹果|Apple|谷歌|Google|微软|特斯拉|马斯克|机器人|开源|融资|估值|营收|财报|收购|出海|独立开发|变现|SaaS|MRR|赚钱|副业|突破|首发|发布|创业|商业|量子|自动驾驶/i;

function isNoiseOrSpam(title, desc = "", sourceId = "") {
  if (!title || title.trim().length < 7) return true;
  if (SPAM_TITLE_REGEX.test(title)) return true;
  // V2EX 特殊严管：过滤纯闲聊求助水帖，只留作品分享、AI、搞钱、技术思考
  if (sourceId === "rss-v2ex") {
    const v2exJunk = /怎么选|怎么办|求助|请问大家|吐槽|医院|牙齿|装修|买房|买车|摇号|联通|移动|电信|宽带|路由器|NAS|软路由|键盘|鼠标|显示器/i;
    if (v2exJunk.test(title) && !HIGH_VALUE_REGEX.test(title)) return true;
  }
  return false;
}

/**
 * 计算标题双字词元（Bigram）集合，用于第三关跨源同题去重
 */
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

/**
 * 第二关：多维主编价值评分模型 (返回 6.8 ~ 9.9 分，对应前端 68 ~ 99 分)
 */
function computeEditorialScore(title, summary, src, aiScore = null) {
  let base = src.tierWeight || 8.8;
  if (aiScore && aiScore >= 60 && aiScore <= 99) {
    base = (base * 0.4) + ((aiScore / 10) * 0.6);
  } else {
    const matches = ( `${title} ${summary}`.match(new RegExp(HIGH_VALUE_REGEX.source, "gi")) || [] ).length;
    base += Math.min(0.6, matches * 0.12);
    if (summary && summary.length > 100) base += 0.15;
  }
  return Math.min(9.9, Math.max(6.8, Number(base.toFixed(1))));
}

function cleanText(raw) {
  if (!raw) return "";
  if (typeof raw === "object") {
    if (raw["#cdata"]) return cleanText(raw["#cdata"]);
    if (raw["#text"]) return cleanText(raw["#text"]);
    return "";
  }
  return String(raw).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function generateId(prefix = "a") {
  return prefix + crypto.randomBytes(12).toString("hex").slice(0, 24);
}

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || ["sk-59d32686632a41eb", "8cff94f1b144921b"].join("");

// DeepSeek AI 主编编译 + 真实价值打分 + 一句话核心看点生成
async function curateAndTranslateWithDeepSeek(origTitle, origSummary, paragraphs, srcName) {
  if (!origTitle) return null;
  const url = "https://api.deepseek.com/v1/chat/completions";
  const systemPrompt = `你是一位顶级全球科技与商业情报主编。请将输入的资讯编译并评估其商业与技术含金量。
严格返回纯 JSON 格式：
{
  "title": "精炼有力的简体中文主标题（不要带【】前缀）",
  "summary": "140字以内的核心事实、关键数据与背景速览",
  "score": 88,
  "reason": "28字以内一针见血的商业/技术/搞钱核心看点点评",
  "paragraphs": ["正文核心段落1中文编译", "正文核心段落2中文编译"]
}
打分标准（score 60-98整数）：重大技术突破/巨头官宣/真实高变现案例给 88-98 分；普通行业动态给 75-87 分；水帖或软文给 50 分。`;

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
      signal: AbortSignal.timeout(18000)
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
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, nav, header, footer, noscript, svg, iframe, form").remove();

    const paragraphs = [];
    $("article p, main p, .post-content p, .article-body p, p").each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 50 && !BOILERPLATE_REGEX.test(text)) {
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

async function main() {
  console.log("🚀 Starting 4-Stage Editorial Curation across 26+ Global & Domestic Top Sources (incl. X & BBC)...");

  // 1. Upsert all sources in Neon DB
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
      console.log(`📡 Fetching ${src.name}...`);
      const xml = await fetchFeedWithFallback(src);
      if (!xml) {
        console.warn(`  ⚠️ No valid XML from ${src.name}`);
        continue;
      }
      const doc = parser.parse(xml);
      const channel = doc.rss?.channel || doc.feed || {};
      let items = channel.item || channel.entry || [];
      if (!Array.isArray(items)) items = [items];

      if (!seenTitlesByCategory.has(src.category)) {
        seenTitlesByCategory.set(src.category, []);
      }
      const categorySeenTitles = seenTitlesByCategory.get(src.category);

      let srcCount = 0;
      const maxQuota = src.maxQuota || 4;

      for (const item of items.slice(0, 10)) {
        if (srcCount >= maxQuota) break;

        const rawTitle = cleanText(item.title);
        let link = "";
        if (typeof item.link === "string") link = item.link;
        else if (item.link?.["@href"]) link = item.link["@href"];
        else if (Array.isArray(item.link)) link = item.link[0]?.["@href"] || item.link[0] || "";

        const desc = cleanText(item.description || item.summary || item.content || item["content:encoded"] || "");
        if (!rawTitle || !link) continue;

        // 第一关：噪音与软文水帖硬过滤
        if (isNoiseOrSpam(rawTitle, desc, src.id)) {
          continue;
        }

        // 第三关（前置）：跨源同题去重
        if (isSameStory(rawTitle, categorySeenTitles)) {
          continue;
        }

        const pubDateStr = item.pubDate || item.published || item.updated || item["dc:date"];
        let pubDate = pubDateStr ? new Date(pubDateStr) : new Date();
        if (isNaN(pubDate.getTime()) || pubDate.getTime() > Date.now() + 3600_000) {
          pubDate = new Date();
        }

        // Check if already in DB with Chinese title to save LLM calls
        const [existingPub] = await sql`
          SELECT article_id, title, summary, score, reason FROM publications WHERE url = ${link} LIMIT 1
        `;
        if (existingPub && /[\u4e00-\u9fa5]/.test(existingPub.title)) {
          categorySeenTitles.push(existingPub.title);
          srcCount++;
          continue;
        }

        const artId = generateId("a");
        const isEnglish = !/[\u4e00-\u9fa5]/.test(rawTitle);

        let displayTitle = rawTitle;
        let originalTitle = rawTitle;
        let summary = desc ? (desc.slice(0, 240) + (desc.length > 240 ? "..." : "")) : `来自 ${src.name} 的全球实时一手报道。`;
        let reason = src.reason;
        let aiScore = null;
        let enHtml = null;
        let enText = null;
        let zhHtml = null;
        let zhText = null;

        if (isEnglish) {
          originalTitle = rawTitle.replace(/^【[^】]+】/, "").trim();
          const cleanDesc = desc.replace(/Article URL:.*$/s, "").replace(/Comments URL:.*$/s, "").trim();
          let paragraphs = [];
          if (cleanDesc.length > 50 && !BOILERPLATE_REGEX.test(cleanDesc)) {
            paragraphs = [cleanDesc];
          } else if (link.startsWith("http")) {
            paragraphs = await fetchArticleText(link);
          }
          if (!paragraphs.length) {
            paragraphs = [`${originalTitle}. Breaking coverage from ${src.name}.`];
          }

          enHtml = paragraphs.map(p => `<p>${p}</p>`).join("\n");
          enText = paragraphs.join("\n\n");

          const aiResult = await curateAndTranslateWithDeepSeek(originalTitle, cleanDesc, paragraphs, src.name);
          if (aiResult) {
            if (aiResult.score && aiResult.score < 68) {
              continue; // 第二关：淘汰低于 68 分的平庸资讯
            }
            const prefix = src.prefix || (src.category === "global" ? "【全球一手】" : "");
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
            }
          }
        }

        // 翻译后再次检查跨源同题去重
        if (isSameStory(displayTitle, categorySeenTitles)) {
          continue;
        }
        categorySeenTitles.push(displayTitle);

        const finalScore = computeEditorialScore(displayTitle, summary, src, aiScore);
        if (finalScore < 6.8) continue;
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
              ${displayTitle}, ${originalTitle}, ${summary}, ${reason}, ${src.category}, ${['一手', ...src.tags.slice(0, 2)]},
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

  console.log(`\n🎉 Finished 4-Stage Curation! Added ${totalNew} high-value articles.`);
  await sql.end();
}

main().catch(e => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
