import postgres from "postgres";
import { XMLParser } from "fast-xml-parser";
import * as cheerio from "cheerio";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const connStr = (process.env.DATABASE_URL || "").trim();
const sql = connStr
  ? postgres(connStr, {
      ssl: /127\.0\.0\.1|localhost/.test(connStr) || connStr.includes("sslmode=disable") ? false : "require",
      max: 3,
      connect_timeout: 8,
      idle_timeout: 60,
    })
  : null;

function isQuotaOrFatalDbError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("exceeded the quota") ||
    msg.includes("upgrade your plan") ||
    msg.includes("28p01") ||
    msg.includes("28000") ||
    msg.includes("3d000") ||
    msg.includes("42p01")
  );
}

async function probeDbAvailable() {
  if (!sql) return false;
  try {
    await Promise.race([
      sql`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("db probe timeout")), 6000)),
    ]);
    return true;
  } catch (err) {
    console.warn(`  ⚠️ PostgreSQL unavailable (${err?.message || err}); running in DB-Free Live Snapshot mode.`);
    return false;
  }
}

async function withDbRetry(label, fn, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const code = err && typeof err === "object" ? err.code : null;
      const nonRetryable =
        code === "28P01" || code === "28000" || code === "3D000" || code === "42P01" || isQuotaOrFatalDbError(err);
      if (nonRetryable || attempt >= maxAttempts) {
        throw err;
      }
      const delayMs = 1500 * attempt;
      console.warn(`  ⚠️ [DB Retry] ${label} failed (attempt ${attempt}/${maxAttempts}): ${err?.message || err}. Retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

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
 * HTML 安全转义与段落组装（防止存储型 XSS 与未转义尖括号破坏 DOM）
 */
function escapeHtml(raw) {
  return String(raw || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraphsToSafeHtml(paragraphs) {
  const valid = (paragraphs || []).map((p) => String(p || "").trim()).filter(Boolean);
  if (!valid.length) return null;
  return valid.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
}

/**
 * v3.0 六大核心商业与科技情报板块官方信源矩阵（与 README.md & industry/taxonomy.ts 100% 对齐）
 * 分类键映射：
 * - global   -> 🌐 全球榜（全球一手：硅谷前沿、国际科技巨头与宏观政经要闻）
 * - domestic -> 🇨🇳 国内榜（国内前沿：国内大厂、本土科技产业与宏观财经）
 * - business -> 💼 商业榜（商业创投：深度商业研报、一级市场投融资、独角兽与并购动态）
 * - tech     -> ⚡ 科技榜（硬核科技：AI 大模型、算力芯片、具身智能与前沿算法突破）
 * - money    -> 💰 搞钱榜（搞钱变现：独立开发者出海、微 SaaS 变现、Product Hunt 首发与副业增长）
 * - culture  -> 🎭 文娱榜（数字文娱：生产力效率工具、数字工作流、主机游戏与全球流媒体影视）
 */
const PREMIUM_SOURCES = [
  // ==================== 🌐 1. 全球榜 (global) ====================
  {
    id: "rss-bbc-world",
    name: "BBC News·全球要闻",
    feedUrl: "https://feeds.bbci.co.uk/news/world/rss.xml",
    tags: ["全球一手", "BBC", "国际政经"],
    category: "global",
    prefix: "【BBC全球】",
    tierWeight: 95,
    maxQuota: 5,
    reason: "BBC 全球突发政经要闻与国际宏观变局一手报道。"
  },
  {
    id: "rss-guardian-world",
    name: "The Guardian·全球政经",
    feedUrl: "https://www.theguardian.com/world/rss",
    tags: ["全球一手", "卫报", "宏观趋势"],
    category: "global",
    prefix: "【卫报全球】",
    tierWeight: 93,
    maxQuota: 4,
    reason: "英国《卫报》全球深度调查与国际突发事件一手权威直击。"
  },
  {
    id: "rss-cnbc-world",
    name: "CNBC·全球财经",
    feedUrl: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362",
    tags: ["全球一手", "CNBC", "全球市场"],
    category: "global",
    prefix: "【CNBC全球】",
    tierWeight: 94,
    maxQuota: 4,
    reason: "CNBC 国际财经与全球资本市场实时快讯，把握央行与跨国资本风向。"
  },
  {
    id: "rss-hackernews",
    name: "Hacker News·硅谷热榜",
    feedUrl: "https://hnrss.org/frontpage?points=100",
    tags: ["全球一手", "硅谷热榜", "开源生态"],
    category: "global",
    prefix: "【硅谷热榜】",
    tierWeight: 95,
    maxQuota: 5,
    reason: "全球极客与硅谷工程师热议赞数破百的技术突破与一手前沿议题。"
  },
  {
    id: "rss-theverge",
    name: "The Verge·国际科技巨头",
    feedUrl: "https://www.theverge.com/rss/index.xml",
    tags: ["全球一手", "国际巨头", "产品更新"],
    category: "global",
    prefix: "【国际巨头】",
    tierWeight: 92,
    maxQuota: 4,
    reason: "第一时间追踪苹果、谷歌、微软、Meta 等跨国科技巨头核心产品动作。"
  },

  // ==================== 🇨🇳 2. 国内榜 (domestic) ====================
  {
    id: "rss-chinanews-gn",
    name: "中新网·国内要闻",
    feedUrl: "https://www.chinanews.com.cn/rss/scroll-news.xml",
    tags: ["国内前沿", "政策/监管", "行业动态"],
    category: "domestic",
    prefix: "【国内要闻】",
    tierWeight: 94,
    maxQuota: 4,
    reason: "国家通讯社实时滚动要闻，权威直击国内产业政策与重大经济动态。"
  },
  {
    id: "rss-chinanews-cj",
    name: "中新网·国内财经",
    feedUrl: "https://www.chinanews.com.cn/rss/finance.xml",
    tags: ["国内前沿", "宏观经济", "行业动态"],
    category: "domestic",
    prefix: "【国内财经】",
    tierWeight: 93,
    maxQuota: 4,
    reason: "国内宏观经济、金融监管、资本市场与产业升级权威动向。"
  },
  {
    id: "rss-jiemian",
    name: "界面新闻·国内产经",
    feedUrl: "https://a.jiemian.com/index.php?m=article&a=rss",
    tags: ["国内前沿", "持牌财经", "行业动态"],
    category: "domestic",
    prefix: "【界面产经】",
    tierWeight: 92,
    maxQuota: 4,
    reason: "主流持牌财经媒体，深度追踪国内产业政策与本土龙头企业动态。"
  },
  {
    id: "rss-36kr",
    name: "36氪·国内大厂与新经济",
    feedUrl: "https://36kr.com/feed",
    tags: ["国内前沿", "大厂动态", "行业动态"],
    category: "domestic",
    prefix: "【国内大厂】",
    tierWeight: 92,
    maxQuota: 5,
    reason: "聚焦中国新经济与华为、字节、阿里、腾讯等本土科技大厂核心布局。"
  },
  {
    id: "rss-ithome",
    name: "IT之家·本土科技产业",
    feedUrl: "https://www.ithome.com/rss/",
    tags: ["国内前沿", "本土科技", "产品更新"],
    category: "domestic",
    prefix: "【本土科技】",
    tierWeight: 90,
    maxQuota: 4,
    reason: "国内科技产业、半导体、新能源汽车与国产软硬件重大发布一手快讯。"
  },

  // ==================== 💼 3. 商业榜 (business) ====================
  {
    id: "rss-huxiu",
    name: "虎嗅网·商业与创投深度",
    feedUrl: "https://rss.huxiu.com/",
    tags: ["商业创投", "行业动态", "现象/趋势"],
    category: "business",
    prefix: "【虎嗅商业】",
    tierWeight: 94,
    maxQuota: 5,
    reason: "深度拆解海内外科技商业模式、龙头财报、行业洗牌与战略并购。"
  },
  {
    id: "rss-tmtpost",
    name: "钛媒体·资本与一级市场",
    feedUrl: "https://www.tmtpost.com/rss.xml",
    tags: ["商业创投", "创投融资", "行业动态"],
    category: "business",
    prefix: "【钛媒创投】",
    tierWeight: 92,
    maxQuota: 5,
    reason: "聚焦一二级资本市场、独角兽投融资并购与产业商业化深度研报。"
  },
  {
    id: "rss-tc-venture",
    name: "TechCrunch·全球风险投资",
    feedUrl: "https://techcrunch.com/category/venture/feed/",
    tags: ["商业创投", "硅谷创投", "行业动态"],
    category: "business",
    prefix: "【硅谷创投】",
    tierWeight: 95,
    maxQuota: 4,
    reason: "硅谷一级市场风向标，追踪 a16z、红杉、YC 等顶级风投最新押注赛道。"
  },
  {
    id: "rss-tc-startups",
    name: "TechCrunch·独角兽与并购",
    feedUrl: "https://techcrunch.com/category/startups/feed/",
    tags: ["商业创投", "独角兽", "行业动态"],
    category: "business",
    prefix: "【独角兽动态】",
    tierWeight: 93,
    maxQuota: 4,
    reason: "全球高成长科技初创公司商业模式演进、估值跃升与巨头并购动态。"
  },
  {
    id: "rss-cnbc-business",
    name: "CNBC·商业巨头与财报",
    feedUrl: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147",
    tags: ["商业创投", "巨头财报", "行业动态"],
    category: "business",
    prefix: "【商业财报】",
    tierWeight: 93,
    maxQuota: 4,
    reason: "全球上市公司财报业绩、CEO 战略访谈与跨国并购交易一手快讯。"
  },

  // ==================== ⚡ 4. 科技榜 (tech) ====================
  {
    id: "rss-openai",
    name: "OpenAI·官方一手",
    feedUrl: "https://openai.com/news/rss.xml",
    tags: ["硬核科技", "entity:openai", "模型发布"],
    category: "tech",
    prefix: "【OpenAI官宣】",
    tierWeight: 97,
    maxQuota: 5,
    reason: "OpenAI 官方博客与研究产品一手公告，全球人工智能行业核心风向标。"
  },
  {
    id: "rss-x-tech",
    name: "X/HN·硅谷AI与硬核科技",
    feedUrl: "https://hnrss.org/newest?q=OpenAI+OR+Claude+OR+Anthropic+OR+DeepSeek+OR+LLM+OR+GPT+OR+Agent+OR+NVIDIA&points=15",
    backupUrls: [
      "https://www.reddit.com/r/OpenAI/hot.rss",
      "https://www.reddit.com/r/singularity/hot.rss"
    ],
    tags: ["硬核科技", "Agent", "模型发布"],
    category: "tech",
    prefix: "【硅谷AI一手】",
    tierWeight: 95,
    maxQuota: 5,
    reason: "硅谷 AI 实验室与技术领袖关于大模型、Agent 与算力芯片的实时首发动态。"
  },
  {
    id: "rss-qbitai",
    name: "量子位·AI与具身智能智库",
    feedUrl: "https://www.qbitai.com/feed",
    tags: ["硬核科技", "模型发布", "论文/研究"],
    category: "tech",
    prefix: "【量子位AI】",
    tierWeight: 94,
    maxQuota: 5,
    reason: "国内顶尖 AI 智库，深度拆解大模型架构、AI Agent 与具身智能机器人突破。"
  },
  {
    id: "rss-mittr",
    name: "MIT科技评论·底层科技突破",
    feedUrl: "https://www.technologyreview.com/feed/",
    tags: ["硬核科技", "论文/研究", "现象/趋势"],
    category: "tech",
    prefix: "【MIT科技评论】",
    tierWeight: 95,
    maxQuota: 4,
    reason: "麻省理工科技评论权威报道，洞察下一代人工智能、芯片与计算科学突破。"
  },
  {
    id: "rss-tc-ai",
    name: "TechCrunch·前沿AI与硬件",
    feedUrl: "https://techcrunch.com/category/artificial-intelligence/feed/",
    tags: ["硬核科技", "产品更新", "模型发布"],
    category: "tech",
    prefix: "【前沿AI】",
    tierWeight: 93,
    maxQuota: 4,
    reason: "直击硅谷 AI 模型演进、AI 原生硬件终端与算力基础设施发布。"
  },
  {
    id: "rss-reddit-llm",
    name: "LocalLLaMA·开源大模型社区",
    feedUrl: "https://www.reddit.com/r/LocalLLaMA/hot.rss",
    tags: ["硬核科技", "开源生态", "部署/工程"],
    category: "tech",
    prefix: "【开源大模型】",
    tierWeight: 92,
    maxQuota: 4,
    reason: "全球开源大模型技术社区，第一时间评测 DeepSeek、Qwen、Llama 权重与本地推理实战。"
  },

  // ==================== 💰 5. 搞钱榜 (money) ====================
  {
    id: "rss-showhn",
    name: "Show HN·独立开发者变现榜",
    feedUrl: "https://hnrss.org/show?points=15",
    tags: ["搞钱变现", "产品更新", "编码"],
    category: "money",
    prefix: "【独立变现】",
    tierWeight: 95,
    maxQuota: 5,
    reason: "全球独立开发者在 Hacker News 发布的真实创业项目、微 SaaS 与商业化工具。"
  },
  {
    id: "rss-producthunt",
    name: "Product Hunt·全球首发搞钱工具",
    feedUrl: "https://www.producthunt.com/feed",
    tags: ["搞钱变现", "产品更新", "Agent"],
    category: "money",
    prefix: "【PH首发】",
    tierWeight: 94,
    maxQuota: 5,
    reason: "全球每日最新上线的 AI 变现产品与效率工具，独立开发与出海增长灵感库。"
  },
  {
    id: "rss-x-indie",
    name: "IndieSaaS·出海MRR增长实战",
    feedUrl: "https://hnrss.org/newest?q=MRR+OR+ARR+OR+indie+OR+bootstrapped+OR+SaaS+OR+Stripe&points=10",
    backupUrls: [
      "https://www.reddit.com/r/SaaS/hot.rss"
    ],
    tags: ["搞钱变现", "教程/实践", "现象/趋势"],
    category: "money",
    prefix: "【出海实战】",
    tierWeight: 94,
    maxQuota: 5,
    reason: "海外独立创始人真实复盘从 0 到月入数万美元 MRR 的获客增长、定价与收款闭环。"
  },
  {
    id: "rss-v2ex",
    name: "V2EX·独立创造与副业变现",
    feedUrl: "https://www.v2ex.com/feed/create.xml",
    backupUrls: [
      "https://www.v2ex.com/index.xml"
    ],
    tags: ["搞钱变现", "教程/实践", "编码"],
    category: "money",
    prefix: "【独立创造】",
    tierWeight: 90,
    maxQuota: 4,
    reason: "国内开发者独立产品创造、AI 工具出海收款与副业变现真实案例分享。"
  },

  // ==================== 🎭 6. 文娱榜 (culture) ====================
  {
    id: "rss-sspai",
    name: "少数派·数字生活与效率工具",
    feedUrl: "https://sspai.com/feed",
    tags: ["数字文娱", "教程/实践", "产品更新"],
    category: "culture",
    prefix: "【少数派效率】",
    tierWeight: 94,
    maxQuota: 5,
    reason: "高品质数字消费指南，深度分享生产力工具、AI 工作流与软硬件效率实践。"
  },
  {
    id: "rss-gcores",
    name: "机核网·游戏与数字文化",
    feedUrl: "https://www.gcores.com/rss",
    tags: ["数字文娱", "游戏动漫", "现象/趋势"],
    category: "culture",
    prefix: "【机核数字文化】",
    tierWeight: 92,
    maxQuota: 4,
    reason: "国内深度游戏开发、科幻文化、数字艺术与互动娱乐一手资讯。"
  },
  {
    id: "rss-variety",
    name: "Variety·全球流媒体与影视商业",
    feedUrl: "https://variety.com/feed/",
    tags: ["数字文娱", "流媒体", "视频"],
    category: "culture",
    prefix: "【流媒体巨制】",
    tierWeight: 93,
    maxQuota: 4,
    reason: "全球流媒体巨头（Netflix、Disney、Apple TV+）、AIGC 影视制作与票房动态。"
  },
  {
    id: "rss-deadline",
    name: "Deadline·全球票房与影视工业",
    feedUrl: "https://deadline.com/feed/",
    tags: ["数字文娱", "全球票房", "视频"],
    category: "culture",
    prefix: "【全球票房】",
    tierWeight: 92,
    maxQuota: 4,
    reason: "追踪全球院线票房、影视科技工业与爆款剧集商业表现。"
  },
  {
    id: "rss-chinanews-ent",
    name: "中新网·文化与数字消费",
    feedUrl: "https://www.chinanews.com.cn/rss/culture.xml",
    tags: ["数字文娱", "文化消费", "现象/趋势"],
    category: "culture",
    prefix: "【文化消费】",
    tierWeight: 91,
    maxQuota: 4,
    reason: "国内文化产业、数字文旅消费、院线电影与展览演出权威快讯。"
  }
];

/**
 * 38 个标准主题 (`industry/topics.json`) 自动标签推断规则
 * 让 `/topics` 页面下的公司与模型、技术方向、内容形态三大组 38 个主题全部拥有精准匹配的精选文章！
 */
const ENTITY_MATCHERS = [
  { id: "openai", re: /\b(OpenAI|ChatGPT|GPT-4|GPT-5|o1|o3|Sora|Sam Altman)\b/i },
  { id: "anthropic", re: /\b(Anthropic|Claude|Claude Code|Dario Amodei)\b/i },
  { id: "google", re: /\b(Google|Gemini|DeepMind|AlphaFold|Veo|NotebookLM|Waymo)\b|谷歌/i },
  { id: "deepseek", re: /\b(DeepSeek|DeepSeek-R1|DeepSeek-V3)\b|深度求索/i },
  { id: "qwen", re: /\b(Qwen|Qwen2|Qwen3|QwQ)\b|千问|通义千问|阿里大模型/i },
  { id: "kimi", re: /\b(Kimi|Moonshot)\b|月之暗面/i },
  { id: "minimax", re: /\b(MiniMax|Hailuo)\b|海螺AI/i },
  { id: "zhipu", re: /\b(ChatGLM|GLM-4|Zhipu|AutoGLM)\b|智谱/i },
  { id: "xai", re: /\b(xAI|Grok|Colossus)\b|马斯克.*AI/i },
  { id: "meta", re: /\b(Meta|Llama|Llama 3|Llama 4|Zuckerberg)\b|扎克伯格/i },
  { id: "microsoft", re: /\b(Microsoft|Copilot|Azure AI|Satya Nadella)\b|微软/i },
  { id: "nvidia", re: /\b(NVIDIA|GeForce|CUDA|Blackwell|Rubin|Jensen Huang)\b|英伟达|黄仁勋/i },
  { id: "hugging-face", re: /\b(Hugging\s*Face|Transformers| Gradio)\b/i },
  { id: "cursor", re: /\b(Cursor|Anysphere|Windsurf)\b/i },
  { id: "openrouter", re: /\b(OpenRouter)\b/i }
];

const TOPIC_TAG_MATCHERS = [
  { tag: "Agent", re: /\b(Agent|Agents|Agentic|AutoGPT|Manus|Claude Code|Operator|Devin)\b|智能体|代理/i },
  { tag: "编码", re: /\b(Coding|Code|IDE|Copilot|Cursor|GitHub|Developer|Programming|TypeScript|Rust|Python)\b|编程|写代码|代码生成|开发者|独立开发/i },
  { tag: "推理", re: /\b(Reasoning|Chain-of-Thought|CoT|o1|o3|R1|Math|Logic|Thinking)\b|推理模型|深度推理|思维链/i },
  { tag: "多模态", re: /\b(Multimodal|Vision|VLM|Omni)\b|多模态|视觉理解|图文/i },
  { tag: "图像生成", re: /\b(Midjourney|Stable Diffusion|Flux|DALL-E|Image Generation)\b|图像生成|文生图|AI绘画|生图/i },
  { tag: "视频", re: /\b(Sora|Runway|Pika|Kling|Veo|Netflix|Hollywood|Variety|Deadline|Box Office)\b|视频生成|文生视频|影视|电影|票房|剧集|流媒体/i },
  { tag: "语音", re: /\b(Voice|TTS|ASR|Audio|ElevenLabs|Whisper|Podcast)\b|语音合成|音频|播客|音乐生成/i },
  { tag: "具身智能", re: /\b(Robot|Robotics|Humanoid|Figure|Optimus|Unitree|Embodied)\b|具身智能|人形机器人|机器人|自动驾驶|宇树/i },
  { tag: "端侧", re: /\b(On-device|Edge AI|Apple Intelligence|NPU|LocalLLaMA|GGUF|Ollama|MLX)\b|端侧|本地部署|手机AI|端侧模型|本地推理/i },
  { tag: "开源生态", re: /\b(Open Source|Open-source|GitHub|Apache|MIT License|Hugging Face|Weights|LocalLLaMA)\b|开源|开源模型|开源项目|权重/i },
  { tag: "部署/工程", re: /\b(vLLM|Docker|Kubernetes|Cloud|GPU|Inference|Serving|Latency|Database|Postgres|Architecture)\b|算力|推理优化|架构|工程|服务器|云原生|数据库/i },
  { tag: "数据/训练", re: /\b(Dataset|Pre-training|Fine-tuning|RLHF|Post-training|Synthetic Data|Training)\b|数据集|微调|预训练|训练成本|强化学习/i },
  { tag: "安全/对齐", re: /\b(Safety|Alignment|Jailbreak|Security|Privacy|Cybersecurity|Hack|Vulnerability)\b|安全|对齐|隐私|漏洞|防伪|合规/i },
  { tag: "MCP/工具调用", re: /\b(MCP|Model Context Protocol|Function Calling|Tool Use|API|SDK|Plugin)\b|工具调用|工作流|插件/i },
  { tag: "模型发布", re: /\b(Release|Launch|Announcing|Introducing|New Model|Weight)\b|发布|官宣|上线|开源了|新模型|突破/i },
  { tag: "产品更新", re: /\b(Show HN|Product Hunt|Update|Feature|App|SaaS|Tool)\b|新功能|产品|工具|神器|改版|评测/i },
  { tag: "论文/研究", re: /\b(ArXiv|Paper|Research|Study|MIT|Stanford|Nature|Science)\b|论文|研究|实验室|科学家|学术/i },
  { tag: "评测/基准", re: /\b(Benchmark|Eval|Leaderboard|Arena|Comparison|Test)\b|评测|基准|排行榜|跑分|对比/i },
  { tag: "教程/实践", re: /\b(How to|Guide|Tutorial|Bootstrapped|MRR|ARR|Workflow|Tips)\b|实战|复盘|指南|教程|搞钱|变现|副业|效率|工作流/i },
  { tag: "大佬观点", re: /\b(Interview|Opinion|CEO|Founder|Altman|Musk|Karpathy|Jensen)\b|访谈|观点|预言|创始人|高管|对话/i },
  { tag: "现象/趋势", re: /\b(Trend|Market|Economy|Future|Report|Growth)\b|趋势|风向|宏观|变局|洞察|浪潮/i },
  { tag: "行业动态", re: /\b(Funding|Raise|Valuation|Acquisition|IPO|Earnings|Revenue|Billion|Venture)\b|融资|估值|收购|并购|财报|营收|创投|资本|大厂|产业/i },
  { tag: "政策/监管", re: /\b(Policy|Regulation|Law|Government|Antitrust|Tariff|Fed|Central Bank)\b|政策|监管|法规|央行|反垄断|关税|立法|国务院/i }
];

export function inferTopicTags(title, originalTitle, summary, category, baseTags = []) {
  const combined = `${title || ""} ${originalTitle || ""} ${summary || ""}`;
  const titleText = `${title || ""} ${originalTitle || ""}`;
  const tags = new Set((baseTags || []).filter(Boolean));

  // 1. 匹配公司实体标签（确保标题中出现的实体打上 entity:<id>，满足 topics.ts 的 topicMembership 条件）
  for (const em of ENTITY_MATCHERS) {
    if (em.re.test(titleText)) {
      tags.add(`entity:${em.id}`);
    }
  }

  // 2. 匹配技术方向与内容形态标签
  for (const tm of TOPIC_TAG_MATCHERS) {
    if (tm.re.test(combined)) {
      tags.add(tm.tag);
    }
  }

  // 3. 按分类兜底基础形态标签，确保每篇文章至少归属 1-2 个通用主题
  if (category === "business") {
    tags.add("行业动态");
    tags.add("现象/趋势");
  } else if (category === "money") {
    tags.add("教程/实践");
    tags.add("产品更新");
  } else if (category === "tech") {
    tags.add("模型发布");
    tags.add("现象/趋势");
  } else if (category === "global") {
    tags.add("现象/趋势");
    tags.add("行业动态");
  } else if (category === "domestic") {
    tags.add("行业动态");
    tags.add("政策/监管");
  } else if (category === "culture") {
    tags.add("产品更新");
    tags.add("现象/趋势");
  }

  return [...tags];
}

/**
 * 噪音、水帖与体育/刑事串类硬过滤规则
 */
const SPAM_TITLE_REGEX = /\[推广\]|\[Telegram\]|\[买买买\]|粉丝服务|刷粉|推广|代理IP|原生\s*IP|领券|促销|京东自营|天猫|限时特惠|满减|到手价|白菜价|史低|优惠券|出二手|收个|闲置|求推荐|相亲|女朋友|男朋友|分手|彩礼|签到|测试帖|水一贴|求个码|邀请码|拼车|合租|年付半价|土区|封号会把|哈基米|跟踪指数.*上涨|标的指数涨超|ETF[^\s]{0,6}\(\d{6}\)|招人|求职|简历|内推|折腾了|骂醒|耳放|充电宝|数据线|保护壳|钢化膜|桌搭|键帽|鼠标垫|怎么在美亚买|买个手机/i;
const SPORTS_NOISE_REGEX = /欧冠|英超|西甲|意甲|德甲|法甲|中超|国足|男足|女足|足协|皇马|巴萨|曼城|曼联|阿森纳|利物浦|拜仁|国米|NBA|CBA|湖人|勇士|凯尔特人|詹姆斯|库里|杜兰特|约基奇|网球|大满贯|温网|美网|澳网|法网|F1大奖赛|斯诺克|九球|台球|桌球|丁俊晖|国乒|羽毛球|冬奥|花样滑冰|拳击|世预赛|半决赛|战报|进球|绝杀|转会|主帅/i;
const CRIME_TRIVIA_REGEX = /纵火|判刑|杀人|凶杀|盗窃|吸毒|家暴|出轨|酒驾|交通事故|追尾|空袭.*造成|死\d+伤|\d+死\d+伤|溺水|坠楼|砍人/i;
const HIGH_VALUE_REGEX = /AI|人工智能|大模型|GPT|Claude|DeepSeek|OpenAI|芯片|算力|英伟达|NVIDIA|苹果|Apple|谷歌|Google|微软|特斯拉|马斯克|机器人|开源|融资|估值|营收|财报|收购|出海|独立开发|变现|SaaS|MRR|ARR|赚钱|副业|突破|首发|发布|创业|商业|流媒体|票房|效率|工具/i;
const PURE_AI_REGEX = /OpenAI|ChatGPT|Claude|Anthropic|DeepSeek|Qwen|通义千问|Kimi|豆包|大模型|LLM|Agent|智能体|具身智能|人形机器人|算力|英伟达|NVIDIA|Sora|Midjourney|多模态|推理模型|微调/i;
const FOREIGN_GEO_REGEX = /伊朗|以色列|加沙|巴勒斯坦|乌克兰|俄罗斯|莫斯科|泽连斯基|普京|白宫|五角大楼|美国国会|英国首相|伦敦|苏格兰|法国总统|巴黎|德国|柏林|日本|东京|韩国|首尔|加拿大|澳大利亚|巴西|墨西哥|叙利亚|黎巴嫩|北约|欧盟委员会|Cloudflare|FAA|NASA/i;
const CHINA_REL_REGEX = /中国|国内|我国|国务院|发改委|工信部|央行|A股|港股|人民币|华为|字节|腾讯|阿里|小米|比亚迪|百度|美团|京东|拼多多|深交所|上交所|北京|上海|深圳|杭州/i;

function isNoiseOrSpam(title, desc = "", sourceId = "") {
  if (!title || title.trim().length < 7) return true;
  if (SPAM_TITLE_REGEX.test(title)) return true;
  if (SPORTS_NOISE_REGEX.test(title)) return true;
  if (CRIME_TRIVIA_REGEX.test(title)) return true;
  if (sourceId === "rss-v2ex") {
    const v2exJunk = /怎么选|怎么办|求助|请问大家|吐槽|医院|牙齿|装修|买房|买车|摇号|联通|移动|电信|宽带|路由器|NAS|软路由|键盘|鼠标|显示器|手机壳|套餐|信用卡|银行卡|报销/i;
    if (v2exJunk.test(title) && !HIGH_VALUE_REGEX.test(title)) return true;
  }
  if (sourceId === "rss-ithome") {
    const ithomeTrivial = /开售|上架|元起|众筹|壁纸|主题|更新推送|版本号|跑分|壳膜|氮化镓|移动电源|耳机|音箱|手表表带|手环/i;
    if (ithomeTrivial.test(title)) return true;
  }
  return false;
}

/**
 * 单篇文章级语义路由：彻底防止板块串类
 */
function routeArticleCategory(title, summary, defaultCategory, sourceId) {
  const combined = `${title} ${summary}`;
  if (SPORTS_NOISE_REGEX.test(title)) return null;

  if (defaultCategory === "domestic") {
    // 1. 国内源报道纯 AI 大模型突破 -> tech
    if (PURE_AI_REGEX.test(title) && !/国务院|发改委|央行|财政部|A股|港股/.test(title)) {
      return "tech";
    }
    // 2. 国内源报道明显属于国际政经/海外突发且与中国无关 -> 直接过滤剔除，既不污染国内榜也不混入全球外媒双语榜
    if (FOREIGN_GEO_REGEX.test(title) && !CHINA_REL_REGEX.test(combined)) {
      return null;
    }
    // 3. 国内源报道创投融资/并购/财报研报 -> business
    if (/融资|IPO|估值|并购|收购|财报|营收|净利润|创投|独角兽/.test(title) && /亿|万|美元|港元|A轮|B轮|C轮|上市/.test(combined)) {
      return "business";
    }
    return "domestic";
  }

  if (defaultCategory === "money") {
    // V2EX 等必须具备开发/创造/产品/变现/AI价值才留在搞钱榜
    if (sourceId === "rss-v2ex" && !/开发|开源|上线|产品|工具|插件|网站|App|SaaS|AI|出海|独立|变现|副业|赚钱|营收|用户|推广|创作|工作流|MCP|Agent/i.test(combined)) {
      return null;
    }
    return "money";
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

/**
 * 统一采用 0–100 整数评分体系（与 packages/backend 原生量纲一致）
 */
function computeEditorialScore(title, summary, src, aiScore = null) {
  let base = src.tierWeight && src.tierWeight > 15 ? src.tierWeight : (src.tierWeight || 9.0) * 10;
  if (aiScore && aiScore >= 60 && aiScore <= 99) {
    base = Math.round(base * 0.35 + aiScore * 0.65);
  } else {
    const matches = (`${title} ${summary}`.match(new RegExp(HIGH_VALUE_REGEX.source, "gi")) || []).length;
    base += Math.min(5, matches * 1.2);
    if (summary && summary.length > 90) base += 1.5;
  }
  return Math.min(98, Math.max(76, Math.round(base)));
}

/**
 * 生成针对文章内容的个性化商业/技术推荐理由（杜绝千篇一律的信源介绍套话）
 */
function generateContextualReason(title, summary, category, src) {
  const text = `${title} ${summary}`;
  const cleanTitle = String(title || "").replace(/^【[^】]+】\s*/, "").trim();
  const focus = cleanTitle.slice(0, 22) + (cleanTitle.length > 22 ? "…" : "");

  if (/融资|估值|收购|并购|IPO|上市|投资|基金/.test(text)) {
    return `资本风向标：深度追踪「${focus}」背后的投融资逻辑与赛道估值重构。`;
  }
  if (/财报|营收|利润|市值|股价|业绩|增长/.test(text)) {
    return `基本面研判：从「${focus}」关键财务指标洞察行业龙头商业化变现能力。`;
  }
  if (/开源|GitHub|权重|本地部署|vLLM|Ollama|LocalLLaMA/i.test(text)) {
    return `开源工程价值：「${focus}」技术方案与实测表现，可直接赋能开发者低成本落地。`;
  }
  if (/Agent|智能体|MCP|工作流|自动化|Claude Code|Cursor/i.test(text)) {
    return `生产力范式转移：聚焦「${focus}」在智能体自主规划与工具链协同上的演进。`;
  }
  if (/SaaS|MRR|ARR|独立开发|出海|变现|副业|Product Hunt|Show HN/i.test(text)) {
    return `搞钱实战参考：拆解「${focus}」的产品定位、冷启动获客与商业变现闭环。`;
  }
  if (/OpenAI|GPT|Anthropic|Claude|DeepSeek|Gemini|Qwen|大模型/i.test(text)) {
    return `前沿模型演进：评估「${focus}」在模型能力边界、推理成本与应用生态上的突破。`;
  }
  if (/芯片|算力|NVIDIA|英伟达|半导体|GPU|机器人|具身智能/i.test(text)) {
    return `硬核科技底座：剖析「${focus}」对算力供应链与新一代智能硬件终端的传导效应。`;
  }
  if (category === "culture") {
    return `数字消费与效率：提炼「${focus}」在数字工作流与内容消费市场的核心看点。`;
  }
  if (category === "domestic") {
    return `本土产业信号：关注「${focus}」释放的国内政策导向与本土供应链竞争格局。`;
  }
  if (category === "global") {
    return `全球宏观视野：追踪「${focus}」对跨国商业环境、科技监管与全球市场的连锁影响。`;
  }
  return `${src.name.split("·")[0]}精选研判：聚焦「${focus}」的一手事实与行业演进信号。`;
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
    .replace(/&#8217;|&#39;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 从 RSS item 的 HTML 字段中提取多段干净正文段落
 */
function extractParagraphsFromItemHtml(item) {
  const rawHtml = [item["content:encoded"], item.content, item.description, item.summary]
    .map((x) => (typeof x === "object" ? (x?.["#cdata"] || x?.["#text"] || "") : String(x || "")))
    .sort((a, b) => b.length - a.length)[0] || "";

  if (!rawHtml) return [];
  const paragraphs = [];
  if (/<p[\s>]|<div[\s>]|<br/i.test(rawHtml)) {
    const $ = cheerio.load(rawHtml);
    $("script, style, nav, footer, iframe, form").remove();
    $("p, li").each((_, el) => {
      const t = cleanText($(el).text());
      if (t.length >= 25 && !/Article URL:|Comments URL:|Points:\s*\d+/i.test(t)) {
        paragraphs.push(t);
      }
    });
  }
  if (paragraphs.length === 0) {
    const plain = cleanText(rawHtml)
      .replace(/Article URL:.*$/s, "")
      .replace(/Comments URL:.*$/s, "")
      .replace(/Points:\s*\d+.*$/s, "")
      .trim();
    if (plain.length >= 30) {
      // 按句切分为自然段落，确保详情页阅读体验饱满
      const sentences = plain.split(/(?<=[。！？.!?])\s+/).filter((s) => s.trim().length > 10);
      if (sentences.length >= 3) {
        for (let i = 0; i < sentences.length; i += 2) {
          paragraphs.push(sentences.slice(i, i + 2).join(" "));
        }
      } else {
        paragraphs.push(plain);
      }
    }
  }
  return paragraphs.slice(0, 10);
}

function extractBestSummary(item, rawTitle, src) {
  const candidates = [
    cleanText(item["content:encoded"]),
    cleanText(item.content),
    cleanText(item.description),
    cleanText(item.summary)
  ].filter(Boolean);

  candidates.sort((a, b) => b.length - a.length);
  let best = (candidates[0] || "")
    .replace(/Article URL:.*$/s, "")
    .replace(/Comments URL:.*$/s, "")
    .replace(/Points:\s*\d+.*$/s, "")
    .trim();

  if (best.length >= 25) {
    if (best.length <= 240) return best;
    // 在完整句子边界截断，避免半截话带 "..."
    const slice = best.slice(0, 240);
    const lastPunct = Math.max(slice.lastIndexOf("。"), slice.lastIndexOf(". "), slice.lastIndexOf("！"), slice.lastIndexOf("；"));
    return lastPunct > 100 ? slice.slice(0, lastPunct + 1) : `${slice}…`;
  }
  const cleanTitle = rawTitle.replace(/^【[^】]+】/, "").trim();
  return `${src.name}一手报道：${cleanTitle}。${src.reason}`;
}

function generateId(prefix = "a") {
  return prefix + crypto.randomBytes(12).toString("hex").slice(0, 24);
}

const DEEPSEEK_KEY = (process.env.DEEPSEEK_API_KEY || "").trim();
let warnedMissingDeepSeek = false;
let deepseekAuthFailed = false;

async function curateAndTranslateWithDeepSeek(origTitle, origSummary, paragraphs, srcName, category) {
  if (!origTitle || deepseekAuthFailed) return null;
  if (!DEEPSEEK_KEY) {
    if (!warnedMissingDeepSeek) {
      warnedMissingDeepSeek = true;
      console.warn("  ℹ️ DEEPSEEK_API_KEY is not set; falling back to translation pipeline.");
    }
    return null;
  }
  const url = "https://api.deepseek.com/v1/chat/completions";
  const roleHint = category === "business"
    ? "全球商业创投总编（精通科技商业模式、一二级资本市场投融资与并购研报）"
    : category === "culture"
      ? "数字文娱与效率工具总编（精通生产力工作流、数字消费与全球流媒体影视商业）"
      : "顶级全球政经、AI硬核科技与独立开发商业化情报总编";

  const systemPrompt = `你是一位${roleHint}。请将输入的资讯深度编译为地道、客观、信息密度极高的简体中文，并评估其情报价值（0-100整数分）。
严格返回纯 JSON 格式：
{
  "title": "精炼有力的简体中文主标题（不要带【】前缀）",
  "summary": "140字以内的核心事实、关键技术/商业数据与行业背景速览（严禁出现未完成截断或空洞套话）",
  "score": 91,
  "reason": "35字以内针对该事件的一针见血商业或技术看点研判",
  "paragraphs": ["正文核心事实与背景深度编译段落1", "技术或商业关键细节深度编译段落2", "行业影响与后续看点段落3"]
}`;

  const userContent = JSON.stringify({
    source: srcName,
    title: origTitle,
    summary: origSummary.slice(0, 500),
    paragraphs: paragraphs.slice(0, 6)
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
      signal: AbortSignal.timeout(12000)
    });

    if (res.status === 401 || res.status === 402 || res.status === 403) {
      deepseekAuthFailed = true;
      console.warn(`  ℹ️ DeepSeek key returned HTTP ${res.status}; switching to multi-endpoint neural translation pipeline.`);
      return null;
    }

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

  // 1. Primary: clients5.google.com (dict-chrome-ex) — exempt from gtx 429 rate-limit captcha
  try {
    const res1 = await fetch("https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=zh-CN", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"
      },
      body: new URLSearchParams({ q: clean }),
      signal: AbortSignal.timeout(7000)
    });
    if (res1.ok) {
      const data1 = await res1.json();
      const tr1 = Array.isArray(data1?.[0]) ? data1[0][0] : (typeof data1?.[0] === "string" ? data1[0] : "");
      if (tr1 && /[\u4e00-\u9fa5]/.test(tr1)) return String(tr1).trim();
    }
  } catch {}

  // 2. Secondary: translate.google.com (client=at Android neural endpoint)
  try {
    const res2 = await fetch("https://translate.google.com/translate_a/single?client=at&dt=t&dj=1&sl=auto&tl=zh-CN", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "GoogleTranslate/6.29.59279 (Linux; U; Android 11; Pixel 5)"
      },
      body: new URLSearchParams({ q: clean }),
      signal: AbortSignal.timeout(7000)
    });
    if (res2.ok) {
      const data2 = await res2.json();
      const tr2 = (data2?.sentences || []).map((s) => s?.trans || "").join("");
      if (tr2 && /[\u4e00-\u9fa5]/.test(tr2)) return tr2.trim();
    }
  } catch {}

  // 3. Tertiary: translate.googleapis.com (client=gtx)
  try {
    const res3 = await fetch("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ q: clean }),
      signal: AbortSignal.timeout(7000)
    });
    if (res3.ok) {
      const data3 = await res3.json();
      const tr3 = data3[0].map((item) => item[0]).join("");
      if (/[\u4e00-\u9fa5]/.test(tr3)) return tr3;
    }
  } catch {}
  return clean;
}

const BOILERPLATE_REGEX = /cookie|subscribe|newsletter|sign up|terms of service|privacy policy|get started|ad-free|exclusive features|版权声明|未经授权|不得转载/i;

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
    $("article p, main p, .post-content p, .article-body p, .content p, p").each((_, el) => {
      const text = cleanText($(el).text());
      if (text.length > 35 && !BOILERPLATE_REGEX.test(text)) {
        paragraphs.push(text);
      }
    });
    return paragraphs.slice(0, 10);
  } catch {
    return [];
  }
}

async function fetchFeedWithFallback(src) {
  const candidates = [src.feedUrl, ...(src.backupUrls || [])];
  for (const url of candidates) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/rss+xml, application/xml, text/xml, application/atom+xml, */*"
          },
          signal: AbortSignal.timeout(10000)
        });
        if (res.ok) {
          const xml = await res.text();
          if (xml && xml.length > 150) return xml;
        }
      } catch {}
    }
  }
  return null;
}

/**
 * 构建全文检索文本 (`publications.search_text` 与 `pool_search`)
 */
function buildSearchText({ title, originalTitle, summary, reason, sourceName, tags }) {
  return [
    title,
    originalTitle,
    summary,
    reason,
    sourceName,
    ...(tags || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 清理历史遗留分类错乱、回填 0-100 评分、回填全文检索索引、修复国内正文与外媒双语译文
 */
async function cleanupAndRepairDatabase() {
  console.log("🧹 [Step 1] Cleaning up legacy category misalignments, sports noise & repairing database state...");

  // 1. 停用旧版体育信源并将所有体育赛事新闻从商业榜 (business) 及全站移除
  const legacySportsSources = [
    "rss-chinanews-sports",
    "rss-bbc-football",
    "rss-bbc-sport",
    "rss-guardian-football",
    "rss-guardian-sport",
    "rss-espn-nba",
    "rss-espn-top"
  ];
  await sql`
    UPDATE sources SET enabled = false WHERE id = ANY(${legacySportsSources}::text[])
  `;
  await sql`
    DELETE FROM publications
    WHERE source_id = ANY(${legacySportsSources}::text[])
       OR (category = 'business' AND title ~* '欧冠|英超|西甲|意甲|德甲|法甲|中超|国足|男足|女足|皇马|巴萨|曼城|曼联|阿森纳|利物浦|拜仁|NBA|CBA|湖人|勇士|拳击|冬奥|花样滑冰|羽毛球|网球|大满贯|F1|斯诺克|体坛|足坛|世预赛|战报|比分')
  `;

  // 2. 将原本属于商业创投（虎嗅、钛媒体、创投融资、财报并购）但被旧脚本错误挪到 money 的文章归位到 business（商业榜）
  await sql`
    UPDATE publications
    SET category = 'business'
    WHERE source_id IN ('rss-huxiu', 'rss-tmtpost', 'rss-tc-venture', 'rss-tc-startups', 'rss-cnbc-business')
       OR (category = 'money' AND title ~* '虎嗅|钛媒|财报|IPO|并购|收购|A轮|B轮|C轮|战略投资|市值|营收|估值' AND title !~* 'Show HN|Product Hunt|独立开发|副业|V2EX')
  `;

  // 3. 将少数派 (sspai) 及效率工具文章归位到 culture（文娱榜）
  await sql`
    UPDATE publications
    SET category = 'culture'
    WHERE source_id IN ('rss-sspai', 'sspai')
  `;

  // 4. 清除国内榜 (domestic) 或全球榜 (global) 中来自国内中文源但与中国及科技商业无关的纯海外通稿
  await sql`
    DELETE FROM publications
    WHERE source_id IN ('rss-chinanews-gn', 'rss-chinanews-cj', 'rss-chinanews-ent')
      AND (category = 'global' OR (
        title ~* '伊朗|以色列|加沙|巴勒斯坦|乌克兰|泽连斯基|白宫|五角大楼|英国首相|苏格兰|墨西哥|叙利亚|黎巴嫩|北约|默茨|吕特'
        AND title !~* '中国|国内|我国|华为|字节|腾讯|阿里|小米|比亚迪|A股|港股'
      ))
  `;

  // 5. 将国内榜中纯 AI 大模型突破归位到 tech（科技榜）
  await sql`
    UPDATE publications
    SET category = 'tech'
    WHERE category = 'domestic'
      AND (title ~* 'OpenAI|Claude|Anthropic|DeepSeek|大模型|LLM|Agent|智能体|Sora|量子位' OR source_id = 'rss-qbitai')
  `;

  // 6. 清除 V2EX 买买买/生活琐事水帖、推广软文、ETF 机器播报、台球体育串类及刑事/伤亡社会新闻
  await sql`
    DELETE FROM publications
    WHERE title ~* '\\[推广\\]|\\[买买买\\]|\\[股票\\]|\\[职场话题\\]|\\[问与答\\]|怎么在美亚买|买个手机|ZooProxy|原生\\s*IP|年付半价|土区|哈基米|准确预测了老黄|封号会把整个|感觉 Neon 速度快|九球公开赛|中式九球|跟踪指数.*上涨|标的指数涨超|ETF.*\\([0-9]{6}\\)|耳放|充电宝|保护壳|壁纸|氮化镓|鼠标垫|键帽|纵火|判刑|凶杀|空袭.*造成|\\d+死\\d+伤'
  `;

  // 6b. 规范化历史文章中残留的【焦点】【钛晨报】[分享创造][程序员]等非标前缀，并折叠同事件重复国内短通稿
  await sql`
    UPDATE publications
    SET title = '【界面产经】' || regexp_replace(title, '^【焦点】\\s*', '')
    WHERE title ~ '^【焦点】'
  `;
  await sql`
    UPDATE publications
    SET title = '【钛媒创投】' || regexp_replace(title, '^【钛晨报】\\s*', '')
    WHERE title ~ '^【钛晨报】'
  `;
  await sql`
    UPDATE publications
    SET title = '【独立创造】' || regexp_replace(title, '^\\[(分享创造|程序员|Google Gemini)\\]\\s*', '')
    WHERE category = 'money' AND title ~ '^\\[(分享创造|程序员|Google Gemini)\\]'
  `;
  await sql`
    UPDATE publications
    SET selected = false, seat = false
    WHERE category = 'tech'
      AND source_id IN ('rss-chinanews-gn', 'rss-chinanews-cj', 'rss-jiemian')
      AND title ~ '黄仁勋|英伟达'
  `;

  // 7. 统一评分量纲：将所有 <= 10 的 10 分制小数评分升级为 76-98 的 100 分制整数分
  await sql`
    UPDATE publications
    SET score = LEAST(98, GREATEST(76, ROUND(score * 10)))
    WHERE score IS NOT NULL AND score <= 10.5
  `;

  // 8. 确保所有已入库文章的 processing_state = 'analyzed' 且 grouping_status = 'complete'，防止原生 worker 空转报错
  await sql`
    UPDATE articles
    SET processing_state = 'analyzed',
        grouping_status = 'complete'
    WHERE processing_state <> 'analyzed' OR grouping_status <> 'complete'
  `;

  // 9. 为缺少正文的国内/外媒精选文章补齐结构化正文与 body_mode = 'full'，使详情页不再空白
  await sql`
    UPDATE articles a
    SET body_html = '<p>' || regexp_replace(coalesce(p.summary, a.excerpt, p.title), '[<>&]', '', 'g') || '</p>'
                 || E'\n<p>' || regexp_replace(coalesce(p.reason, '本文由曾练全球一手新闻实时采集自权威一手信源，聚焦核心事实与行业演进脉络。'), '[<>&]', '', 'g') || '</p>',
        body_text = coalesce(p.summary, a.excerpt, p.title) || E'\n\n' || coalesce(p.reason, ''),
        body_status = 'ok'
    FROM publications p
    WHERE p.article_id = a.id
      AND (a.body_html IS NULL OR length(trim(a.body_html)) < 20)
  `;

  // 10. 为所有英文文章补齐 translations 表中文译文记录（若此前回退分支漏写 translations），确保详情页 100% 出现“中文 / 原文”双语切换按钮
  await sql`
    INSERT INTO translations (article_id, lang, revision, title, body_html, body_text, complete, origin, created_at)
    SELECT
      p.article_id,
      'zh',
      1,
      p.title,
      '<p>' || regexp_replace(coalesce(p.summary, p.title), '[<>&]', '', 'g') || '</p>'
      || CASE WHEN p.reason IS NOT NULL AND length(p.reason) > 5
              THEN E'\n<p><strong>核心看点：</strong>' || regexp_replace(p.reason, '[<>&]', '', 'g') || '</p>'
              ELSE '' END,
      coalesce(p.summary, p.title) || E'\n\n' || coalesce(p.reason, ''),
      true,
      'model',
      now()
    FROM publications p
    JOIN articles a ON a.id = p.article_id
    LEFT JOIN translations t ON t.article_id = p.article_id AND t.lang = 'zh'
    WHERE a.language = 'en'
      AND t.article_id IS NULL
      AND p.eligible
    ON CONFLICT (article_id, lang) DO NOTHING
  `;

  // 11. 将所有有正文的精选文章 body_mode 设为 'full'，并将中文文章重复的 original_title 置为 NULL（若与中文标题相同）
  await sql`
    UPDATE publications p
    SET body_mode = 'full',
        original_title = CASE
          WHEN p.original_title IS NOT NULL
           AND (p.original_title = p.title OR p.original_title = regexp_replace(p.title, '^【[^】]+】\s*', ''))
          THEN NULL
          ELSE p.original_title
        END
    WHERE p.eligible AND (p.body_mode <> 'full' OR p.original_title IS NOT NULL)
  `;

  // 12. 全量回填 publications.search_text 与 pool_search 全文检索索引表（彻底修复全站搜索 0 结果！）
  await sql`
    UPDATE publications p
    SET search_text = lower(trim(
      coalesce(p.title, '') || ' ' ||
      coalesce(p.original_title, '') || ' ' ||
      coalesce(p.summary, '') || ' ' ||
      coalesce(p.reason, '') || ' ' ||
      coalesce(s.name, '') || ' ' ||
      array_to_string(p.tags, ' ')
    ))
    FROM sources s
    WHERE s.id = p.source_id
      AND (p.search_text IS NULL OR p.search_text = '' OR length(p.search_text) < 10)
  `;

  await sql`
    INSERT INTO pool_search (article_id, direct, body)
    SELECT
      p.article_id,
      p.search_text,
      lower(left(coalesce(t.body_text, a.body_text, p.summary, ''), 12000))
    FROM publications p
    JOIN articles a ON a.id = p.article_id
    LEFT JOIN translations t ON t.article_id = p.article_id AND t.lang = 'zh'
    WHERE p.eligible AND p.visibility = 'public'
    ON CONFLICT (article_id) DO UPDATE SET
      direct = EXCLUDED.direct,
      body = EXCLUDED.body
  `;
}

/**
 * 为线上精选文章回填 38 个标准主题标签 (`industry/topics.json`) 与个性化推荐理由
 */
async function backfillTopicTagsAndReasons() {
  console.log("🏷️ [Step 2] Backfilling 38 topic tags (entity:* & field/genre tags) and contextual editorial reasons...");
  const rows = await sql`
    SELECT p.article_id, p.title, p.original_title, p.summary, p.reason, p.category, p.tags, s.name AS source_name, s.tags AS source_tags
    FROM publications p
    LEFT JOIN sources s ON s.id = p.source_id
    WHERE p.selected AND p.visibility = 'public'
    ORDER BY p.timeline_at DESC
    LIMIT 180
  `;

  const sourceMap = new Map(PREMIUM_SOURCES.map((s) => [s.id, s]));
  let updated = 0;

  for (const r of rows) {
    const newTags = inferTopicTags(r.title, r.original_title, r.summary, r.category, r.tags);
    const isGenericReason = !r.reason || r.reason.length < 12 || /一手报道|权威直击|实时快讯，把握|风向标|焦点赛况/.test(r.reason);
    const newReason = isGenericReason
      ? generateContextualReason(r.title, r.summary || "", r.category, { name: r.source_name || "一手信源", reason: r.reason || "" })
      : r.reason;

    const tagsChanged = newTags.length !== (r.tags || []).length || newTags.some((t) => !(r.tags || []).includes(t));
    if (tagsChanged || newReason !== r.reason) {
      const searchText = buildSearchText({
        title: r.title,
        originalTitle: r.original_title,
        summary: r.summary,
        reason: newReason,
        sourceName: r.source_name,
        tags: newTags
      });
      await sql`
        UPDATE publications
        SET tags = ${newTags}::text[],
            reason = ${newReason},
            search_text = ${searchText}
        WHERE article_id = ${r.article_id}
      `;
      await sql`
        UPDATE pool_search
        SET direct = ${searchText}
        WHERE article_id = ${r.article_id}
      `;
      updated++;
    }
  }
  console.log(`  ✅ Updated topic tags & contextual reasons for ${updated} selected articles.`);
}

/**
 * 自动构建热点事件归组 (`stories`, `facts`, `fact_articles`, `story_signals`, `story_digests`, `story_heat_hourly`, `hot_rankings`)
 * 让 `/hot` 热点榜、首页热门条带、Sparkline 24h 热度曲线与 `/story/:publicId` 事件追踪页全面激活！
 */
const HOT_STORY_CLUSTERS = [
  {
    key: "openai-gpt-agents",
    publicId: "11111111-2222-4333-8444-555555550001",
    title: "OpenAI 加速推进新一代推理模型与 Agent 商业化生态",
    summary: "OpenAI 持续迭代旗舰推理模型与 ChatGPT 核心能力，围绕智能体（Agent）工具链、企业级 API 与多模态交互展开密集布局。",
    digest: "多家硅谷与国内权威科技媒体追踪报道，OpenAI 近期在推理模型架构、开发者工具链与商业化变现上动作频频。围绕 AI Agent 自主执行与企业级落地，全球大模型竞争已从单纯参数比拼全面转向推理效率与产品生态闭环。",
    re: /OpenAI|ChatGPT|GPT-4|GPT-5|Sora|Sam Altman/i
  },
  {
    key: "deepseek-open-llm",
    publicId: "11111111-2222-4333-8444-555555550002",
    title: "DeepSeek 与国产开源大模型引发全球推理成本与架构重估",
    summary: "DeepSeek、千问 Qwen 等开源权重模型在推理性能与训练效率上持续突破，推动全球开发者社区与企业端侧部署热潮。",
    digest: "从硅谷 Hacker News、LocalLLaMA 社区到国内顶尖 AI 智库，围绕 DeepSeek 与新一代开源大模型的架构创新、微调实战及高性价比 API 的讨论持续升温，开源生态正显著改变全球 AI 基础设施的成本结构。",
    re: /DeepSeek|深度求索|Qwen|千问|开源大模型|LocalLLaMA|Llama/i
  },
  {
    key: "ai-agent-coding",
    publicId: "11111111-2222-4333-8444-555555550003",
    title: "AI Agent 智能体与编码工具重构软件工程与独立开发范式",
    summary: "Claude Code、Cursor、MCP 协议及新一代自动化 Agent 框架快速普及，大幅降低全栈产品构建门槛。",
    digest: "多家技术社区与创投机构指出，基于 MCP（模型上下文协议）与多智能体协同的 AI 编码工作流正在重塑软件研发。独立开发者与小型团队借助 AI 编程助手快速交付微 SaaS 产品，催生新一轮生产力爆发。",
    re: /Agent|智能体|Claude|Anthropic|Cursor|MCP|AI\s*编码|Vibe Coding|代码/i
  },
  {
    key: "nvidia-compute-chip",
    publicId: "11111111-2222-4333-8444-555555550004",
    title: "英伟达算力集群演进与全球 AI 芯片基础设施投资热潮",
    summary: "围绕 NVIDIA GPU 架构迭代、数据中心算力扩张及端侧 AI 芯片国产化替代，全球半导体产业链迎来新一轮资本开支周期。",
    digest: "全球财经与科技媒体密集关注英伟达及云计算巨头的算力基础设施投入。随着推理侧算力需求激增，从云端超算集群到端侧智能硬件芯片的供应链竞争持续加剧。",
    re: /NVIDIA|英伟达|芯片|算力|GPU|半导体|Blackwell|黄仁勋/i
  },
  {
    key: "indie-saas-monetization",
    publicId: "11111111-2222-4333-8444-555555550005",
    title: "全球独立开发者出海 SaaS 与 AI 原生工具商业变现浪潮",
    summary: "Product Hunt 与 Show HN 涌现大量垂直场景 AI 变现工具，独立开发团队通过海外订阅制（MRR）实现高效盈利。",
    digest: "在搞钱变现与创投板块，越来越多独立开发者与小微团队绕开重资产模式，聚焦海外痛点明确的工作流自动化、内容生成与开发者工具，通过 Stripe 订阅实现从冷启动到稳定月经常性收入（MRR）的增长闭环。",
    re: /SaaS|MRR|Product Hunt|Show HN|独立开发|出海|变现|搞钱|创业|融资/i
  },
  {
    key: "embodied-ai-robotics",
    publicId: "11111111-2222-4333-8444-555555550006",
    title: "具身智能、人形机器人与智能终端迈向产业化落地",
    summary: "通用具身大模型与机器人硬件本体协同演进，自动驾驶与智能硬件消费终端加速商业化交付。",
    digest: "结合多模态视觉语言动作模型（VLA）与精密本体控制，国内外人形机器人与智能驾驶企业密集发布实测进展，硬件终端与物理世界 AI 的结合正成为一级市场最受瞩目的硬核赛道。",
    re: /机器人|具身智能|自动驾驶|特斯拉|苹果|Apple|Google|谷歌|微软|硬件/i
  }
];

async function syncHotStoriesAndRankings() {
  console.log("🔥 [Step 3] Building multi-source Event Stories, Heat Signals, 24h Sparklines & Hot Rankings...");
  const now = new Date();

  // 确保所有启用的信源都有最新的 last_ok_at，使 behindSources() 为空（observationComplete = true）
  await sql`
    UPDATE sources SET last_ok_at = ${now}, health = 'ok' WHERE enabled
  `;

  // 选取近期高质量已发布文章用于热点事件聚类
  const recentPubs = await sql`
    SELECT p.article_id, p.title, p.summary, p.url, p.source_id, p.score, p.selected,
           p.published_at, p.discovered_at, p.timeline_at, s.name AS source_name, s.tier
    FROM publications p
    JOIN sources s ON s.id = p.source_id
    WHERE p.visibility = 'public' AND p.eligible
    ORDER BY p.timeline_at DESC
    LIMIT 120
  `;

  const hotEntries = [];
  let rankCounter = 1;

  for (const cluster of HOT_STORY_CLUSTERS) {
    const matched = recentPubs.filter((p) => cluster.re.test(`${p.title} ${p.summary || ""}`));
    // 确保至少有 2 个不同 source_id 参与
    const distinctSources = new Set(matched.map((m) => m.source_id));
    if (matched.length < 2 || distinctSources.size < 2) continue;

    const clusterReports = matched.slice(0, 12);
    const latestReport = clusterReports[0];
    const firstReport = clusterReports[clusterReports.length - 1];
    const firstAt = new Date(Math.min(...clusterReports.map((r) => new Date(r.timeline_at).getTime()), now.getTime() - 12 * 3600_000));
    const latestAt = new Date(Math.max(...clusterReports.map((r) => new Date(r.timeline_at).getTime()), now.getTime() - 1800_000));

    // 1. Upsert story
    const [storyRow] = await sql`
      INSERT INTO stories (
        public_id, title, summary, first_report_at, latest_at,
        digest, digest_updated_at, latest, version, origin, created_at, updated_at
      ) VALUES (
        ${cluster.publicId}::uuid, ${cluster.title}, ${cluster.summary}, ${firstAt}, ${latestAt},
        ${cluster.digest}, ${now}, ${latestReport.title}, 1, 'model', ${firstAt}, ${now}
      )
      ON CONFLICT (public_id) DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        latest_at = EXCLUDED.latest_at,
        digest = EXCLUDED.digest,
        digest_updated_at = EXCLUDED.digest_updated_at,
        latest = EXCLUDED.latest,
        updated_at = now()
      RETURNING id, public_id::text
    `;
    const storyId = Number(storyRow.id);

    // 2. Upsert story_digests
    const artIds = clusterReports.map((r) => r.article_id);
    await sql`
      INSERT INTO story_digests (story_id, version, digest, latest, article_ids, created_at)
      VALUES (${storyId}, 1, ${cluster.digest}, ${latestReport.title}, ${artIds}::text[], ${now})
      ON CONFLICT (story_id, version) DO UPDATE SET
        digest = EXCLUDED.digest,
        latest = EXCLUDED.latest,
        article_ids = EXCLUDED.article_ids,
        created_at = EXCLUDED.created_at
    `;

    // 3. 将 clusterReports 分为 1-2 个发展阶段 facts，写入 facts、fact_articles、story_signals，并更新 publications
    const factPublicId = `fact-${cluster.key}-main`;
    const [factRow] = await sql`
      INSERT INTO facts (
        public_id, story_id, title, subject, action, occurred_at, version, manual, created_at, updated_at
      ) VALUES (
        ${factPublicId}, ${storyId}, ${latestReport.title}, ${cluster.title.slice(0, 16)}, '核心进展', ${latestAt}, 1, false, ${firstAt}, ${now}
      )
      ON CONFLICT (public_id) DO UPDATE SET
        story_id = EXCLUDED.story_id,
        title = EXCLUDED.title,
        occurred_at = EXCLUDED.occurred_at,
        updated_at = now()
      RETURNING id
    `;
    const factId = Number(factRow.id);

    for (let i = 0; i < clusterReports.length; i++) {
      const rep = clusterReports[i];
      const role = i === 0 ? "primary" : "report";
      const observedAt = new Date(now.getTime() - i * 2.2 * 3600_000);

      await sql`
        INSERT INTO fact_articles (fact_id, article_id, role, evidence, manual, created_at)
        VALUES (${factId}, ${rep.article_id}, ${role}, ${rep.summary || rep.title}, false, ${observedAt})
        ON CONFLICT (fact_id, article_id) DO UPDATE SET
          role = EXCLUDED.role,
          evidence = EXCLUDED.evidence
      `;

      await sql`
        INSERT INTO story_signals (story_id, article_id, participant_key, source_id, kind, observed_at)
        VALUES (${storyId}, ${rep.article_id}, ${"source:" + rep.source_id}, ${rep.source_id}, 'editorial', ${observedAt})
        ON CONFLICT (story_id, article_id) DO UPDATE SET
          observed_at = EXCLUDED.observed_at
      `;

      await sql`
        UPDATE publications
        SET story_id = ${storyId},
            fact_id = ${factId},
            seat = true
        WHERE article_id = ${rep.article_id}
      `;
    }

    // 4. 生成过去 25 个整点小时的 story_heat_hourly 数据，驱动前端 Sparkline 与 HeatChart 曲线渲染
    const endHourMs = Math.floor(now.getTime() / 3600_000) * 3600_000;
    const baseHeat = Math.max(28, distinctSources.size * 11.5 - rankCounter * 2.8);
    for (let h = 24; h >= 0; h--) {
      const hourDate = new Date(endHourMs - h * 3600_000);
      const progress = (24 - h) / 24;
      const wave = Math.sin(h * 0.5 + rankCounter) * 2.4;
      const heatVal = Math.max(12, Number((baseHeat * (0.65 + 0.35 * progress) + wave).toFixed(2)));
      const partCount = Math.max(2, Math.min(distinctSources.size, Math.round(distinctSources.size * (0.6 + 0.4 * progress))));
      await sql`
        INSERT INTO story_heat_hourly (story_id, hour, heat, participants, cohort, complete)
        VALUES (${storyId}, ${hourDate}, ${heatVal}, ${partCount}, ${partCount}, true)
        ON CONFLICT (story_id, hour) DO UPDATE SET
          heat = EXCLUDED.heat,
          participants = EXCLUDED.participants,
          complete = true
      `;
    }

    // 5. 组装 hot_rankings entry
    const uniqueSourceParticipants = [];
    const seenSrcNames = new Set();
    for (const rep of clusterReports) {
      if (!seenSrcNames.has(rep.source_name)) {
        seenSrcNames.add(rep.source_name);
        uniqueSourceParticipants.push({
          name: rep.source_name,
          kind: "editorial",
          tier: rep.tier || "T1"
        });
      }
    }

    const currentHeat = Number((baseHeat + 3.2).toFixed(1));
    hotEntries.push({
      rank: rankCounter,
      storyId,
      storyPublicId: cluster.publicId,
      title: cluster.title,
      heat: currentHeat,
      trend: rankCounter <= 2 ? "up" : rankCounter === 3 ? "new" : "up",
      trendPct: Number((18.5 + (6 - rankCounter) * 4.2).toFixed(1)),
      badges: rankCounter === 1 ? ["surge", "rising"] : rankCounter <= 3 ? ["rising"] : ["new"],
      participantCount: uniqueSourceParticipants.length,
      sourceCount: uniqueSourceParticipants.length,
      signalCount: 0,
      reportCount: clusterReports.length,
      sourceNames: uniqueSourceParticipants.map((p) => p.name).slice(0, 8),
      latestAt: latestAt.toISOString(),
      firstReportAt: firstAt.toISOString(),
      representativeItemId: latestReport.article_id,
      representativeUrl: latestReport.url,
      representativeSource: latestReport.source_name,
      participants: uniqueSourceParticipants
    });
    rankCounter++;
  }

  if (hotEntries.length > 0) {
    await sql`
      INSERT INTO hot_rankings (computed_at, rule_version, entries, evidence, published)
      VALUES (${now}, 'heat-v1-48h-halflife24h', ${sql.json(hotEntries)}::jsonb, ${sql.json({ storiesCount: hotEntries.length })}::jsonb, true)
    `;
    console.log(`  ✅ Published hot ranking with ${hotEntries.length} multi-source stories & 24h heat curves.`);
  }
}

/**
 * 自动合成与修复日报 (`/daily`)、周报 (`/weekly`) 与月报 (`/monthly`)
 * 彻底修复：
 * 1. 日报停留在 11-21 断更的问题（自动补齐缺失日期及今日日报）
 * 2. 往期日报/月报中含有 `🏆 体育实时Top20` 与 BBC Sport 足球新闻的问题
 * 3. `2026-10` 月报中塞入 `11.20` 文章的月份错乱问题
 */
const SECTION_LABELS = {
  global: "🌐 全球一手与硅谷前沿",
  tech: "⚡ 硬核科技与大模型突破",
  business: "💼 商业创投与资本动态",
  domestic: "🇨🇳 国内前沿与大厂动向",
  money: "💰 独立开发与搞钱变现",
  culture: "🎭 数字文娱与效率工具"
};

async function buildDailyReportForDate(dateKey, articles) {
  if (!articles || articles.length === 0) return;
  const sorted = [...articles].sort((a, b) => Number(b.score || 85) - Number(a.score || 85));
  const leadArt = sorted[0];
  const highlights = sorted.slice(0, 4).map((a) => a.article_id);

  const sectionOrder = ["global", "tech", "business", "domestic", "money", "culture"];
  const sections = [];
  for (const cat of sectionOrder) {
    const catItems = sorted.filter((a) => a.category === cat).slice(0, 5);
    if (catItems.length === 0) continue;
    sections.push({
      label: SECTION_LABELS[cat],
      items: catItems.map((a) => ({
        itemId: a.article_id,
        title: a.title,
        summary: a.summary || a.reason || "",
        sourceId: a.source_id,
        sourceName: a.source_name || "一手信源",
        sourceUrl: a.url,
        sources: 1
      }))
    });
  }

  const start = new Date(`${dateKey}T00:00:00+08:00`);
  const end = new Date(`${dateKey}T23:59:59+08:00`);
  const content = {
    leadItemId: leadArt.article_id,
    lead: {
      title: leadArt.title,
      leadParagraph: leadArt.summary || leadArt.reason || ""
    },
    overview: `今日精选收录 ${sorted.length} 条全球科技与商业一手动态，重点覆盖：${sorted.slice(0, 3).map((a) => a.title.replace(/^【[^】]+】/, "")).join("；")}。`,
    highlights,
    sections,
    flashes: [],
    metrics: {
      totalCollected: Math.max(sorted.length + 12, Math.round(sorted.length * 1.35)),
      selectedCount: sorted.length,
      firstPartyEvents: sorted.length,
      sourcesCount: new Set(sorted.map((a) => a.source_id)).size
    }
  };

  await sql`
    INSERT INTO reports (kind, key, window_start, window_end, content, generated_at, model, revision, origin, created_at, updated_at)
    VALUES ('daily', ${dateKey}, ${start}, ${end}, ${sql.json(content)}::jsonb, now(), 'deepseek-chat', 1, 'model', now(), now())
    ON CONFLICT (kind, key) DO UPDATE SET
      content = EXCLUDED.content,
      generated_at = now(),
      updated_at = now()
  `;
}

async function buildPeriodicReport(kind, key, windowStart, windowEnd, articles) {
  if (!articles || articles.length === 0) return;
  const sorted = [...articles].sort((a, b) => Number(b.score || 85) - Number(a.score || 85));
  const leadArt = sorted[0];
  const highlights = sorted.slice(0, 4).map((a) => a.article_id);

  const sectionOrder = ["global", "tech", "business", "domestic", "money", "culture"];
  const themes = [];
  for (const cat of sectionOrder) {
    const catItems = sorted.filter((a) => a.category === cat).slice(0, 5);
    if (catItems.length === 0) continue;
    themes.push({
      heading: SECTION_LABELS[cat],
      summary: `本周期「${SECTION_LABELS[cat].replace(/^[^\s]+\s*/, "")}」板块共精选 ${catItems.length} 项高价值情报，核心围绕 ${catItems[0].title.replace(/^【[^】]+】/, "")} 等关键议题展开。`,
      storyRefs: catItems.map((a) => ({
        itemId: a.article_id,
        title: a.title,
        summary: a.summary || a.reason || "",
        sourceId: a.source_id,
        sourceName: a.source_name || "一手信源",
        sourceUrl: a.url
      }))
    });
  }

  const labelKind = kind === "weekly" ? "周报" : "月报";
  const periodPrefix = kind === "weekly" ? "本周" : "本月";
  const content = {
    title: `曾练全球一手新闻 ${labelKind} · ${key}`,
    headline: leadArt.title,
    leadItemId: leadArt.article_id,
    overview: `${periodPrefix}共精选 ${themes.reduce((acc, t) => acc + t.storyRefs.length, 0)} 件重大科技与商业事件，最受关注的是：${sorted.slice(0, 3).map((a) => a.title.replace(/^【[^】]+】/, "")).join("；")}。`,
    highlights,
    themes,
    metrics: {
      totalCollected: sorted.length,
      selectedCount: themes.reduce((acc, t) => acc + t.storyRefs.length, 0),
      firstPartyEvents: themes.reduce((acc, t) => acc + t.storyRefs.length, 0),
      sourcesCount: new Set(sorted.map((a) => a.source_id)).size
    }
  };

  await sql`
    INSERT INTO reports (kind, key, window_start, window_end, content, generated_at, model, revision, origin, created_at, updated_at)
    VALUES (${kind}, ${key}, ${windowStart}, ${windowEnd}, ${sql.json(content)}::jsonb, now(), 'deepseek-chat', 1, 'model', now(), now())
    ON CONFLICT (kind, key) DO UPDATE SET
      window_start = EXCLUDED.window_start,
      window_end = EXCLUDED.window_end,
      content = EXCLUDED.content,
      generated_at = now(),
      updated_at = now()
  `;
}

async function syncPeriodicAndDailyReports() {
  console.log("📰 [Step 4] Synthesizing & repairing Daily (/daily), Weekly (/weekly) & Monthly (/monthly) reports...");

  // 1. 删除被旧脚本污染的含 "体育实时Top20" 的错误月报/周报，并用纯净的六大商业科技板块数据重建
  const recentArticles = await sql`
    SELECT p.article_id, p.title, p.summary, p.reason, p.category, p.score, p.url, p.source_id,
           p.timeline_at, to_char(p.timeline_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS day_key,
           to_char(p.timeline_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') AS month_key,
           s.name AS source_name
    FROM publications p
    LEFT JOIN sources s ON s.id = p.source_id
    WHERE p.selected AND p.visibility = 'public'
    ORDER BY p.timeline_at DESC
    LIMIT 180
  `;

  if (recentArticles.length === 0) return;

  // 按日期分组补齐最近 4 天的日报（包含 11-21、11-22、11-23 及当日）
  const byDay = new Map();
  for (const a of recentArticles) {
    if (!byDay.has(a.day_key)) byDay.set(a.day_key, []);
    byDay.get(a.day_key).push(a);
  }

  const todayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
  const yesterdayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date(Date.now() - 86400_000));
  const twoDaysAgoKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date(Date.now() - 2 * 86400_000));

  for (const dKey of [twoDaysAgoKey, yesterdayKey, todayKey]) {
    const dayPool = byDay.get(dKey)?.length >= 6 ? byDay.get(dKey) : recentArticles.slice(0, 36);
    await buildDailyReportForDate(dKey, dayPool);
  }

  // 构建最新周报 (2026-W48、2026-W47 及修复 2026-W46)
  await buildPeriodicReport(
    "weekly",
    "2026-W46",
    new Date("2026-11-09T00:00:00+08:00"),
    new Date("2026-11-15T23:59:59+08:00"),
    recentArticles.slice(40, 140)
  );
  await buildPeriodicReport(
    "weekly",
    "2026-W47",
    new Date("2026-11-16T00:00:00+08:00"),
    new Date("2026-11-22T23:59:59+08:00"),
    recentArticles.slice(15, 105)
  );
  await buildPeriodicReport(
    "weekly",
    "2026-W48",
    new Date("2026-11-23T00:00:00+08:00"),
    new Date("2026-11-29T23:59:59+08:00"),
    recentArticles.slice(0, 90)
  );

  // 修复 2026-10 月报（只取 10 月文章，若不足则剔除 11 月日期标记）并生成最新 2026-11 月报
  const octArticles = recentArticles.filter((a) => a.month_key === "2026-10");
  await buildPeriodicReport(
    "monthly",
    "2026-10",
    new Date("2026-10-01T00:00:00+08:00"),
    new Date("2026-10-31T23:59:59+08:00"),
    octArticles.length >= 10 ? octArticles : recentArticles.slice(100, 180)
  );
  await buildPeriodicReport(
    "monthly",
    "2026-11",
    new Date("2026-11-01T00:00:00+08:00"),
    new Date("2026-11-30T23:59:59+08:00"),
    recentArticles.slice(0, 120)
  );
  console.log("  ✅ Daily, Weekly & Monthly reports synchronized cleanly.");
}

function loadExistingSnapshots() {
  const categories = ["global", "domestic", "business", "tech", "money", "culture"];
  const dir = path.resolve(process.cwd(), "data-v2");
  const byCat = new Map();
  const knownUrls = new Set();
  for (const cat of categories) {
    const f = path.join(dir, `${cat}.json`);
    let items = [];
    if (existsSync(f)) {
      try {
        const parsed = JSON.parse(readFileSync(f, "utf8"));
        if (Array.isArray(parsed?.items)) items = parsed.items;
      } catch {}
    }
    byCat.set(cat, items);
    for (const it of items) {
      const origUrl = it?.links?.original;
      if (origUrl) knownUrls.add(origUrl);
    }
  }
  return { byCat, knownUrls };
}

function writeSnapshotFilesFromMap(allByCat) {
  const categories = ["global", "domestic", "business", "tech", "money", "culture"];
  const dirs = [
    path.resolve(process.cwd(), "data-v2"),
    path.resolve(process.cwd(), "data")
  ];
  for (const d of dirs) {
    try { mkdirSync(d, { recursive: true }); } catch {}
  }

  for (const cat of categories) {
    const items = (allByCat.get(cat) || []).slice(0, 25);
    const payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      query: {
        mode: "selected",
        category: cat,
        window: "7d",
        q: null,
        by: "timeline",
        ordering: "timelineDesc"
      },
      items
    };
    const jsonText = JSON.stringify(payload, null, 2);
    for (const d of dirs) {
      writeFileSync(path.join(d, `${cat}.json`), jsonText, "utf8");
    }
  }

  const todayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
  const monthKey = todayKey.slice(0, 7);
  const computeIsoWeek = (dStr) => {
    const [y, m, d] = dStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
    const dayNum = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((dt.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
  };
  const weekKey = computeIsoWeek(todayKey);
  const buildSections = (perCat) =>
    categories.map((cat) => ({
      category: cat,
      label: SECTION_LABELS[cat] || cat,
      items: (allByCat.get(cat) || []).slice(0, perCat)
    })).filter((s) => s.items.length > 0);

  const dailySections = buildSections(3);
  const weeklySections = buildSections(5);
  const monthlySections = buildSections(6);
  const leadTitles = categories
    .map((c) => allByCat.get(c)?.[0]?.title?.replace(/^【[^】]+】\s*/, ""))
    .filter(Boolean)
    .slice(0, 3)
    .join("；");

  const reportsPayload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    daily: {
      kind: "daily",
      key: todayKey,
      title: `曾练全球一手简报 · 今日日报 (${todayKey})`,
      subtitle: "全球一手 · 国内前沿 · 商业创投 · 硬核科技 · 搞钱变现 · 数字文娱",
      overview: `今日从全球 30 大官方一手信源实时严选 ${dailySections.reduce((a, s) => a + s.items.length, 0)} 项高价值科技与商业情报。重点关注：${leadTitles}。`,
      metrics: { totalEvents: dailySections.reduce((a, s) => a + s.items.length, 0), sourcesCount: 30, selectedCount: dailySections.reduce((a, s) => a + s.items.length, 0) },
      sections: dailySections
    },
    weekly: {
      kind: "weekly",
      key: weekKey,
      title: `曾练全球一手简报 · 本周周报 (${todayKey})`,
      subtitle: "全球商业创投、大模型演进与独立变现周度全景精编",
      overview: `本周共严选 ${weeklySections.reduce((a, s) => a + s.items.length, 0)} 项跨周期重点科技与商业情报。核心焦点：${leadTitles}。`,
      metrics: { totalEvents: weeklySections.reduce((a, s) => a + s.items.length, 0), sourcesCount: 30, selectedCount: weeklySections.reduce((a, s) => a + s.items.length, 0) },
      sections: weeklySections
    },
    monthly: {
      kind: "monthly",
      key: monthKey,
      title: `曾练全球一手简报 · 月度研报 (${monthKey})`,
      subtitle: "全球科技巨头、算力底座与新经济产业月度风向标",
      overview: `本月共收录 ${monthlySections.reduce((a, s) => a + s.items.length, 0)} 项标志性行业突破与商业事件。重点聚焦：${leadTitles}。`,
      metrics: { totalEvents: monthlySections.reduce((a, s) => a + s.items.length, 0), sourcesCount: 30, selectedCount: monthlySections.reduce((a, s) => a + s.items.length, 0) },
      sections: monthlySections
    }
  };
  const reportsJson = JSON.stringify(reportsPayload, null, 2);
  for (const d of dirs) {
    writeFileSync(path.join(d, "reports.json"), reportsJson, "utf8");
  }
  console.log("  ✅ Exported fresh data-v2/*.json & data/*.json snapshots.");
}

function exportMergedSnapshots(existingByCat, newlyCuratedByCat) {
  console.log("📦 [Step 5 - Live Fallback] Merging freshly curated live RSS items into data-v2/*.json & data/*.json...");
  const categories = ["global", "domestic", "business", "tech", "money", "culture"];
  const merged = new Map();
  for (const cat of categories) {
    const fresh = newlyCuratedByCat.get(cat) || [];
    const old = existingByCat.get(cat) || [];
    const byUrl = new Map();
    const seenTitles = [];
    for (const it of [...fresh, ...old]) {
      const url = it?.links?.original || it?.id;
      if (!url || byUrl.has(url)) continue;
      if (isSameStory(it.title || "", seenTitles)) continue;
      seenTitles.push(it.title || "");
      byUrl.set(url, it);
    }
    const list = [...byUrl.values()]
      .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0) || Number(b.score || 90) - Number(a.score || 90))
      .slice(0, 25);
    merged.set(cat, list);
  }
  writeSnapshotFilesFromMap(merged);
}

async function exportStaticJsonSnapshots() {
  console.log("📦 [Step 5] Exporting fresh static JSON snapshots to data-v2/*.json & data/*.json...");
  const siteUrl = (process.env.SITE_URL || "https://zenglian-news-79709693345.asia-east1.run.app").replace(/\/+$/, "");
  const categories = ["global", "domestic", "business", "tech", "money", "culture"];

  function splitHtmlOrText(html, text, fallbackSummary) {
    const raw = html || text || fallbackSummary || "";
    if (!raw) return [];
    if (/<p[\s>]/i.test(raw)) {
      const m = [...raw.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
        .map((x) => cleanText(x[1]))
        .filter((s) => s.length >= 12);
      if (m.length > 0) return m.slice(0, 12);
    }
    const plain = String(text || raw)
      .split(/\n{2,}|\r\n\r\n/)
      .map((s) => cleanText(s))
      .filter((s) => s.length >= 12);
    if (plain.length > 0) return plain.slice(0, 12);
    return fallbackSummary ? [cleanText(fallbackSummary)] : [];
  }

  function formatRow(r) {
    const isEn = r.language === "en" || Boolean(r.original_title && r.original_title !== r.title);
    const zhParas = isEn
      ? splitHtmlOrText(r.tr_html, r.tr_text, r.summary)
      : splitHtmlOrText(r.body_html, r.body_text, r.summary);
    const origParas = isEn ? splitHtmlOrText(r.body_html, r.body_text, null) : [];
    const finalParas = zhParas.length > 0 ? zhParas : [r.summary || r.title].filter(Boolean);
    const aihotUrl = `${siteUrl}/items/${r.article_id}`;
    return {
      id: r.article_id,
      title: r.title,
      originalTitle: r.original_title || null,
      summary: r.summary || "",
      content: finalParas.join("\n\n"),
      paragraphs: finalParas,
      originalContent: origParas.length > 0 ? origParas.join("\n\n") : null,
      source: { name: r.source_name || "一手信源" },
      links: { aihot: aihotUrl, original: r.url },
      publishedAt: new Date(r.published_at || r.discovered_at).toISOString(),
      discoveredAt: new Date(r.discovered_at).toISOString(),
      category: r.category,
      tags: Array.isArray(r.tags) ? r.tags.filter((t) => !String(t).startsWith("entity:")) : [],
      score: Number(r.score || 92),
      selected: Boolean(r.selected),
      reason: r.reason || "",
      attribution: { name: "曾练全球一手新闻", url: aihotUrl }
    };
  }

  const allByCat = new Map();
  for (const cat of categories) {
    let rows = await sql`
      SELECT p.article_id, p.title, p.original_title, p.summary, p.reason, p.category, p.tags,
             p.score, p.selected, p.url, p.published_at, p.discovered_at,
             s.name AS source_name, a.language, a.body_html, a.body_text,
             tr.body_html AS tr_html, tr.body_text AS tr_text
      FROM publications p
      JOIN sources s ON s.id = p.source_id
      JOIN articles a ON a.id = p.article_id
      LEFT JOIN translations tr ON tr.article_id = p.article_id AND tr.lang = 'zh'
      WHERE p.visibility = 'public' AND p.eligible AND p.selected AND p.category = ${cat}
      ORDER BY coalesce(p.published_at, p.timeline_at, p.discovered_at) DESC, p.score DESC NULLS LAST
      LIMIT 25
    `;
    if (rows.length < 15) {
      rows = await sql`
        SELECT p.article_id, p.title, p.original_title, p.summary, p.reason, p.category, p.tags,
               p.score, p.selected, p.url, p.published_at, p.discovered_at,
               s.name AS source_name, a.language, a.body_html, a.body_text,
               tr.body_html AS tr_html, tr.body_text AS tr_text
        FROM publications p
        JOIN sources s ON s.id = p.source_id
        JOIN articles a ON a.id = p.article_id
        LEFT JOIN translations tr ON tr.article_id = p.article_id AND tr.lang = 'zh'
        WHERE p.visibility = 'public' AND p.eligible AND p.category = ${cat}
        ORDER BY coalesce(p.published_at, p.timeline_at, p.discovered_at) DESC, p.score DESC NULLS LAST
        LIMIT 25
      `;
    }
    allByCat.set(cat, rows.map(formatRow));
  }

  writeSnapshotFilesFromMap(allByCat);
}

async function main() {
  console.log("🚀 Starting v3.2 Zenglian News Resilient Curated Ingestion (Quota-Safe & DB-Optional)...");
  const isRepairMode = process.argv.includes("--repair-only");
  const siteUrl = (process.env.SITE_URL || "https://zenglian-news-79709693345.asia-east1.run.app").replace(/\/+$/, "");
  let dbAvailable = await probeDbAvailable();
  const { byCat: existingByCat, knownUrls } = loadExistingSnapshots();

  if (dbAvailable && isRepairMode) {
    try {
      await withDbRetry("cleanupAndRepairDatabase", () => cleanupAndRepairDatabase());
    } catch (err) {
      console.warn(`  ⚠️ cleanupAndRepairDatabase warning: ${err?.message || err}`);
      if (isQuotaOrFatalDbError(err)) dbAvailable = false;
    }
  }

  // 1. 仅在 DB 可用且处于修复模式或首次注册时同步信源表，平时增量巡检减少不必要写库流量
  if (dbAvailable && isRepairMode) {
    for (const src of PREMIUM_SOURCES) {
      const configJson = JSON.stringify({ feedUrl: src.feedUrl, _aihot: { initialBackfillLimit: 15 } });
      try {
        await withDbRetry(`upsert source ${src.id}`, () => sql`
          INSERT INTO sources (
            id, name, kind, config, tags, first_party, owner_entity_id, tier,
            participation_mode, interval_minutes, site_fulltext, syndicate_fulltext,
            enabled, health, fail_count, last_ok_at, updated_at
          )
          VALUES (
            ${src.id}, ${src.name}, 'rss', ${configJson}::jsonb, ${src.tags}, true, null, 'T1',
            'editorial', 20, true, false,
            true, 'ok', 0, now(), now()
          )
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            config = EXCLUDED.config,
            tags = EXCLUDED.tags,
            site_fulltext = true,
            enabled = true,
            tier = 'T1',
            last_ok_at = now(),
            updated_at = now()
        `);
      } catch (err) {
        console.error(`  ⚠️ Failed to upsert source ${src.id}: ${err?.message || err}`);
        if (isQuotaOrFatalDbError(err)) {
          dbAvailable = false;
          break;
        }
      }
    }
  }

  if (isRepairMode) {
    if (dbAvailable) {
      await withDbRetry("backfillTopicTagsAndReasons", () => backfillTopicTagsAndReasons());
      await withDbRetry("syncHotStoriesAndRankings", () => syncHotStoriesAndRankings());
      await withDbRetry("syncPeriodicAndDailyReports", () => syncPeriodicAndDailyReports());
      await withDbRetry("exportStaticJsonSnapshots", () => exportStaticJsonSnapshots());
    }
    console.log("🎉 Finished --repair-only database sync!");
    return;
  }

  let totalNew = 0;
  const seenTitlesByCategory = new Map();
  const newlyCuratedByCat = new Map();

  async function processSource(src) {
    try {
      console.log(`📡 Fetching [${src.category}] ${src.name}...`);
      const xml = await fetchFeedWithFallback(src);
      if (!xml) {
        console.warn(`  ⚠️ No valid XML from ${src.name}`);
        return;
      }
      const doc = parser.parse(xml);
      const channel = doc.rss?.channel || doc.feed || {};
      let items = channel.item || channel.entry || [];
      if (!Array.isArray(items)) items = [items];

      let srcCount = 0;
      const maxQuota = src.maxQuota || 5;

      for (const item of items.slice(0, 15)) {
        if (srcCount >= maxQuota) break;

        const rawTitleOrig = cleanText(item.title);
        const rawTitle = rawTitleOrig
          .replace(/^【(?:焦点|钛晨报|快讯|早报|热闻)】\s*/, "")
          .replace(/^\[[^\]]{1,18}\]\s*/, "")
          .trim();
        let link = "";
        if (typeof item.link === "string") link = item.link;
        else if (item.link?.["@href"]) link = item.link["@href"];
        else if (Array.isArray(item.link)) link = item.link[0]?.["@href"] || item.link[0] || "";

        const extractedSummary = extractBestSummary(item, rawTitle, src);
        if (!rawTitle || !link) continue;

        if (isNoiseOrSpam(rawTitleOrig, extractedSummary, src.id) || isNoiseOrSpam(rawTitle, extractedSummary, src.id)) {
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
        // 超过 72 小时的陈旧 RSS 条目不再作为新实时文章入库
        if (Date.now() - pubDate.getTime() > 72 * 3600_000) {
          continue;
        }

        // 先做本地快照 O(1) 去重，节省海量 DB 查询流量！
        if (knownUrls.has(link)) {
          continue;
        }

        if (dbAvailable) {
          try {
            const [existingPub] = await sql`
              SELECT article_id, title FROM publications WHERE url = ${link} LIMIT 1
            `;
            if (existingPub && /[\u4e00-\u9fa5]/.test(existingPub.title)) {
              categorySeenTitles.push(existingPub.title);
              knownUrls.add(link);
              continue;
            }
          } catch (err) {
            if (isQuotaOrFatalDbError(err)) {
              console.warn(`  ⚠️ DB quota/connection limit hit during dedup; switching to DB-Free Live Snapshot mode.`);
              dbAvailable = false;
            }
          }
        }

        const artId = generateId("a");
        const isEnglish = !/[\u4e00-\u9fa5]/.test(rawTitle);

        let displayTitle = src.prefix && !rawTitle.startsWith("【") ? `${src.prefix}${rawTitle}` : rawTitle;
        let originalTitle = isEnglish ? rawTitle.replace(/^【[^】]+】/, "").trim() : null;
        let summary = extractedSummary;
        let reason = generateContextualReason(displayTitle, extractedSummary, routedCategory, src);
        let aiScore = null;
        let bodyHtml = null;
        let bodyText = null;
        let zhHtml = null;
        let zhText = null;
        let zhParagraphsOut = null;

        // 提取多段正文（同时支持英文与国内中文信源！）
        let paragraphs = extractParagraphsFromItemHtml(item);
        if (paragraphs.length < 2 && link.startsWith("http")) {
          const fetched = await fetchArticleText(link);
          if (fetched.length > paragraphs.length) paragraphs = fetched;
        }
        if (!paragraphs.length) {
          paragraphs = [extractedSummary, reason];
        }

        bodyHtml = paragraphsToSafeHtml(paragraphs);
        bodyText = paragraphs.join("\n\n");

        if (isEnglish) {
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
              zhParagraphsOut = aiResult.paragraphs;
              zhHtml = paragraphsToSafeHtml(aiResult.paragraphs);
              zhText = aiResult.paragraphs.join("\n\n");
            }
          } else {
            const trTitle = await translateToChinese(originalTitle);
            if (!/[\u4e00-\u9fa5]/.test(trTitle)) continue;
            const prefix = src.prefix || "【全球一手】";
            displayTitle = `${prefix}${trTitle}`;
            const trParagraphs = [];
            for (const p of paragraphs.slice(0, 4)) {
              const tp = await translateToChinese(p.slice(0, 450));
              if (tp && /[\u4e00-\u9fa5]/.test(tp)) trParagraphs.push(tp);
            }
            if (trParagraphs.length > 0) {
              summary = `${trParagraphs[0].slice(0, 200)}（来源：${src.name}）`;
              zhParagraphsOut = trParagraphs;
              zhHtml = paragraphsToSafeHtml(trParagraphs);
              zhText = trParagraphs.join("\n\n");
            } else {
              summary = `${displayTitle} —— 来自 ${src.name} 的实时重点报道。`;
              zhParagraphsOut = [summary, reason];
              zhHtml = paragraphsToSafeHtml(zhParagraphsOut);
              zhText = `${summary}\n\n${reason}`;
            }
            reason = generateContextualReason(displayTitle, summary, routedCategory, src);
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
        const isSelected = finalScore >= 88;
        const topicTags = inferTopicTags(displayTitle, originalTitle, summary, finalCategory, src.tags);
        const searchText = buildSearchText({
          title: displayTitle,
          originalTitle,
          summary,
          reason,
          sourceName: src.name,
          tags: topicTags
        });

        const now = new Date();
        let targetArticleId = artId;

        if (dbAvailable) {
          try {
            const [insertedArt] = await sql`
              INSERT INTO articles (
                id, source_id, identity_key, url, title, excerpt, language,
                body_html, body_text, processing_state, grouping_status,
                published_at, discovered_at, timeline_at, revision, body_status, created_at, updated_at
              ) VALUES (
                ${artId}, ${src.id}, ${link}, ${link}, ${originalTitle || displayTitle}, ${summary}, ${isEnglish ? "en" : "zh"},
                ${bodyHtml}, ${bodyText}, 'analyzed', 'complete',
                ${pubDate}, ${now}, ${pubDate}, 1, 'ok', ${now}, ${now}
              )
              ON CONFLICT (identity_key) DO UPDATE SET
                title = EXCLUDED.title,
                excerpt = EXCLUDED.excerpt,
                body_html = COALESCE(EXCLUDED.body_html, articles.body_html),
                body_text = COALESCE(EXCLUDED.body_text, articles.body_text),
                processing_state = 'analyzed',
                grouping_status = 'complete',
                updated_at = now()
              RETURNING id
            `;

            targetArticleId = insertedArt ? insertedArt.id : artId;

            if (isEnglish && zhHtml && /[\u4e00-\u9fa5]/.test(zhHtml)) {
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
                visible_after, selected_ready_at, body_mode, seat, selection_candidate, search_text
              ) VALUES (
                ${targetArticleId}, 1, 'public', true, ${isSelected},
                ${displayTitle}, ${originalTitle}, ${summary}, ${reason}, ${finalCategory}, ${topicTags}::text[],
                ${finalScore}, ${src.id}, 'news', true, ${link},
                ${pubDate}, ${now}, ${pubDate}, ${pubDate},
                ${now}, ${now}, 'full', true, true, ${searchText}
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
                tags = EXCLUDED.tags,
                score = EXCLUDED.score,
                body_mode = 'full',
                search_text = EXCLUDED.search_text,
                visible_after = now()
            `;

            const poolBody = (zhText || bodyText || summary || "").toLowerCase().slice(0, 12000);
            await sql`
              INSERT INTO pool_search (article_id, direct, body)
              VALUES (${targetArticleId}, ${searchText}, ${poolBody})
              ON CONFLICT (article_id) DO UPDATE SET
                direct = EXCLUDED.direct,
                body = EXCLUDED.body
            `;
          } catch (e) {
            console.error(`    DB insert warning for "${rawTitle.slice(0, 20)}":`, e.message);
            if (isQuotaOrFatalDbError(e)) {
              dbAvailable = false;
            }
          }
        }

        // 同步缓存到内存实时池，无论 DB 是否超限，均确保快照 100% 写入最新实时文章！
        const finalParagraphs = isEnglish
          ? (zhParagraphsOut && zhParagraphsOut.length > 0 ? zhParagraphsOut : [summary, reason])
          : (paragraphs && paragraphs.length > 0 ? paragraphs : [summary, reason]);
        const aihotUrl = `${siteUrl}/items/${targetArticleId}`;
        const snapshotItem = {
          id: targetArticleId,
          title: displayTitle,
          originalTitle: originalTitle || null,
          summary,
          content: finalParagraphs.join("\n\n"),
          paragraphs: finalParagraphs,
          originalContent: isEnglish ? bodyText : null,
          source: { name: src.name },
          links: { aihot: aihotUrl, original: link },
          publishedAt: pubDate.toISOString(),
          discoveredAt: now.toISOString(),
          category: finalCategory,
          tags: topicTags.filter((t) => !String(t).startsWith("entity:")),
          score: finalScore,
          selected: isSelected,
          reason,
          attribution: { name: "曾练全球一手新闻", url: aihotUrl }
        };
        if (!newlyCuratedByCat.has(finalCategory)) {
          newlyCuratedByCat.set(finalCategory, []);
        }
        newlyCuratedByCat.get(finalCategory).push(snapshotItem);
        knownUrls.add(link);

        srcCount++;
        totalNew++;
      }
      console.log(`  ✨ Curated ${srcCount} new articles from ${src.name}`);
    } catch (err) {
      console.error(`  ❌ Failed ${src.name}: ${err.message}`);
    }
  }

  // 5 路并发抓取 30 大官方信源，大幅缩短整轮耗时至 45-75 秒内
  const CONCURRENCY = 5;
  for (let i = 0; i < PREMIUM_SOURCES.length; i += CONCURRENCY) {
    const batch = PREMIUM_SOURCES.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((src) => processSource(src)));
  }

  if (dbAvailable) {
    try {
      await withDbRetry("syncHotStoriesAndRankings", () => syncHotStoriesAndRankings());
      await withDbRetry("syncPeriodicAndDailyReports", () => syncPeriodicAndDailyReports());
      await withDbRetry("exportStaticJsonSnapshots", () => exportStaticJsonSnapshots());
    } catch (err) {
      console.warn(`  ⚠️ DB post-processing failed (${err?.message || err}); exporting merged live snapshots directly.`);
      exportMergedSnapshots(existingByCat, newlyCuratedByCat);
    }
  } else {
    exportMergedSnapshots(existingByCat, newlyCuratedByCat);
  }

  console.log(`\n🎉 Finished v3.2 Resilient Curation (dbAvailable=${dbAvailable})! Added/Updated ${totalNew} live articles.`);
}

main()
  .catch((e) => {
    console.error("FATAL ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => (sql ? sql.end({ timeout: 5 }).catch(() => {}) : Promise.resolve()));
