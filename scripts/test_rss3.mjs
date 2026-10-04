const feeds = [
  { name: "界面新闻", url: "https://a.jiemian.com/index.php?m=article&a=rss" },
  { name: "极客公园 GeekPark", url: "https://www.geekpark.net/rss" },
  { name: "开源中国 OSCHINA", url: "https://www.oschina.net/news/rss" },
  { name: "DoNews 科技", url: "https://www.donews.com/feed" }
];

async function check() {
  for (const item of feeds) {
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
