const candidateFeeds = [
  { name: "36氪", url: "https://36kr.com/feed" },
  { name: "量子位", url: "https://www.qbitai.com/feed" },
  { name: "机器之心", url: "https://www.jiqizhixin.com/rss" },
  { name: "少数派", url: "https://sspai.com/feed" },
  { name: "智东西", url: "https://zhidx.com/feed" },
  { name: "Product Hunt", url: "https://www.producthunt.com/feed" },
  { name: "Hacker News", url: "https://news.ycombinator.com/rss" },
  { name: "IT之家", url: "https://www.ithome.com/rss/" },
  { name: "钛媒体", url: "https://www.tmtpost.com/rss.xml" },
  { name: "品玩 PingWest", url: "https://www.pingwest.com/feed" }
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
