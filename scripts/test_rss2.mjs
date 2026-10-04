const candidateFeeds = [
  { name: "爱范儿 ifanr", url: "https://www.ifanr.com/feed" },
  { name: "Hacker News (hnrss)", url: "https://hnrss.org/frontpage" },
  { name: "Hacker News AI (hnrss)", url: "https://hnrss.org/newest?q=AI" },
  { name: "新浪科技", url: "https://feed.mix.sina.com.cn/rss/tech.xml" },
  { name: "虎嗅", url: "https://rss.huxiu.com/" },
  { name: "雷锋网", url: "https://www.leiphone.com/feed" },
  { name: "机器之心 (rsshub)", url: "https://rsshub.app/jiqizhixin" },
  { name: "36氪 (rsshub)", url: "https://rsshub.app/36kr/newsflashes" },
  { name: "V2EX 搞钱/分享", url: "https://www.v2ex.com/index.xml" },
  { name: "InfoQ 中文", url: "https://www.infoq.cn/feed" },
  { name: "TechCrunch Global", url: "https://techcrunch.com/feed/" },
  { name: "VentureBeat AI", url: "https://venturebeat.com/category/ai/feed/" }
];

async function check() {
  for (const item of candidateFeeds) {
    try {
      const res = await fetch(item.url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 AIHOT/1.0" },
        signal: AbortSignal.timeout(6000)
      });
      const text = await res.text();
      const isXml = text.includes("<rss") || text.includes("<feed") || text.includes("<channel");
      console.log(`[${res.status}] ${item.name}: ${isXml ? "VALID RSS (" + text.length + " bytes)" : "NOT XML (" + text.slice(0, 100) + ")"}`);
    } catch (e) {
      console.log(`[ERR] ${item.name}: ${e.message}`);
    }
  }
}

check();
