# 📰 增联新闻 (Zenglian News)

<p align="center">
  <img src="https://img.shields.io/badge/在线体验-zenglian--news.onrender.com-00C7B7?style=for-the-badge&logo=render&logoColor=white" alt="在线演示">
  <img src="https://img.shields.io/badge/编译引擎-DeepSeek_V3-0066FF?style=for-the-badge&logo=deepseek&logoColor=white" alt="DeepSeek">
  <img src="https://img.shields.io/badge/云数据库-Neon_PostgreSQL-336791?style=for-the-badge&logo=postgresql&logoColor=white" alt="Neon DB">
  <img src="https://img.shields.io/badge/开源协议-MIT-green?style=for-the-badge" alt="License">
</p>

<p align="center">
  <b>全球科技与商业一手智能情报枢纽 · 7x24h 自动化巡检 · DeepSeek 深度双语编译 · 六大精选板块</b><br>
  👉 <b>立即在线体验：<a href="https://zenglian-news.onrender.com">https://zenglian-news.onrender.com</a></b>
</p>

---

## 🌟 项目简介

**增联新闻（Zenglian News）** 是专为创业者、投资人、极客及高端决策者量身打造的**新一代商业与全球科技情报聚合中心**。

系统突破传统新闻聚合平台的杂乱与机翻死板痛点，采用 **DeepSeek 专业媒体级大模型编译引擎** 与 **7x24 小时云原生自动化采集体系**，对全球顶尖信源进行实时过滤、精选评分与深度编译，让用户在第一时间洞察全球商业先机与搞钱风向。

---

## 🎯 六大核心情报板块 (Top 10)

平台精简排版，按需分类，杜绝信息过载：

| 板块名称 | 定位与核心价值 | 重点信源渠道 |
| :--- | :--- | :--- |
| **🌐 全球一手** | 硅谷最新突破、海外独立创新、AI 落地神器与重大科技动态（支持中英/丹麦语原文双语一键切换） | Hacker News、OpenAI 官方博客、Product Hunt、国际权威科技资讯 |
| **🇨🇳 国内前沿** | 国内科技大厂、国产大模型前沿、芯片算力与产业落地动态 | 量子位、极客公园、IT之家、开源中国 |
| **💼 商业创投** | 商业内幕、资本运作、产业深度研报与融资并购一手风向 | 虎嗅网、钛媒体、界面新闻商业版 |
| **⚡ 科技硬件** | 前沿数码消费、AI 硬件、具身机器人与消费电子新品一手测评 | 爱范儿、极客消费实验室 |
| **🎭 数字文娱** | 数字生活方式、效率生产力工具、软硬件优质体验探索 | 少数派 (SSPAI)、数字工作流精选 |
| **💰 搞钱变现** | 独立开发者创业、副业变现、出海赚钱案例与商业化实战讨论 | V2EX 搞钱创造、Product Hunt 创客变现 |

---

## ⚡ 核心技术亮点

### 1. 🤖 DeepSeek 顶级媒体级编译引擎
- 告别传统免费机器翻译的生硬机翻与高频 429 报错。
- 采用 **DeepSeek-Chat 结构化 JSON 编译**，一次性同步生成**精炼主标题**、**150字核心速览**与**全文字段流畅中文**。
- 原文与译文严格物理分流，保留完整外语原貌，支持用户随时在手机端点击 **【 中文 | 原文 】** 自由对照。

### 2. ⏰ 7x24 小时云原生自治调度 (AutoCurator)
- 内置零外部依赖的后台守护服务，每 15 分钟全自动巡检抓取全球顶级信源。
- 自动完成内容清洗、正文提取、去除广告 Cookie 冗余、结构化入库与分类标签归档。

### 3. 📱 极简轻量级移动端与 PWA 体验
- 专为手机端优化的高端杂志级排版，三字精炼 Tab 切换，丝滑流畅。
- 支持添加到手机主屏幕（PWA），即开即看，无需下载庞大应用。
- 内置**智能早报/晨报生成器**，早间一键生成今日精选简报。

---

## 🛠️ 技术栈一览

- **服务端 & SSR**：Node.js 24 + TypeScript + React Router SSR
- **数据库**：PostgreSQL 17 (Neon Serverless Cloud DB)
- **AI 大模型**：DeepSeek API (`deepseek-chat`)
- **云部署**：Render (Docker 容器化全自动 CI/CD) + Cloudflare CDN 加速
- **数据抓取**：Cheerio + Fast-XML-Parser + 健壮多通道超时防护

---

## 🚀 快速本地启动

### 1. 克隆代码仓库
```bash
git clone https://github.com/Zenglian990/zenglian-news.git
cd zenglian-news
```

### 2. 安装依赖
```bash
npm install
```

### 3. 配置环境变量
复制环境配置模板：
```bash
cp .env.example .env
```
配置你的 `DATABASE_URL` 以及 `DEEPSEEK_API_KEY`。

### 4. 启动所有服务
```bash
node run-all.mjs
```
访问本地：`http://127.0.0.1:3000`

---

## 📄 开源许可证

本项目基于 [MIT 许可证](LICENSE) 开源。

---

<p align="center">
  <b>增联新闻 · 汇聚全球顶尖智慧，助您洞察财富先机</b><br>
  Created with ❤️ by 曾先生
</p>
