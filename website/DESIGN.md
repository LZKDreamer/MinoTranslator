# DESIGN: Mino Translator 官网设计系统

> **视觉方向**: Install Confidence  
> **适用范围**: `www.zaymino.com` 单页官网  
> **产品定位**: Chrome 翻译扩展官网，主打 YouTube 双语字幕翻译和网页划词翻译  
> **设计目标**: 用柔和 claymorphism 建立亲和力，同时用清晰安装信息建立信任  

---

## 1. 设计结论

Mino Translator 官网采用 **Install Confidence** 方向。

这个方向的核心不是单纯展示一个漂亮 hero，而是把用户最关心的三个问题放进首屏视觉里：

1. 这个插件能翻译 YouTube 字幕吗？
2. 当前没有上架 Chrome Web Store，我该怎么安装？
3. 我需要准备什么配置才能使用？

视觉上参考 claymorphism 的柔软、悬浮、圆润和亲和力，但不照搬玩具感。页面必须保持工具产品的可信、清楚、可操作。

---

## 2. Design Read

Reading this as: Chrome 扩展产品官网，面向观看外语 YouTube 视频和阅读外文网页的个人用户，视觉语言应是柔和、可信、易安装，leaning toward claymorphism SaaS landing with clear product proof and install guidance.

设计参数：

| 维度 | 值 | 说明 |
|---|---:|---|
| `DESIGN_VARIANCE` | 6 | 比极简官网更有记忆点，但不做实验性布局 |
| `MOTION_INTENSITY` | 3 | 静态为主，只有 hover、active、轻微出现动效 |
| `VISUAL_DENSITY` | 4 | 信息清楚，首屏承载产品预览和安装信任 |

---

## 3. 品牌视觉原则

### 3.1 关键词

1. 柔和
2. 清楚
3. 可信
4. 不打扰
5. 容易安装

### 3.2 允许

1. 浅 lavender / icy blue 背景。
2. 柔软的 raised clay surface。
3. 轻微内高光和外阴影。
4. 圆润、友好的标题字体。
5. 产品预览作为首屏主要视觉。
6. 蓝色主 CTA，少量蓝紫品牌渐变。

### 3.3 禁止

1. 不做纯白极简到没有记忆点。
2. 不做满屏紫色 AI 渐变。
3. 不做糖果色、儿童玩具感 clay。
4. 不做 pricing、login、团队协作等与 PRD 无关内容。
5. 不使用 fake metrics，例如 `99.99%`、`50,000+ users`。
6. 不用 emoji 做功能图标。
7. 不做卡片套卡片。
8. 不在可见页面文案中使用 em dash 或 en dash。

---

## 4. 色彩系统

### 4.1 主题

首版使用 light theme。页面基底不是纯白，而是非常浅的 lavender。

| Token | Hex | 用途 |
|---|---|---|
| `--background` | `#F7F4FC` | 页面背景 |
| `--surface` | `#FFFFFF` | 主 clay surface |
| `--surface-soft` | `#F1F7FF` | 冰蓝辅助面 |
| `--surface-lavender` | `#F2ECFF` | 品牌辅助面 |
| `--foreground` | `#182235` | 主文本 |
| `--muted-foreground` | `#637086` | 正文和辅助文本 |
| `--border` | `#DCE6F3` | 细边框 |
| `--primary` | `#0B74D1` | 主 CTA、链接、焦点 |
| `--primary-hover` | `#095FAE` | CTA hover |
| `--accent-violet` | `#7848F4` | logo 辅助色和少量品牌高光 |
| `--success` | `#35D18A` | 真实状态提示 |
| `--warning` | `#B36B00` | Chrome Web Store 未上架提示 |

### 4.2 渐变规则

允许一处强渐变：主 CTA 或 logo。

```css
--gradient-brand: linear-gradient(135deg, #0B74D1 0%, #2F57F6 48%, #7848F4 100%);
```

使用限制：

1. Header logo 可使用原始渐变。
2. 主 CTA 可使用 brand gradient。
3. 其他 section 不使用大面积渐变背景。
4. 正文、标题不使用渐变文字。

---

## 5. Clay Surface 系统

### 5.1 Surface 类型

| 类型 | 用途 | Radius | Shadow |
|---|---|---:|---|
| `surface-nav` | 顶部悬浮导航 | 999px | 中等柔和阴影 |
| `surface-product` | 首屏产品预览 | 24px | 强柔和阴影 |
| `surface-panel` | 下载、安装、FAQ 分组 | 18px | 中等柔和阴影 |
| `surface-control` | 按钮、语言切换、状态 pill | 999px | 轻柔阴影 |
| `surface-inline` | 小标签、提示、行内状态 | 999px | 极轻阴影 |

### 5.2 Shadow Token

```css
--shadow-clay-sm:
  6px 8px 18px rgb(77 95 130 / 0.10),
  -6px -6px 16px rgb(255 255 255 / 0.78);

--shadow-clay-md:
  14px 18px 42px rgb(77 95 130 / 0.14),
  -10px -10px 28px rgb(255 255 255 / 0.84),
  inset 1px 1px 0 rgb(255 255 255 / 0.72);

--shadow-clay-lg:
  28px 32px 72px rgb(77 95 130 / 0.18),
  -16px -16px 44px rgb(255 255 255 / 0.88),
  inset 1px 1px 0 rgb(255 255 255 / 0.76);
```

### 5.3 使用边界

1. Clay surface 用在首屏 product preview、导航、下载卡、安装步骤、FAQ 分组。
2. 普通段落、section header、footer 不强行 clay 化。
3. 一个区域内最多 2 层 elevation，避免“软块叠软块”。
4. clay panel 内部可以有细边框或浅色底，但不能再放大型 clay panel。

---

## 6. 字体与排版

### 6.1 字体

推荐：

```text
Display / UI: Geist
Mono: Geist Mono
Fallback: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
```

理由：

1. Geist 足够现代和友好。
2. 比 Inter 更少模板感。
3. 中英文混排时仍保持清楚。

### 6.2 Type Scale

| Token | Desktop | Mobile | 用途 |
|---|---:|---:|---|
| `display-xl` | 72px / 1.02 | 42px / 1.08 | Hero H1 |
| `display-lg` | 52px / 1.08 | 34px / 1.12 | 大 section 标题 |
| `heading-md` | 28px / 1.2 | 24px / 1.25 | 卡片和模块标题 |
| `body-lg` | 20px / 1.65 | 18px / 1.55 | Hero 副文案 |
| `body-md` | 16px / 1.7 | 16px / 1.65 | 正文 |
| `label` | 13px / 1.2 | 13px / 1.2 | 导航、按钮、小标签 |

### 6.3 排版规则

1. Hero H1 桌面最多 2 行。
2. Hero 副文案最多 4 行。
3. 中文标题避免过度断行。
4. 英文正文行宽不超过 65ch。
5. 不使用全站 uppercase eyebrow。最多保留 2 个小标签：Hero 状态和下载状态。

---

## 7. 页面结构

首版仍是单页官网 `/`，按以下顺序组织：

1. Floating Header
2. Hero + Install Confidence Preview
3. Feature Overview
4. Product Scenes
5. Download ZIP
6. Install Steps
7. API Key Setup
8. FAQ
9. Privacy and Trust
10. Footer

---

## 8. 核心模块设计

### 8.1 Floating Header

布局：

```text
[ logo + Mino Translator ] [ Features Install FAQ ] [ EN / 中文 ] [ Download ZIP ]
```

设计：

1. 居中最大宽度 `1040px` 到 `1120px`。
2. 高度 `64px` 到 `72px`。
3. 背景为 `surface-nav`。
4. 桌面端固定在顶部，距离顶部 `24px`。
5. 移动端可变为顶部条加菜单按钮。

交互：

1. nav link hover 使用蓝色文本和轻微 raised 背景。
2. Download ZIP 始终是最明显 CTA。
3. 语言切换是 text button 或 compact segmented control。

### 8.2 Hero

视觉目标：

用户第一屏就看到：这是翻译插件，有 YouTube 字幕，有安装步骤，当前通过 ZIP 安装。

结构：

```text
H1
Subcopy
CTA row
Status pill
Large product/install preview
```

推荐文案方向：

```text
H1: A softer way to translate YouTube
Subcopy: Bilingual subtitles for videos, quick translation for selected text, and a clear ZIP install path for Chrome.
Primary CTA: Download ZIP
Secondary CTA: Install guide
Status: Not on Chrome Web Store yet
```

中文方向：

```text
H1: 更轻松地翻译 YouTube
Subcopy: 为视频显示双语字幕，为网页选中文本快速翻译，并提供清晰的 Chrome ZIP 安装流程。
Primary CTA: 下载 ZIP
Secondary CTA: 查看安装步骤
Status: 暂未上架 Chrome Web Store
```

注意：

1. Hero 文案来自 i18n，不在组件硬编码。
2. Status pill 是真实状态，不是装饰。
3. 不在 Hero 放功能长列表。

### 8.3 Install Confidence Preview

首屏下方的大 clay product card，包含左右两块：

左侧：YouTube 视频翻译预览

1. 视频画面应真实像播放器，而不是空白矩形。
2. 底部显示双语字幕。
3. 字幕背景半透明深色，体现可读性。
4. 可出现插件小弹窗，展示目标语言和翻译进度。

右侧：安装信任清单

1. ZIP downloaded
2. Open `chrome://extensions`
3. Load unpacked
4. Add API key

中文对应：

1. 下载 ZIP
2. 打开 `chrome://extensions`
3. 加载已解压扩展
4. 填写 API Key

设计：

1. 整体使用 `surface-product`。
2. 内部左右分栏，桌面约 `58 / 42`。
3. 移动端变为上下堆叠。
4. 安装清单使用 grouped rows，不用每行一个大卡片。

### 8.4 Feature Overview

不要做传统 3 个等宽卡片。采用 4 个 clay tile，但尺寸有节奏：

```text
[ Bilingual subtitles - wide ]
[ Selection translation ] [ Custom API ]
[ ZIP install - wide or tall ]
```

每个 tile 包含：

1. lucide icon。
2. 功能标题。
3. 一句话说明。
4. 可选一张产品微预览。

图标建议：

| 功能 | lucide |
|---|---|
| YouTube 字幕 | `Subtitles` |
| 划词翻译 | `MousePointerClick` |
| API 配置 | `KeyRound` |
| ZIP 安装 | `PackageOpen` |
| 隐私 | `ShieldCheck` |
| 语言 | `Languages` |

### 8.5 Product Scenes

两个场景以非重复布局呈现：

1. YouTube 字幕翻译：大图在右，文字在左。
2. 网页划词翻译：大图在左，文字在右。

避免连续多个 zigzag。中间可以用 full-width feature band 打断。

每个场景说明只回答：

1. 用户做什么。
2. 插件出现在哪里。
3. 为什么不打扰。

### 8.6 Download ZIP

这是页面第二重要 CTA。

设计：

1. 使用 `surface-panel`。
2. 左侧是版本信息和状态。
3. 右侧是大 Download ZIP 按钮。
4. 未配置 ZIP 时按钮为 disabled，并显示“下载包即将开放”。

必须展示：

1. 当前未上架 Chrome Web Store。
2. 文件版本。
3. 文件大小。
4. SHA256，如可用。
5. 更新日期，如可用。

### 8.7 Install Steps

视觉上做成水平 workflow river，不是普通长列表。

桌面：

```text
Download ZIP -> Unzip folder -> Load unpacked -> Add API key
```

移动：

```text
Download ZIP
Unzip folder
Load unpacked
Add API key
```

规则：

1. 不使用 “Step 1 / Step 2” 作为主要标签。
2. 直接用动作作为标题。
3. `chrome://extensions` 使用 monospace pill。
4. 每个步骤最多 2 行说明。

### 8.8 API Key Setup

这个模块要减少误解：

1. 官网不提供 API Key。
2. 用户在扩展设置里填写 OpenAI-compatible API。
3. API Key 不进入官网账号系统。

布局建议：

1. 左侧短说明。
2. 右侧展示设置面板截图或生成图。
3. 用 `KeyRound`、`ServerCog`、`ShieldCheck` 图标辅助。

### 8.9 FAQ

设计：

1. 使用一个 grouped clay surface。
2. FAQ 行使用轻量分隔，不每个问题一个大卡。
3. 展开状态有清楚 hover 和 focus。
4. FAQ JSON-LD 文案来自 i18n。

首版 FAQ 至少覆盖 PRD 中 8 个问题。

### 8.10 Privacy and Trust

用平静、短句表达，不做法律长文。

建议内容：

1. No account required。
2. Website does not process translation text。
3. Translation requests go to your configured API provider。
4. API Key is stored by the browser extension。

中文对应：

1. 无需注册账号。
2. 官网不处理翻译文本。
3. 翻译请求发送到你配置的 API 服务。
4. API Key 由浏览器扩展存储。

---

## 9. 组件规范

### 9.1 Button

类型：

| Variant | 用途 |
|---|---|
| `primary` | Download ZIP |
| `secondary` | Install guide |
| `ghost` | nav、language |
| `disabled` | ZIP 未配置 |

Primary:

```css
background: var(--gradient-brand);
color: white;
border-radius: 999px;
box-shadow: var(--shadow-clay-sm);
```

交互：

1. Hover: `translateY(-1px)`，阴影略增强。
2. Active: `translateY(1px)`，阴影收紧。
3. Focus: 2px blue ring，offset 3px。
4. Disabled: 不透明度降低，禁止 hover 动效。

### 9.2 Status Pill

用于真实状态：

1. Not on Chrome Web Store yet。
2. ZIP install for Chrome。
3. Latest version。

规则：

1. 全页最多 3 个状态 pill。
2. 绿色点只用于真实可用状态。
3. 未上架状态使用 warning 文本或边框，不用危险红。

### 9.3 Clay Card

规则：

1. 单卡最小内边距 `24px`。
2. 大 preview 内边距 `28px` 到 `36px`。
3. 卡片之间距离至少 `20px`。
4. 卡片内不要再嵌套大卡。

### 9.4 Icon

使用 `lucide-react`：

```tsx
<Icon size={20} strokeWidth={1.75} />
```

规则：

1. 同一模块图标尺寸一致。
2. 图标颜色默认 `--primary`。
3. 图标不单独承担语义，旁边必须有文本。

---

## 10. 响应式规则

### 10.1 Breakpoints

| Breakpoint | 用途 |
|---|---|
| `< 640px` | 手机 |
| `640px - 1023px` | 平板 |
| `>= 1024px` | 桌面 |
| `>= 1280px` | 宽屏 |

### 10.2 Desktop

1. 最大内容宽度 `1180px`。
2. Header 宽度 `min(1120px, calc(100vw - 48px))`。
3. Hero H1 居中或轻微偏左，产品 preview 在首屏下半部分。
4. 首屏 CTA 必须可见。

### 10.3 Mobile

1. Header 变为紧凑顶部条。
2. H1 最大 3 行。
3. 产品 preview 上下堆叠。
4. 安装步骤变为纵向 timeline。
5. CTA row 可纵向堆叠，按钮宽度 `100%`。
6. 不使用横向滚动承载关键内容。

---

## 11. Motion

首版动效保持低强度。

允许：

1. Button hover 和 active。
2. Header 轻微 sticky shadow。
3. FAQ 展开折叠。
4. Section 首次进入视口时轻微 opacity / translateY。

不允许：

1. 大幅 parallax。
2. 无限漂浮 clay 物体。
3. 鼠标磁吸。
4. 滚动劫持。
5. 影响阅读的循环动画。

必须支持 `prefers-reduced-motion`。

---

## 12. 图片和产品预览

### 12.1 首选资产

1. 插件真实截图。
2. 通过 imagegen 生成的产品场景图。
3. 明确标注为产品示意的静态图。

### 12.2 必备视觉

1. YouTube 视频播放器和双语字幕。
2. 扩展 popup 或设置面板。
3. 网页划词翻译气泡。
4. ZIP 安装清单。

### 12.3 禁止

1. 空白矩形假装 screenshot。
2. 与产品无关的 SaaS dashboard。
3. 人物 stock photo。
4. 只有抽象软块没有产品能力。

---

## 13. i18n 设计约束

1. 中英文文案长度差异需要预留空间。
2. 按钮宽度不能刚好卡英文长度。
3. Hero H1 中文和英文都要审查换行。
4. FAQ 行标题支持两行，但不应超过两行。
5. 图片 alt、aria-label、状态文案全部来自 i18n。
6. 不把 `Download ZIP`、`Install guide` 等按钮写死在组件里。

---

## 14. SEO 与可访问性

### 14.1 SEO

1. H1 只出现一次。
2. 每个主要模块使用 H2。
3. FAQ 使用真实文本，不放在图片里。
4. FAQ 输出 JSON-LD。
5. 中英文 metadata 与页面语言一致。

### 14.2 Accessibility

1. 正文对比度不低于 WCAG AA。
2. 主 CTA 对比度不低于 4.5:1。
3. 所有交互元素有 focus-visible。
4. Clay 阴影不能成为唯一边界，必要时加 1px border。
5. 状态不能只靠颜色表达。

---

## 15. 实现 Token 草案

```css
:root {
  --background: #f7f4fc;
  --surface: #ffffff;
  --surface-soft: #f1f7ff;
  --surface-lavender: #f2ecff;
  --foreground: #182235;
  --muted-foreground: #637086;
  --border: #dce6f3;
  --primary: #0b74d1;
  --primary-hover: #095fae;
  --accent-violet: #7848f4;
  --success: #35d18a;
  --warning: #b36b00;
  --radius-sm: 8px;
  --radius-md: 14px;
  --radius-lg: 18px;
  --radius-xl: 24px;
  --radius-pill: 999px;
}
```

```css
.surface-clay {
  border: 1px solid rgb(255 255 255 / 0.72);
  background: var(--surface);
  box-shadow:
    14px 18px 42px rgb(77 95 130 / 0.14),
    -10px -10px 28px rgb(255 255 255 / 0.84),
    inset 1px 1px 0 rgb(255 255 255 / 0.72);
}
```

---

## 16. Preflight Checklist

实现完成前必须检查：

1. Hero 首屏能同时看出产品能力和安装路径。
2. 页面使用 claymorphism，但没有卡片套卡片。
3. 主色为蓝色，紫色只作为品牌辅助。
4. 没有 pricing、login、团队协作等无关内容。
5. 没有 fake metrics。
6. `Download ZIP` 未配置时状态明确。
7. Chrome Web Store 未上架提示可见。
8. 中英文文案都来自 i18n。
9. 桌面导航一行显示。
10. 移动端没有文字溢出。
11. CTA 对比度合格。
12. FAQ 可被搜索引擎读取。
13. 页面没有 em dash 或 en dash 作为可见文案。

---

## 17. 后续实现建议

1. 先实现静态页面和 i18n，不急于接 Supabase。
2. 首屏产品 preview 可先使用 imagegen 生成图，再替换为真实截图。
3. 下载模块先读取 `config/release.ts`。
4. 等 ZIP 发布流程稳定后再考虑 Supabase Storage 和下载统计。
5. 设计验收优先看 1440px、1024px、390px 三个宽度。
