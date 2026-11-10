# 📰 增联新闻 (Zenglian News / AIHOT)

<p align="center">
  <a href="https://zenglian-news.onrender.com"><img src="https://img.shields.io/badge/在线体验-zenglian--news.onrender.com-00C7B7?style=for-the-badge&logo=render&logoColor=white" alt="在线演示"></a>
  <img src="https://img.shields.io/badge/编译引擎-DeepSeek_V3_%2B_Gemini_2.5-0066FF?style=for-the-badge&logo=deepseek&logoColor=white" alt="AI Engine">
  <img src="https://img.shields.io/badge/云数据库-Neon_PostgreSQL_17-336791?style=for-the-badge&logo=postgresql&logoColor=white" alt="Neon DB">
  <img src="https://img.shields.io/badge/架构-Node.js_24_Monorepo_%2B_SSR-green?style=for-the-badge&logo=node.js&logoColor=white" alt="Node 24">
</p>

<p align="center">
  <b>全球科技与商业一手智能情报枢纽 · 7x24h 自动化巡检 · 双引擎深度双语编译 · 六大精选板块</b><br>
  👉 <b>Web 云端直达：<a href="https://zenglian-news.onrender.com">https://zenglian-news.onrender.com</a></b> ｜ <b>Android 客户端：Releases `v2.8.1`</b>
</p>

---

## 🌟 项目简介

**增联新闻（Zenglian News）** 是面向创业者、投资人与技术决策者构建的**全球科技与商业一手智能情报聚合平台**。

系统采用 **Node.js 24 TypeScript Monorepo 架构**，结合 **DeepSeek (`deepseek-chat`) 与 Gemini (`gemini-2.5-flash`) 双大模型编译管线** 以及 **7x24 小时云原生定时采集守护进程 (`AutoCurator`)**，对全球权威科技与商业信源进行实时抓取、正文清洗、结构化评分与中英双语对照编译。

---

## 🎯 六大核心情报板块

平台按商业与技术价值精简为六大板块，过滤低质水文：

| 板块名称 | 定位与核心价值 | 代表信源渠道 |
| :--- | :--- | :--- |
| **🌐 全球一手** | 硅谷前沿突破、海外独立开发、AI 核心动态（支持中文精编与多语种外媒原文一键对照切换） | Hacker News、OpenAI Blog、Product Hunt、TechCrunch 等国际科技媒体 |
| **🇨🇳 国内前沿** | 国内科技大厂、国产大模型演进、算力基础设施与产业落地动态 | 量子位、极客公园、IT之家、开源中国 |
| **💼 商业创投** | 商业深度报道、一级市场投融资、并购动态与行业研报 | 虎嗅网、钛媒体、界面新闻商业版 |
| **⚡ 科技硬件** | AI 硬件、具身智能机器人、芯片终端与消费电子深度评测 | 爱范儿、极客消费实验室 |
| **🎭 数字文娱** | 生产力工具、数字工作流与软硬件效率实践 | 少数派 (SSPAI)、效率工具精选 |
| **💰 搞钱变现** | 独立开发者商业化实战、出海 SaaS 变现案例与副业增长洞察 | V2EX 创造/搞钱节点、Indie Hackers、Product Hunt |

---

## 🏗️ 工程架构与技术栈 (Monorepo)

项目采用 NPM Workspaces 单体多包（Monorepo）架构，由 `run-all.mjs` 统一编排启动：

```text
zenglian-news/
├── apps/
│   ├── api/                      # 后端核心 API 服务 (监听端口 3001)
│   ├── worker/                   # 后台异步任务处理与大模型编译队列服务
│   └── web/                      # 前端 React 19 + React Router v8 + Tailwind v4 SSR 服务端渲染应用 (端口 3000)
├── packages/
│   ├── backend/                  # 数据库访问层、业务逻辑与多模型调用核心库
│   └── contracts/                # 前后端共享 TypeScript 类型契约与接口定义
├── industry/ & site/             # 行业分类规约与站点静态配置模块
├── scripts/
│   ├── migrate.ts                # PostgreSQL 数据库 Schema 自动迁移脚本
│   └── inject_premium_sources.mjs# AutoCurator 7x24h 全球精选信源定时巡检与双语入库脚本
├── run-all.mjs                   # 全栈多进程守护启动器 (API + Worker + Web SSR + 15分钟定时巡检)
├── render.yaml & Dockerfile      # Render 云平台 Docker 容器化部署配置
└── tests/                        # Node.js 原生并发集成测试套件
```

### 核心技术亮点
1. **双引擎结构化编译**：基于 `deepseek-chat` (DeepSeek-V3) 与 `gemini-2.5-flash`，一次性输出结构化中文精炼标题、核心摘要与全文编译，同时完整保留外语原文供随时对照切换。
2. **7x24 小时自治巡检 (`AutoCurator`)**：`run-all.mjs` 内置零外部 Cron 依赖的守护定时器，启动后每 15 分钟自动执行 `scripts/inject_premium_sources.mjs` 巡检全球信源并写入云端数据库。
3. **云端网关自动寻址**：支持将最新公网入口同步至 GitHub Gist 路由表，配合 Android 原生客户端 (`v2.8.1`) 与移动端 PWA 实现免配置直连。

---

## 🚀 本地开发与启动指南

### 1. 环境要求
- **Node.js**: `>= 24.11`（支持原生 TypeScript 直接运行与 `--env-file`）
- **PostgreSQL**: PostgreSQL 17（或 Neon Serverless PostgreSQL 云数据库）

### 2. 安装与配置
```bash
git clone https://github.com/Zenglian990/zenglian-news.git
cd zenglian-news
npm install
cp .env.example .env
```
在 `.env` 中配置 `DATABASE_URL`、`DEEPSEEK_API_KEY`（及可选的 `LLM_API_KEY`）。

### 3. 执行数据库迁移与全栈启动
```bash
# 初始化数据库表结构
npm run db:migrate

# 一键启动 API (3001) + Worker + Web SSR (3000) + AutoCurator 定时巡检
node run-all.mjs
```
启动后浏览器访问：`http://127.0.0.1:3000`（管理后台：`http://127.0.0.1:3000/admin`）。

### 4. 类型检查与测试
```bash
npm run typecheck
npm test
```

---

## 📄 许可证
本项目基于 [MIT License](LICENSE) 许可协议管理。
