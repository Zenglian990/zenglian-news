import { spawn, exec } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
console.log("🚀 Starting AIHOT services...");

// Only load .env file if it actually exists (local mode); cloud environments provide env vars directly
const envArgs = existsSync(path.join(root, ".env")) ? ["--env-file=.env"] : [];

// 1. Start API (port 3001)
const apiProcess = spawn("node", [...envArgs, "apps/api/src/main.ts"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, API_PORT: "3001" },
});

apiProcess.stdout.on("data", (d) => {
  const line = d.toString();
  if (line.includes("Server listening")) {
    console.log("✅ API Service is running on http://127.0.0.1:3001");
  }
});
apiProcess.stderr.on("data", (d) => process.stderr.write(`[API] ${d}`));

// 2. Start Worker (Background collector & processor)
const workerProcess = spawn("node", [...envArgs, "apps/worker/src/main.ts"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env },
});

workerProcess.stdout.on("data", (d) => console.log(`[Worker] ${d.toString().trim()}`));
workerProcess.stderr.on("data", (d) => process.stderr.write(`[Worker] ${d}`));

// 3. Start Web SSR (port 3000 or cloud PORT)
const webProcess = spawn("node", [...envArgs, "apps/web/server.ts"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, WEB_PORT: process.env.PORT || "3000", API_BASE_URL: "http://127.0.0.1:3001" },
});

webProcess.stdout.on("data", (d) => {
  const line = d.toString();
  if (line.includes("web started")) {
    console.log("✅ Web Frontend is running on http://127.0.0.1:3000");
  }
});
webProcess.stderr.on("data", (d) => process.stderr.write(`[Web] ${d}`));

// 4. Start Tunnel (Local only; in cloud, the platform handles HTTPS ingress)
const isCloud = !!(process.env.RENDER || process.env.KOYEB || process.env.IS_CLOUD || (process.platform === "linux" && !process.env.FORCE_TUNNEL));
let tunnelProcess = null;

if (!isCloud) {
  console.log("🌐 Starting Local Public Tunnel (zenglian-news)...");
  const tunnelCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  tunnelProcess = spawn(tunnelCmd, ["--yes", "localtunnel", "--port", process.env.PORT || "3000", "--subdomain", "zenglian-news"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  const onTunnelData = (d) => {
    const text = d.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9-.]+\.loca\.lt/);
    if (match) {
      const publicUrl = match[0];
      console.log("\n==================================================");
      console.log(`🎉 稳定公网 HTTPS 访问地址已生成: ${publicUrl}`);
      console.log(`📱 手机 APK / 浏览器均可直接访问: ${publicUrl}`);
      console.log(`🔐 管理员后台地址: ${publicUrl}/admin`);
      console.log("==================================================\n");
      writeFileSync(path.join(root, "PUBLIC_URL.txt"), publicUrl, "utf8");

      // Sync to GitHub Gist so mobile app automatically resolves the newest URL
      const tmpJson = path.join(root, "endpoint_tmp.json");
      writeFileSync(tmpJson, JSON.stringify({ url: publicUrl, updated_at: new Date().toISOString() }), "utf8");
      exec(`gh gist edit 4d599871a4e2d283f0c99f79abb155b9 -f aihot_endpoint.json "${tmpJson}"`, (err) => {
        if (!err) {
          console.log("📡 云端网关 (GitHub Gist) 同步成功！手机 App 将无缝直连此地址。");
        }
      });
    }
  };
  tunnelProcess.stdout.on("data", onTunnelData);
  tunnelProcess.stderr.on("data", onTunnelData);
} else {
  const publicUrl = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || (process.env.KOYEB_PUBLIC_DOMAIN ? `https://${process.env.KOYEB_PUBLIC_DOMAIN}` : "");
  if (publicUrl) {
    console.log(`☁️ 云端运行就绪，公网入口: ${publicUrl}`);
    // Sync to GitHub Gist
    try {
      fetch("https://api.github.com/gists/4d599871a4e2d283f0c99f79abb155b9", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "AIHOT-Cloud",
          ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
        },
        body: JSON.stringify({
          files: {
            "aihot_endpoint.json": {
              content: JSON.stringify({ url: publicUrl, updated_at: new Date().toISOString() }),
            },
          },
        }),
      }).catch(() => {});
    } catch {}
  }
}

// Cleanup on exit
function shutdown() {
  console.log("Stopping all services...");
  apiProcess.kill();
  workerProcess.kill();
  webProcess.kill();
  if (tunnelProcess) tunnelProcess.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
