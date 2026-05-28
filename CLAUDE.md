# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
npm run dev      # 启动开发服务器 (http://localhost:3000)
npm run build    # 生产构建
npm start        # 启动生产服务器
```

环境变量配置（可选，仅登录/反馈功能需要）：
```bash
cp env.example .env.local  # 然后填入 Supabase 和 Web3Forms 的 key
```

## 架构概览

这是一个纯前端 Next.js 单页应用，用于实时追踪基金估值和重仓股涨跌。**无后端服务器**，所有数据通过 JSONP/Script Tag Injection 直接从东方财富、天天基金、腾讯财经的公开接口获取。

### 数据流

1. **添加基金** → 输入6位基金代码 → `fetchFundData()` (app/api/fund.js) 通过 JSONP 获取天天基金估值数据
2. **并行拉取**：
   - 腾讯财经接口获取基金净值/涨跌幅确认
   - 东方财富 HTML 解析获取前10重仓股
   - 东方财富获取历史净值趋势 (用于 ECharts 趋势图)
3. **重仓股行情** → 通过腾讯财经接口批量获取股票实时涨跌
4. **分时估值** → `fetchIntradayData()` 获取当日盘中分时估值曲线

### 关键文件

- `app/page.jsx` — 主页面组件，包含所有业务逻辑（约2000行）：基金管理、分组、持仓交易、自选、拖拽排序、云端同步、主题切换等。所有 modal 子组件也在此文件中定义。
- `app/api/fund.js` — 所有外部数据接口封装：基金估值、净值、重仓股、搜索、分时数据、反馈提交。核心模式是动态插入 `<script>` 标签利用 JSONP 回调获取跨域数据。
- `app/lib/supabase.js` — Supabase 客户端，未配置时返回 noop 实现避免报错，保证不使用登录功能时仍可正常运行。
- `app/components/Common.jsx` — 通用 UI 组件：DatePicker、NumericInput、Stat、DonateTabs
- `app/components/Icons.jsx` — 所有 SVG 图标组件
- `app/components/FundTrendChart.jsx` — ECharts 历史净值趋势图
- `app/components/FundIntradayChart.jsx` — ECharts 分时估值图
- `app/components/Announcement.jsx` — 首次展示公告弹窗（localStorage 控制）
- `app/components/AnalyticsGate.jsx` — Google Analytics，仅在 zhengshengning 域名下启用
- `app/globals.css` — 全局样式 + 玻璃拟态设计 + 暗色/亮色主题 CSS 变量
- `supabase.sql` — Supabase 数据库建表 SQL（user_configs 表 + RLS 策略）

### 状态持久化

- **localStorage**：基金列表、自选标记、分组、持仓交易、主题偏好、排序/视图模式、公告关闭状态、版本号
- **Supabase**（可选）：通过 `user_configs` 表的 `data` JSON 字段实现云端同步，支持多端数据同步

### 部署

- **Vercel**：vercel.json 配置了 SPA rewrite 规则
- **Docker**：多阶段构建（node:22），`docker compose up -d` 启动
- **GitHub Actions**：`.github/workflows/` 下有 nextjs.yml 和 docker-ci.yml
