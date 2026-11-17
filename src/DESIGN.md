# 公考作战台 · 设计说明（DESIGN.md）

依据 `lsf-website-design` v34 制作：无指定主参考网址 → 五站调研后进入 A 风格参考路径，由当前对话主 Agent 直接制作一套。本文件是本次实现与评审的依据。

## Overview

**核心记忆点：一格一天。** 从开卷日（2026-10-27）到考试日，每天是一格；留过学习痕迹的日子被墨绿填满并留一枚朱红勾，今天这一格亮起朱红流动边界，还没到的日子是虚线空框。打开页面第一眼看到的不是一句口号，而是「自己已经铺了多少格、还剩多少空格」。

- **为什么属于这个产品**：这是私人备考工作台，内容按天累积。倒计时与学习痕迹本来就是同一件事的两面，格子把两者合成一个对象；换成任何别的产品都不成立。
- **怎样被感受到并延续**：首屏是格历墙；勾选今日任务会点亮今天那一格；点任意一格打开那一天的痕迹；下方时间轴按同一套「逐日推进」逻辑排 D-60 → D-Day；痕迹流按日期倒序，与格子里已填的日期一一对应。
- **怎样实际成立**：CSS Grid + DOM 格子由 `traces.js` 的真实日期数据驱动，不是背景图；触屏点击与键盘 Enter/Space 等价；`prefers-reduced-motion` 下取消流动光与逐格铺开，格子状态仍完整可读。

## 五站调研（实际打开，2026-11-11）

证据：`.lsf/research/*-fold.png`、`*-scroll.png`、`observations.json`、`observations-more.json`。失败候选如实记录，不以站名凑数。

| 网站与证据 | 记忆点及产品关系 | 如何做成 | 本项目取舍 |
|---|---|---|---|
| [Habitica](https://habitica.com/) 截图 habitica-fold/scroll | 把每日习惯变成可累积的角色与奖励，动力来自「不想断」 | 任务清单 + 连续完成态 + 游戏化反馈 | 学「每天有可见状态」，**不学**游戏化装饰、头像、升级弹窗；动力由格子自己承担 |
| [Streaks](https://streaksapp.com/) 截图 streaks-fold/scroll | 连胜天数是最强提醒，断一天就归零 | 每天完成任务 → 链条增长，界面直接显示链长 | 学「连续可视」，改成**不惩罚式**：断掉的日子留白，不归零、不显示责备文案 |
| [Linear](https://linear.app/) 截图 linear-fold/scroll | 周期与进度是工作状态本身，不是营销图 | 密集但克制的表格/状态条，信息密度高于装饰 | 学「状态即界面」，工作台用细线表格与格子而非卡片堆；不学其深色渐变 hero |
| [Readwise](https://www.readwise.io/) 截图 readwise-fold/scroll | 每日复习把旧内容重新推到眼前 | 间隔重复 + 每日一批高亮 | 学「每天翻旧痕迹」，痕迹流按日回看；不学其营销落地页结构 |
| [Duolingo](https://www.duolingo.com/) 截图 duolingo-fold/scroll | 连胜（streak）是打开 App 的第一动力 | 首屏给连续天数与今日任务 | 学「打开就看到连续记录」，但把天数放进格子，不做大数字＋吉祥物 |
| [Toggl Track](https://toggl.com/track/) 截图 toggl-fold/scroll | 逐日累计时间，记录本身就是成果 | 时间条目列表 + 汇总 | 学「累计题量/分钟由记录自动汇总」，不做计时器 |
| [Notion](https://www.notion.so/) 截图 notion-fold/scroll | 一个人也能拥有可改、可查的工作台 | 数据库视图 + 就地编辑 | 学「就地记一笔、筛选搜索」，不学其通用块编辑器外观 |
| [Are.na](https://www.are.na/) 截图 arena-fold/scroll | 网格块本身就是收集痕迹的形状 | 等距网格陈列，块比文字先被看到 | 学「网格作为内容容器」，定为本项目的主构图 |

超时未取得证据：Beeminder、github.com（不计入合格数量）。合格 8 站，满足至少 5 站。

## Colors

固定档位，不用流体字号，不照抄任何参考站数值。

| 令牌 | 值 | 用途 |
|---|---|---|
| `--bg` | `#E9ECEB` 冷灰白 | 页面底，**刻意不是米色**（避开反套路 A1） |
| `--surface` | `#F4F6F5` | 表格/格历面板 |
| `--ink` | `#16211E` 墨绿黑 | 正文与标题 |
| `--green` | `#17463A` | 已留痕的格子、主按钮、深色段 |
| `--red` | `#C0392B` | 仅用于「今天」「红笔批注」「勾」；不是全站强调色（避开 A2） |
| `--line` | `rgba(22,33,30,.14)` | 细线表格与格子边界 |

## Typography

- 标题与正文统一 **无衬线**（`system-ui / Noto Sans CJK SC / PingFang SC`），不用衬线标题（避开 A1）；数字与日期用等宽 `ui-monospace`。
- 工具类界面用**固定字号档位**，不用 `clamp()` 流体字号。
- 短文本（标题、按钮、标签、格子提示）：`word-break: keep-all` + `Intl.Segmenter('zh',{granularity:'word'})` 插 `<wbr>` + `text-wrap: balance`；正文 `text-wrap: pretty`。这是对官方 `check-text-wrap` 报出 7 处断行的直接修法，不是加宽容器。
- 标题、导航、按钮、标签行末不加标点。

## Layout

- 主构图是**格历墙**：7 列周历网格，每格固定宽高比，边界由细线给出；不是悬浮卡片。
- 全站共用少数几条对齐线（左边缘统一 `wrap` 左线），带 padding 的容器内部文字用统一内边距，避免官方 `check-alignment` 报出的 1–6px 偏差。
- 375 / 768 / 1440 三档：格历在手机上改为 7 列小格仍完整可见，痕迹流由双列改单列。

## Elevation & Depth / Shapes

- 零渐变、零装饰光球、零玻璃拟态；深度由 1px 细线与实心色块区分。
- 圆角 2px（≤8px），不做 SaaS 卡片阴影。
- 「今天」这一格用 **Border Beam** 式流动边界（细线光沿边框走），是全站唯一循环动效，理由：它标记的是唯一需要行动的那一格。

## Components

| 组件 | 状态与交互 | 来源 / 适配 |
|---|---|---|
| 格历格子 | 已留痕 / 今天 / 未来 / hover / focus / 点击 | CSS Grid + 数据驱动；Are.na 网格陈列方法迁移 |
| 今日任务行 | 未做 / 已做（红笔划线）/ 按压反馈 | shadcn/ui 表单状态模式（MIT）适配原生 DOM |
| 记一笔 / 改日期弹层 | 进出场、焦点回到触发处、Esc 关闭、遮罩点击 | shadcn/ui Dialog 焦点管理（MIT）适配原生 dialog 语义 |
| 那一天抽屉 | 滑入 / 滑出 / 内容切换 | Transitions.dev dropdown-morph 的形变思路，改为侧滑 |
| 痕迹卡展开 | 折叠形变、状态过渡 | 同上 |
| 数字滚动 | 从 0 到真实值，GSAP tween | React Bits 计数动效思路 + GSAP 实现 |
| 月份翻页条 | 上一月 / 下一月 / 回到今天 / 边界禁用 / 键盘与轻扫 | `.cal-panel` 内一行细线控件，Lucide `chevron-left` / `chevron-right` / `rotate-ccw`，沿用 `.tbtn` 状态语言 |
| 章节编排 / 滚动手感 | ScrollTrigger + Lenis | 开源真实源码，本地 vendor |

**组件复用记录（≥5，均实际落地）**：① GSAP + ScrollTrigger（章节编排、格子 stagger）② Lenis（滚动手感）③ Lucide（开源图标，无手写 SVG）④ shadcn/ui Dialog/Sheet 焦点与状态模式（MIT）⑤ Libraries.dev Border Beam 流动边界（MIT）⑥ Transitions.dev 折叠形变 ⑦ Intl.Segmenter + `<wbr>` 中文断行组件（MDN / 本技能排版细节）。来源与许可见 `references/component-bookmarks.json`；本次未逐个复制上游视觉，按机制适配。

## 动效清单（GSAP 负责编排，不冒充场景渲染）

| 动效 | 帮助理解什么 | 实现 |
|---|---|---|
| 逐日铺开 | 格历是「按天累积」的 | GSAP stagger timeline，仅一次 |
| 今天流动边界 | 哪格需要今天行动 | CSS @keyframes，可被 reduced-motion 关闭 |
| 勾选任务 → 点亮今天 | 操作与格子状态是同一件事 | GSAP tween + 状态写入 |
| 弹层/抽屉进出场 | 视图层级变化 | transform + opacity，禁用 scale(0) 与 ease-in |
| 按压反馈 | 可点 | `:active` 轻微缩放，无 hover 上浮、无 hover 图标运动 |
| 痕迹卡展开 | 内容展开关系 | 高度/形变过渡 |
| 月份切换 | 翻到前一月 / 后一月，表达视图方向 | GSAP fromTo 方向性短位移 ≤ .6s，reduced-motion 跳过 |
| 数字滚动 | 数值来自真实记录 | GSAP |

**核心表现技术**：DOM + CSS Grid + GSAP 属性驱动。工具型工作台的真实机制就是数据驱动的 DOM 状态，不使用 WebGL/Three.js，也不以图片位移或通用淡入冒充。

## 反套路避让（对照 `references/反套路清单.md`）

| 条目 | 上一版命中 | 本版处理 |
|---|---|---|
| A1 米色底＋衬线标题＋陶土红 | 命中 | 冷灰白底、无衬线标题、墨绿主色 |
| A2 近黑底＋单一朱红 | 命中 | 首屏浅色格历，朱红只给今天与批注 |
| A5 全大写眉标／编号 01 02／等宽小标签 | 命中 | 去掉 eyebrow 与章节编号，改用真实字段名 |
| A8 内容上方多余眉标 | 命中 | 删除 |
| A9 非序列内容编号 | 命中 | 删除 |
| A10 每区块淡入上滑 | 命中 | 删除 reveal，改为真实状态过渡 |
| A11 每张卡片 hover | 命中 | 仅可操作元素给状态反馈 |
| A12 首屏大数字＋小标签＋渐变 | 命中 | 首屏主视觉改为格历墙，倒计时是一行状态文字 |
| A4 / B1 / B4 SaaS 卡片堆叠、左右分栏卡片 hero | 命中 | 细线表格与网格，零阴影 |
| M0 页面死板 | 部分 | 补按压、状态过渡、进出场 |

保留例外的理由：细线分隔与零圆角是**表格类工作台**的最优解（内容按天成行成列），不是硬凹编辑感；已写在 Layout。

## 文案来源与如实缺项

- 站内文案全部为 **用户 ima 知识库《公考之道 · 行动纲要》原文**（打气语、铁律、顺序、复盘动作、一页纸）或功能性字段标签；主 Agent 未新写标语、说明文案。
- **Gemini 文案链路未执行**：`lsf-ai-agent` 未安装，Google AI Studio 浏览器入口不可用；按 skill 要求不自动切 API、不由主 Agent 冒写，故本次沿用知识库原文并在交付中标注缺项。
- 独立文案审核（page 模式）、Ego Lite 现场取证、Gemini/Claude 评分如不可用，均按独立评审入口如实记录。

## Do's and Don'ts

- Do：格子状态永远来自 `traces.js` / localStorage 的真实日期；新增痕迹后格历、统计、筛选同步更新。
- Don't：不加大数字标语、不加游戏化惩罚、不把断掉的日子标红责备、不加卡片 hover 上浮、不用手写 SVG 图标。

## 后续改动约定（自动沿用，无需每次重述）

- 任何针对本工作台的修改，先加载 `lsf-website-design` skill（`/root/.codebuddy/skills/lsf-website-design/`），以本文件与 `.lsf/target.md` 为设计依据。局部增补不走整站 A 侦察流程，但必须遵守上面的反套路表、组件复用，并跑官方核验：`check-text-wrap`、`check-icons`、`check-copy --style-only`、`check-transitions`。
- 数据分三层：`traces.js` 是文件级种子（IMA 同步写入）；`localStorage` 的 `gk:traces` 是页面内「记一笔」的个人数据；`gk:deletedTraces` 是被删痕迹的 id 黑名单（种子痕迹靠它屏蔽，刷新不会复活）。三者由 `allTraces()` 合并，格历、统计、筛选、痕迹流永远同源。删除是就地两段式确认 + 撤销，撤销按来源分别还原。
- `index.html` 内含**静态兜底**（不执行 JS 的预览通道也能看到完整页面）。凡改动由 JS 渲染的容器，改完必须重新导出真实 DOM 并刷新兜底，否则预览与线上不一致。导出一律走 `sync_ima.py` 的 `replace_container()`（同名标签配平）＋发版前 `data-day` 洁净度断言；**曾因非贪婪正则在 `#calGrid` 内第一个 `</div>` 处截断，每次发版把一整份 42 格追加到容器外、累积 8 份不受 grid 约束的裸格，窄屏下竖排成单列并撑出大片空白——已修复，禁止改回简单正则**。
- 图标只用 Lucide（`data-lucide`），禁止手写 SVG；禁用 hover 上浮与 hover 图标运动；标题、导航、按钮、标签行末不加标点。
- **格历布局四层保障（2026-11-11 修复「改考试日后格历塌成竖排单列」）**：① `index.html` 的 `<style id="grid-fallback">` 用 ID 选择器内联 `#calGrid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px}`，外部 CSS 缓存/失效也不塌；② `styles.css` 的 `.cal-grid` / `.cal-weekhead` 先写 `repeat(7,1fr)` 再由 `repeat(7,minmax(0,1fr))` 覆盖，兼容不认 `minmax()` 的旧 WebView；③ `app.js` 的 `ensureGrid()` 在每次 `renderCalendar()` 后检测 computed display/列数，异常则 inline 强制回 7 列；④ 本地资源带 `?v=<内容hash>`，由 `sync_ima.py` 的 `bump_versions()` 每次发版自动刷新，破 App 缓存。**改动这几处时必须一起回归：CSS 拦截/删 `.cal-grid`/喂旧版 CSS 三种故障注入下仍须 7 列**。
- **零子资源单文件部署（2026-11-11 真正根因，永久约束）**：发布平台分享链接靠根 URL 的 `sharecode` 种下 `Set-Cookie: __wb_rsc=...; SameSite=None; Secure; HttpOnly`，之后所有子资源（`styles.css` / `*.js` / `assets/vendor/*`）必须带该 cookie 才放行，否则返回 **403「链接不完整」**。iPad Safari(ITP) 与多数移动 WebView 拦截这类第三方 cookie → CSS/JS 全部加载失败 → 页面只剩 HTML 骨架、格历塌成竖排单列；桌面浏览器与自动化验证因正常回传 cookie 一直「全绿」，导致此前几轮误判为已修复。**解法：`build.py` 把 CSS 与 7 个 JS 全部内联，部署目录只放一个零子资源 `index.html`**，页面不发出任何非文档请求。源目录 `/workspace/gkzd/` 保留结构化文件供维护与定时任务改 `traces.js`；禁止手工改部署目录，禁止退回多文件版。回归判据：真实浏览器里页面请求总数 = 1、把全部非文档请求 403 掉仍完整、iPad/Android 模拟无 cookie 下「改考试日」仍 7 列。
- 格历防御性约束（**2026-11-11 改为按月分页**）：格历不再按「开卷日→考试日」连续铺整面墙，而是 `renderCalendar()` 按 `viewMonth` 渲染**单月**，固定 7 列 × 5~6 行、最多 42 格，备考跨度再长也不会撑爆页面；`monthStep()` 把可翻范围限制在 2000-01 ~ 2100-12，边界按钮 `disabled`。备考区间（`EX.start` ~ `EX.date`）外的日期加 `cell--outside` 弱化但仍可点开查看 / 补记，不制造假状态。`examCfg()` 对非法日期回退默认、开卷日不得晚于考试日仍然有效；逐格淡入总 stagger 恒定 ≤ .5s，翻页另用 `animateMonth()` 的方向性短位移（≤ .6s），`prefers-reduced-motion` 下跳过。
- **月份翻页组件（2026-11-11 新增，沿用本文件设计系统）**：`.cal-nav` 是 `.cal-panel` 内的一行细线控件——上一月 / 月份标题＋本月留痕数 / 下一月 / 回到今天；固定字号、细线、`--mono` 数字、零阴影零渐变、圆角 2px，不是悬浮卡片，不新增首屏大数字。交互三通道等价：按钮点击（`#calNav` 事件委托）、键盘 `←` `→`（输入框聚焦或弹层打开时不抢键）、触屏左右轻扫（水平位移 > 48px 且纵向 < 40px 才触发，不抢纵向滚动）。改考试日或用回默认时 `viewMonth` 归零，回到今天所在月。图标沿用 Lucide `chevron-left` / `chevron-right` / `rotate-ccw`，无 hover 上浮、无 hover 图标位移；月份标题与按钮文案行末不加标点。
- 静态兜底：`sync_ima.py` 的 `IDS` 增加 `calNav`，`refresh_fallback()` 一并导出导航条（含渲染后的 Lucide SVG）；跨月后每日自动同步刷新兜底会导出当天所在月，`data-day` 洁净度断言仍按当月格数校验，`replace_container()` 的同名标签配平算法不变。
- 线上站点目录 `/workspace/gkzd-site/` **只放由 `build.py` 生成的单文件 `index.html`**（自启动 `python3 -m http.server 3000`），源目录 `/workspace/gkzd/` 保留结构化文件。**同步到部署目录会立即覆盖线上内容，必须先获得当轮确认**（全自动同步任务已获长期授权）；发版一律走 `sync_ima.py`，它会调用 `build.py` 打包。
- IMA 同步映射：知识库「公考之道·行动纲要」(`ima_kb_d6gay3Kf`) 中标题匹配 `学习痕迹 YYYY-MM-DD` 的文档 → 一条痕迹；按 `date` 去重；id 用 `ima-<date>`；`by:'ima'`、`src:'学习痕迹 <date>'`；`title` 取 `·` 后的短语，`body` 取「今日终点」段，`note` 取「下一步 / 红笔批注」里给明天的一句话，`questions` 从正文明确出现的「N 题」提取；取不到的字段一律填 `null`，不用默认值兜底。
  - `questions` 口径：只认正文里明确的「N 题」表述（如「25 题」「做 11 题」）；素材行里的讲义题数、答案汇总里的题号范围不算当日实际题量，不填。2026-11-05 / 11-09 / 11-11 三篇「今日终点」段无明确「N 题」，故均填 `null`（统计题量保持 121 题，不虚增）。
  - `type` 按当日主体动作归入 `定标 / 装工具 / 用工具 / 工具落地 / 刷题 / 复盘 / 模考 / 听课 / 随手记`；`minutes`、`score` 取不到即 `null`。

## 全自动同步（2026-11-11 用户确认「全自动」）

链路：`IMA 知识库` → 定时任务触发的 Agent 会话（调 IMA MCP 读列表 / 取全文 / 按上节映射生成 JSON）→ `sync_ima.py --add <json>`（按 date 去重 → 追加 `traces.js` → 用真实浏览器导出 DOM 刷新 `index.html` 静态兜底 → `bump_versions()` → **`build.py` 把 CSS 与 7 个 JS 内联打包成零子资源单文件写入 `/workspace/gkzd-site/index.html`** → 浏览器验证 JS 开 / 关 / 零子资源三态）→ 汇报新增条目。

- 脚本：`/workspace/gkzd/sync_ima.py`（发版）、`/workspace/gkzd/build.py`（单文件打包）。子命令 `--add <json>`（常规）、`--deploy-only`（源码已手工改、只发版）、`--check`（只读体检，输出 `single_file` 摘要）。定时任务指令正文见 `.lsf/task-prompt.txt`。
- **覆盖线上不再逐次确认**（用户已授权全自动）；但「无新增」时脚本不发版，避免无意义覆盖。
- 部署目录 `/workspace/gkzd-site/` 由 `python3 -m http.server 3000` 静态托管，`restart:true` 自启动；**覆盖单文件 `index.html` 即上线**，分享链接不变，不需要重复 `publish.js`。仅当 3000 端口失活时脚本才自动重新发布。
- 定时任务：名称「IMA 学习痕迹每日同步（公考作战台）」，`daily` 每天 21:00（`0 0 21 * * *`，Asia/Shanghai），超时 300 秒 / 重试 3 次，长期有效。
- 依赖与如实边界：定时任务会话须能调用 IMA MCP（若授权失效则如实报错、不伪造成功）；链接仍绑定当前沙箱运行时，沙箱回收即失效，要长期稳定需迁到独立静态托管。

## 跨沙箱自举与 fail-closed（2026-11-13 新增）

**问题**：定时任务 `15514107` 的 `agentConfig.runtime_id` 绑定创建时的沙箱，执行会话可能落在全新沙箱，`/workspace/gkzd`（DESIGN.md、traces.js、sync_ima.py、build.py）与 `/workspace/gkzd-site` 全部缺失。2026-11-12 那次因 IMA 无新增，会话改用线上单文件里内联的 traces 比对才未出事；一旦有新增，就会因缺同步脚本与打包流水线而无法按本文件约定发版。

**解法：线上单文件即唯一持久真相源。**

- `build.py` 打包时把 `BOOTSTRAP_FILES`（源 `index.html`、`styles.css`、7 个 JS、`build.py`、`sync_ima.py`、`bootstrap.py`、`DESIGN.md`、`.lsf/task-prompt.txt`）打成 base64 zip，嵌进 HTML 注释 `<!-- LSF-BOOTSTRAP-BEGIN … LSF-BOOTSTRAP-END -->`。注释不执行、不产生 DOM、无子资源，页面行为与零子资源判定完全不变；用 `writestr` 固定 zip 元数据，内容不变则字节不变。
- 源 `index.html` 里放 `<!-- LSF-BOOTSTRAP-SLOT -->` 占位；`bootstrap.py` 恢复时把注释还原成占位符，保证可再次打包。
- `bootstrap.py --from-url <分享链接>`：解出恢复包 → 写回 `/workspace/gkzd` → 部署目录逐字节写为线上单文件 → 用恢复出来的 `build.py` 重新打包做字节自校验（`rebuild_match`）。
- `sync_ima.py` 的 `verify_online()` 增加 `public_hash_match`：发版后回读公网链接与本地单文件比对 sha256（重试 3 次），为 false 必须如实报错，不得声称上线成功。
- `build.py` / `sync_ima.py` 的 `SRC`/`SITE` 支持 `GK_SRC`/`GK_SITE` 环境变量，供 bootstrap 在临时目录做自校验，正式路径不变。

**定时任务硬规则（写进 prompt，先于任何同步动作）**：

1. **环境自检**：关键文件缺失 → 从分享链接自举恢复；`bootstrap.py --check` 与 `rebuild_match` 全绿才继续。
2. **fail-closed**：恢复失败（公网不可达 / 恢复包缺失 / 自校验不一致 / 关键文件仍缺）→ **如实报错终止，不手工改部署文件、不伪造同步、不声称成功**。这正是本次「无新增」侥幸路径不能复制到「有新增」的原因。
3. 有新增走 `sync_ima.py --add`；检查报告里 `deployed=true`、`deploy.single_file=true`、`deploy.subresource_refs=[]`、三态验证无异常、`public_hash_match=true` 全部成立，否则如实报错。
4. 无新增仍直接结束，不发版。

**剩余如实边界**：若定时任务会话运行在独立 runtime，其 `sync_ima.py` 覆盖的是自己沙箱里的部署目录；公网是否随之更新由 `public_hash_match` 判定，判不出来就报错而非假设成功。要彻底消除这一层，需把任务绑定到持有分享链接的 runtime，或迁到独立静态托管。

## GitHub Pages 永久发布（2026-11-17 迁移，用户选 A）

**问题实锤**：定时任务每次在临时沙箱执行时，`ensure_service()` 发现 3000 服务不在就调 `publish.js` 重新发布 → **每次生成一个新分享链接**（旧版"链接每晚都变"的元凶）；且临时沙箱覆盖的部署目录推不到 WorkBuddy 公网快照，四天（11-13 至 11-16）新增痕迹全部没上去。

**解法：GitHub 仓库即唯一真相源，clone 即恢复（取代网页内嵌恢复包的自举）。**

- 仓库 `xxoo13149/gkzd`（公开）：根目录 `index.html` = 部署单文件（GitHub Pages 从 main 根目录发布）；`src/` = 完整工程镜像。永久地址：**https://xxoo13149.github.io/gkzd/**（不再变更，任何汇报不得出现自生成的链接）。
- `sync_ima.py` 新增 `gh_publish()`：镜像单文件与源码进 `/tmp/gkzd-gh` 工作副本 → commit → push（重试 3 次）→ `gh_api` 等 `pages/builds/latest` 变 `built` 且 commit 匹配 → Pages 首尾 Range 抽查（尽力而为）。
- 校验口径（沙箱实测：github.com git 通道稳定，github.io / raw CDN 传输常被掐断，完整下载不可靠）：
  1. `github.remote_match=true`——远程 `main` 的 sha 与本地构建 commit 一致（git 通道校验，可靠）；
  2. `github.build=built`——Pages 已构建该 commit（API 校验，可靠）；
  3. `github.pages_probe`——首尾 4KB 抽查，`null` 属 CDN 传输受限，如实汇报不算失败。
- **`GK_SKIP_PUBLISH=1`**（定时会话硬规则）：跳过 `ensure_service()`，绝不重新发布 WorkBuddy 分享链接；本地验证改用 `GK_LOCAL_URL=file:///workspace/gkzd-site/index.html`。
- **工作克隆模式防假成功**（2026-11-17 全新环境彩排实测）：定时任务场景 `GK_SRC=/tmp/gkzd-gh/src` 即工作克隆自身。两条硬约束写进 `sync_ima.py`：① `gh_mirror_files()` 逐文件 `realpath` 判重，绝不自己复制自己（否则 SameFileError、推送必失败）；② `gh_prepare()` 在该模式下**禁止 fetch/reset/clean**——发版中途 reset 会抹掉本会话 `--add` 写入的痕迹与兜底刷新，随后提交出「无变化」的假成功。同步远程状态是任务流程步骤 0c 的职责。
- 静态兜底内嵌倒计时快照使逐次构建产物天然不同（秒级）；幂等判断只看 `remote_match`/`build`，不用「构建字节不变」当判据。令牌：IMA 知识库文档「GitHub 同步令牌」（`gho_`/`ghp_`/`github_pat_` 前缀均认），任务步骤 0a 读取。
- 定时任务 token：fine-grained PAT（只授权 gkzd 仓库、Contents RW），由用户存于 IMA 知识库文档「GitHub 同步令牌」，任务每晚会话读取后 `export GITHUB_TOKEN`；取不到如实报错终止。token 绝不写入仓库、网页、恢复包或汇报消息。
- WorkBuddy 旧链接（`aea6f47a0565841ad...`）降级为备用入口，只由用户主会话手动维护；定时任务任何情况下不碰它。
- 如实边界：GitHub Pages 在中国大陆直连可能时快时慢甚至打不开，用户已知情并将亲自实测；若不可用，备用入口仍是 WorkBuddy 链接。
