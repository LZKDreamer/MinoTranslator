# TECH: Mino Translator 官网

> **目标**: 为 `website/PRD.md` 定义首版官网技术栈、工程结构、部署方式和后续扩展边界。  
> **站点**: `www.zaymino.com`  
> **首版形态**: 单页官网，支持中英文，不提供注册登录。  

---

## 1. 技术栈结论

首版采用以下技术栈：

| 层级 | 选择 | 用途 |
|---|---|---|
| Framework | Next.js App Router | 单页官网、SEO、Metadata、静态生成、后续扩展页面 |
| Language | TypeScript | 降低文案、组件 props、下载配置的维护风险 |
| UI | React Server Components 为主，少量 Client Components | 默认静态渲染，语言切换、移动菜单等交互局部客户端化 |
| Styling | Tailwind CSS v4 | 快速建立一致的响应式视觉系统 |
| Icons | lucide-react | 使用用户指定的 lucide 图标体系 |
| i18n | next-intl | 中英文文案、locale 路由、SEO 文案本地化 |
| Animation | CSS transitions 为主，必要时使用 Motion | 首版动效克制，不引入复杂滚动动画 |
| Data | 静态配置优先 | 首版下载信息写入本地配置或环境变量 |
| Optional Backend | Supabase | 后续版本信息、下载地址、下载统计 |
| Deploy | Vercel | 托管 Next.js，绑定 `www.zaymino.com` |

---

## 2. 选型理由

### 2.1 Next.js App Router

官网虽然首版是单页，但仍需要：

1. 中英文 SEO metadata。
2. FAQ 结构化数据。
3. `robots.txt`、`sitemap.xml`、favicon、OG 图。
4. 后续扩展独立安装教程页、隐私页、功能 SEO 页。
5. Vercel 原生部署体验。

Next.js App Router 的文件约定可直接承载 metadata、robots、sitemap、图标和静态生成。官方文档也明确支持通过 App Router 做国际化路由和 metadata 管理。

### 2.2 Tailwind CSS v4

Tailwind v4 用于建立轻量、可控的视觉系统。官网风格是克制蓝白工具型页面，不需要完整组件库。Tailwind 可以降低自定义 CSS 分散风险，并让响应式布局、颜色 token、间距、焦点状态保持一致。

注意：Tailwind v4 使用 `@tailwindcss/postcss`，不要沿用 Tailwind v3 的旧 PostCSS 配置。

### 2.3 next-intl

官网明确要求中英文，且不能在组件中硬编码文案。next-intl 适合：

1. App Router。
2. locale-based routing。
3. Server Components 获取翻译。
4. SEO metadata 和页面文案共用 messages。
5. 后续扩展更多页面。

### 2.4 Supabase 暂不作为首版硬依赖

首版核心是静态官网和 ZIP 下载说明。若第一版直接引入 Supabase，会增加配置、权限、RLS 和部署变量复杂度。建议第一版用本地静态 release 配置，待下载文件稳定后再接入 Supabase。

---

## 3. 路由策略

推荐使用 locale 前缀路由：

```text
/zh-CN
/en
```

根路径 `/` 根据浏览器语言或默认语言重定向：

1. 浏览器语言为中文时进入 `/zh-CN`。
2. 其他语言默认进入 `/en`，或按产品偏好默认进入 `/zh-CN`。
3. 用户手动切换语言后保存偏好。

理由：

1. SEO 更清晰。
2. 中英文页面可分别生成 canonical、alternate links。
3. 后续扩展独立页面时结构自然，例如 `/zh-CN/guide/install`、`/en/guide/install`。

首版虽然是单页，但组件和文案结构要为多页预留。

---

## 4. 推荐目录结构

```text
website/
  app/
    [locale]/
      layout.tsx
      page.tsx
    favicon.ico
    icon.png
    opengraph-image.png
    robots.ts
    sitemap.ts
  components/
    layout/
      SiteHeader.tsx
      SiteFooter.tsx
    sections/
      HeroSection.tsx
      ProductPreviewSection.tsx
      FeaturesSection.tsx
      HowItWorksSection.tsx
      DownloadSection.tsx
      InstallSection.tsx
      ApiKeySection.tsx
      FaqSection.tsx
      PrivacySection.tsx
    ui/
      Button.tsx
      Container.tsx
      LocaleSwitcher.tsx
      MobileNav.tsx
  config/
    release.ts
    site.ts
  i18n/
    routing.ts
    request.ts
  messages/
    zh-CN.json
    en.json
  public/
    assets/
      logo.svg
      icon128.png
      product-preview.png
    downloads/
      mino-translator-latest.zip
  styles/
    globals.css
  middleware.ts
  next.config.ts
  package.json
  postcss.config.mjs
  tsconfig.json
```

说明：

1. `messages/*.json` 存放所有用户可见文案。
2. `config/release.ts` 存放版本号、文件大小、校验值、下载 URL。
3. `public/assets` 复制插件 logo 和官网视觉资源。
4. `public/downloads` 仅适合首版小文件托管；若 ZIP 较大或需要统计，改用 Supabase Storage 或其他对象存储。

---

## 5. i18n 规范

### 5.1 Locale

```ts
export const locales = ['zh-CN', 'en'] as const;
export const defaultLocale = 'zh-CN';
```

### 5.2 文案规则

1. 页面可见文案必须来自 `messages/zh-CN.json` 和 `messages/en.json`。
2. 组件内不得硬编码中文或英文正文。
3. `alt`、`aria-label`、按钮、FAQ、metadata、OG 文案都必须进入 i18n。
4. 产品名 `Mino Translator`、域名 `www.zaymino.com`、技术名 `OpenAI-compatible API` 可作为常量。
5. 中英文 key 必须保持一致。

### 5.3 Message Key

```text
nav.*
hero.*
preview.*
features.*
howItWorks.*
download.*
install.*
api.*
faq.*
privacy.*
footer.*
seo.*
aria.*
```

### 5.4 SEO 本地化

每个 locale 需要生成：

1. `title`
2. `description`
3. `openGraph.title`
4. `openGraph.description`
5. `alternates.languages`
6. FAQ JSON-LD

---

## 6. 下载与版本数据

### 6.1 首版静态配置

首版使用 `config/release.ts`：

```ts
export const release = {
  version: '1.0.0',
  fileName: 'mino-translator-latest.zip',
  fileUrl: '/downloads/mino-translator-latest.zip',
  fileSize: '',
  sha256: '',
  publishedAt: '',
  chromeWebStoreStatus: 'not_listed'
} as const;
```

如果 ZIP 尚未准备好：

1. 下载按钮显示不可用状态。
2. 文案说明“下载包即将开放”。
3. 不允许按钮点击后无响应。

### 6.2 后续 Supabase 表

后续接入 Supabase 时建议表名为 `extension_releases`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | 主键 |
| `version` | text | 版本号 |
| `file_url` | text | ZIP 下载地址 |
| `file_size` | text | 文件大小展示值 |
| `sha256` | text | 校验值 |
| `release_notes_zh` | text | 中文更新说明 |
| `release_notes_en` | text | 英文更新说明 |
| `published_at` | timestamptz | 发布时间 |
| `is_latest` | boolean | 是否最新版 |

下载统计可单独建 `download_events`，避免频繁更新 release 行。

---

## 7. 组件边界

### 7.1 Server Components

默认使用 Server Components：

1. 页面布局。
2. 静态 section。
3. FAQ 渲染。
4. release 信息展示。
5. SEO JSON-LD。

### 7.2 Client Components

仅以下交互需要 Client Components：

1. 移动端导航展开关闭。
2. 语言切换控件。
3. FAQ 手风琴，如果采用可折叠形式。
4. 下载点击统计，如果后续接入 Supabase 或 analytics。

### 7.3 避免事项

1. 不引入全局状态库。
2. 不引入大型 UI 组件库。
3. 不引入复杂动画库，除非实现阶段确有视觉需求。
4. 不把官网做成在线翻译应用。

---

## 8. 样式系统

### 8.1 Design Tokens

建议在 `globals.css` 中定义基础 token：

```css
:root {
  --background: #ffffff;
  --foreground: #102033;
  --muted: #f4f8fb;
  --muted-foreground: #526579;
  --border: #d8e4ee;
  --primary: #0b74d1;
  --primary-foreground: #ffffff;
  --ring: #2f9bf3;
}
```

### 8.2 视觉约束

1. 单一蓝色 accent。
2. 不使用 AI 紫蓝渐变作为主视觉。
3. 不使用毛玻璃作为主要设计语言。
4. 卡片圆角默认 `8px`。
5. CTA 文案桌面端必须保持单行。
6. 所有按钮满足 WCAG AA 对比度。
7. 移动端导航高度和按钮点击区域满足可触达要求。

---

## 9. 图标与资源

### 9.1 图标

使用 `lucide-react`，统一规则：

1. `strokeWidth={1.75}` 或全站统一 token。
2. 图标只用于辅助识别，不替代文字标签。
3. 不手写 SVG path。
4. 不混用其他图标库。

### 9.2 Logo

来源：

```text
D:\codeproject\translator\extension\icons
```

实现时复制到：

```text
website/public/assets/
```

建议：

1. `logo.svg` 用于 header 和 footer。
2. `icon128.png` 用于 favicon 或 OG 图素材。
3. 不修改原始 logo 造型。

---

## 10. SEO 与 Metadata

### 10.1 必备文件

1. `app/[locale]/layout.tsx`: locale metadata。
2. `app/robots.ts`: 生成 robots。
3. `app/sitemap.ts`: 生成 sitemap。
4. `app/opengraph-image.png`: 默认 OG 图。
5. `app/icon.png` 或 `app/favicon.ico`: 站点图标。

### 10.2 JSON-LD

页面需要输出：

1. `SoftwareApplication`
2. `FAQPage`

JSON-LD 的文字也要按 locale 生成。

### 10.3 Canonical

```text
https://www.zaymino.com/zh-CN
https://www.zaymino.com/en
```

根路径 `/` 只负责语言重定向，不作为主要 canonical。

---

## 11. 部署

### 11.1 Vercel

1. 连接仓库。
2. Project root 设置为 `website`。
3. Framework Preset 选择 Next.js。
4. Production Domain 绑定 `www.zaymino.com`。
5. 开启 HTTPS。

### 11.2 环境变量

首版可不需要环境变量。

如果下载地址不放入代码，可使用：

```text
NEXT_PUBLIC_DOWNLOAD_URL=
NEXT_PUBLIC_RELEASE_VERSION=
NEXT_PUBLIC_RELEASE_SHA256=
NEXT_PUBLIC_RELEASE_SIZE=
```

如果接入 Supabase：

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

不要在前端环境变量中放入 Supabase service role key。

---

## 12. 测试与验收

### 12.1 本地检查

```bash
npm run lint
npm run build
```

如配置测试：

```bash
npm run test
```

### 12.2 页面验收

1. `/zh-CN` 和 `/en` 均可访问。
2. `/` 能按语言策略跳转。
3. 所有可见文案来自 messages。
4. 桌面和移动端没有文字溢出。
5. 下载按钮在 ZIP 未配置时有明确不可用状态。
6. Chrome Web Store 未上架提示可见。
7. FAQ JSON-LD 能按 locale 输出。
8. `robots.txt` 和 `sitemap.xml` 可访问。

### 12.3 浏览器验证

实现阶段需要用 Playwright 或 Vercel preview 检查：

1. 1440px 桌面。
2. 1024px 平板。
3. 390px 移动端。
4. 中英文切换。
5. 锚点跳转。
6. 下载按钮状态。

---

## 13. 官方参考

1. Next.js App Router metadata、robots、sitemap 文件约定。
2. Next.js internationalization guide。
3. Tailwind CSS v4 Next.js / PostCSS 安装说明。
4. next-intl App Router 与 locale routing 文档。
5. Vercel Next.js 部署文档。

---

## 14. 实现阶段初始化命令

在 `D:\codeproject\translator\website` 下初始化。

如果需要安装 Node.js、包管理器或其他工具，下载安装根目录必须使用：

```text
D:\software
```

建议初始化命令：

```bash
npx create-next-app@latest . --typescript --eslint --app --src-dir false
npm install next-intl lucide-react
npm install tailwindcss @tailwindcss/postcss postcss
```

实际执行前需检查当前目录是否已有文件，避免覆盖 `PRD.md` 和 `TECH.md`。
