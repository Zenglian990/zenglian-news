import postgres from "postgres";

const connStr = "postgresql://neondb_owner:npg_ZhHSnk3d6QXW@ep-withered-silence-b7u1pctd-pooler.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require";
const sql = postgres(connStr, { ssl: "require" });

const TOP10_POLISH = [
  {
    id: "ab940fa855401d894fb967d35",
    title: "【深度观察】硅谷创投底层逻辑揭秘：押注与博弈如何驱动当下科技狂潮",
    summary: "《纽约时报》万字长文深入剖析硅谷当前的技术与资本生态：从预测市场到大模型军备竞赛，押注与博弈机制正在重构整条创新产业链。投资人与创业者正在用金融衍生品的底层逻辑衡量一切技术成果。（来源：Hacker News·全球一手，实时追踪报道）"
  },
  {
    id: "a97a59f7eabdd94763e9c7256",
    title: "【柳叶刀最新研究】全球1/8癌症病例由感染引发，多种可通过疫苗与筛查预防",
    summary: "权威医学研究显示，全球约13%（每8例中就有1例）的癌症病例由病原体感染引发，幽门螺杆菌、人乳头瘤病毒（HPV）与乙肝病毒是三大首要诱因。医学界呼吁加大疫苗普及与早期根除治疗力度，具备极高的公共卫生与产业变现价值。（来源：Hacker News·全球一手，实时追踪报道）",
    paragraphs: [
      "一项发表于权威医学期刊的最新全球流行病学研究显示，全球大约八分之一（约13%）的癌症病例是由常见病原体感染直接引发的。",
      "在所有可归因于感染的癌症类型中，幽门螺杆菌（引发胃癌）、人乳头瘤病毒（HPV，引发宫颈癌等）以及乙型和丙型肝炎病毒（引发肝癌）占据了绝大多数病例份额。",
      "研究团队强调，与遗传变异或环境污染相比，这些感染相关癌症大多拥有明确的预防与干预手段：例如接种HPV疫苗、乙肝疫苗，以及对幽门螺杆菌进行抗生素根除治疗。",
      "公共卫生专家指出，通过扩大发展中国家与基层的筛查普及率并降低疫苗接种门槛，全球每年可避免数百万人死于此类可预防的恶性肿瘤。"
    ]
  },
  {
    id: "a591977c11b3d9e78ef5c9ff2",
    title: "【开源神器】Rust重写开源Adobe替代套件ArtCraft：轻量高性能免订阅",
    summary: "针对Adobe高昂的订阅费与庞大体积，开源团队用Rust语言完全重构了包含图像处理、矢量设计、排版与PDF编辑的ArtCraft全套套件，支持跨平台原生运行且无需任何联网认证，受到全球开发者热烈追捧。（来源：Hacker News·全球一手，实时追踪报道）"
  },
  {
    id: "a6f819f528c9473cc45846a00",
    title: "【实战指南】用SSH与Nginx搭建个人内网穿透HTTP隧道，彻底替代ngrok",
    summary: "如何在不依赖第三方付费穿透服务的前提下快速将本地开发环境暴露给客户预览？本文详述了利用现有VPS、标准SSH远程端口转发与Nginx反向代理快速搭建零成本安全隧道的高效方案。（来源：Hacker News·全球一手，实时追踪报道）"
  },
  {
    id: "a1c1369af1ebf927f67ab8ac0",
    title: "【数字遗产】好莱坞定格动画大师Phil Tippett经典作品数字档案库公开上线",
    summary: "为《星球大战》《侏罗纪公园》等影史巨作打造传奇特效的蒂皮特工作室关闭后，其数十年积累的定格动画珍贵手稿、模型雕塑与幕后制作档案已全面数字化并对全球公众免费开放浏览。（来源：Hacker News·全球一手，实时追踪报道）"
  },
  {
    id: "a6a82806b549d09b13d8ffe7a",
    title: "【Mac实用指南】如何彻底关闭macOS系统Apple Intelligence并释放数十G磁盘空间",
    summary: "苹果macOS内置的Apple Intelligence会预先下载数个体积庞大的本地端侧大模型，占用宝贵的SSD固态存储。技术社区给出了彻底禁用系统级AI服务并安全清理本地模型权重的完整操作脚本。（来源：Hacker News·全球一手，实时追踪报道）"
  },
  {
    id: "a1cf6a0b0ba207285f3d641d7",
    title: "【AI算力底层突破】Homa网络协议解析：终结TCP在AI超大集群中的延迟瓶颈",
    summary: "斯坦福团队与顶尖网络专家推出的Homa传输协议正式进入落地阶段。通过消除TCP拥塞控制带来的微秒级尾部延迟，Homa可将大规模GPU分布式训练与跨卡All-Reduce通信效率提升数倍。（来源：Hacker News·全球一手，实时追踪报道）"
  },
  {
    id: "ae5c60326fdfbbc0239f8777b",
    title: "【外媒曝光】因政府文件涂黑失误，谷歌AI超算中心惊人耗电与耗水量全曝光",
    summary: "内布拉斯加州政府披露的公开记录中因PDF遮盖图层未扁平化，意外泄露了谷歌当地AI数据中心的真实能耗数据：其电力与水资源消耗速度远超外界此前预估，再次引发大模型算力环保热议。（来源：Hacker News·全球一手，实时追踪报道）"
  },
  {
    id: "a8c48d413d3ffe7079379641e",
    title: "【编程入门】Build with Python可视化编程平台：用代码实时绘图学算法",
    summary: "一位开发者为解决女儿学习Python时枯燥终端打印的问题，打造了纯浏览器端免安装的图形化编程交互环境。学习者通过代码直接驱动视觉几何图形绘制，大幅降低了初学者心智负担。（来源：Hacker News·全球一手，实时追踪报道）"
  },
  {
    id: "ac41e86dddc8498cfda5975ad",
    title: "【极客怀旧】纯浏览器端原生VB6开发环境：重温经典的Visual Basic 6.0",
    summary: "全球开发者用现代化Web技术在浏览器中100%还原了经典Visual Basic 6.0（VB6）集成开发环境，不仅支持所见即所得窗体拖拽设计，还可直接解析运行经典BASIC语法并导出运行。（来源：Hacker News·全球一手，实时追踪报道）"
  }
];

async function polish() {
  console.log("🌟 Polishing Top 10 Global publications editorial titles and summaries...");

  for (const item of TOP10_POLISH) {
    if (item.paragraphs) {
      const enHtml = item.paragraphs.map(p => `<p>${p}</p>`).join("\n");
      const zhHtml = enHtml;
      await sql`
        UPDATE articles
        SET body_html = ${enHtml},
            body_text = ${item.paragraphs.join("\n\n")},
            updated_at = now()
        WHERE id = ${item.id}
      `;
      await sql`
        INSERT INTO translations (article_id, lang, revision, title, body_html, body_text, complete, origin, created_at)
        VALUES (${item.id}, 'zh', 1, ${item.title}, ${zhHtml}, ${item.paragraphs.join("\n\n")}, true, 'model', now())
        ON CONFLICT (article_id, lang) DO UPDATE SET
          title = EXCLUDED.title,
          body_html = EXCLUDED.body_html,
          body_text = EXCLUDED.body_text,
          complete = true,
          created_at = now()
      `;
    } else {
      await sql`
        UPDATE translations
        SET title = ${item.title}
        WHERE article_id = ${item.id} AND lang = 'zh'
      `;
    }

    await sql`
      UPDATE publications
      SET title = ${item.title},
          summary = ${item.summary},
          body_mode = 'full'
      WHERE article_id = ${item.id}
    `;
    console.log(`✅ Polished: ${item.title}`);
  }

  console.log("\n🎉 Finished polishing Top 10 Global articles!");
  await sql.end();
}

polish().catch(console.error);
