<!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->
---
name: YouTube 翻译插件
description: 极简实用的 Chrome 翻译扩展，专注 YouTube 字幕翻译与划词翻译
---

# Design System: YouTube 翻译插件

## 1. Overview

**Creative North Star: "The Invisible Translator"**

一个在需要时出现、不需要时消失的翻译工具。它不喧宾夺主——用户打开 YouTube 视频，译文字幕静静地出现在画面下方；用户选中一段外文，翻译气泡悄然浮现。工具本身几乎不被感知，只有翻译结果在说话。

**品牌气质：** 简洁、高效、友好。参考 DeepL 的蓝白极简、Linear 的干净克制、Arc Browser 的精良细节。

**Key Characteristics:**
- 浅色为主，蓝色点缀。色彩服务于功能，不是装饰
- 大量留白，信息层级清晰，不拥挤
- 过渡动画平顺克制（0.2s ease），不打扰操作节奏
- 所有界面优先考虑"最小认知负担"——用户一看就懂，不需要学习

**明确拒绝：** 拥挤的卡片堆叠、彩虹配色、毛玻璃效果、过度动画、渐变文字。复杂设置藏在 Options 页面，Popup 只展示高频操作。

## 2. Colors

**策略：克制型 — 中性色 + 一个蓝色主色调点缀（≤10% 面积）**

### Primary
- **Deep Blue** (`oklch(50% 0.15 260)` → 实施时解析为 hex): 可交互元素的主色——开关激活态、链接、选中状态。仅用于功能性强调，不用于装饰

### Neutral
- **White** (`oklch(100% 0 0)`): 页面背景、卡片背景
- **Off-White** (`oklch(97% 0.005 260)` → 微偏蓝的中性浅灰): 次级背景、hover 状态
- **Light Border** (`oklch(90% 0.01 260)`): 分割线、输入框边框、卡片边框
- **Body Text** (`oklch(25% 0.02 260)`): 正文文本
- **Muted Text** (`oklch(55% 0.02 260)`): 辅助文字、说明文本、占位符

> 色值 `[待实施时解析为 hex]`。当前标注为 OKLCH 参考值，实施时转为具体 hex 并写入 CSS 变量。

### Named Rules
**The 10% Rule.** 蓝色主色在任意界面上的覆盖面积不超过 10%。它的稀缺性就是它的力量——用户看到蓝色就知道"这个可以点"。

## 3. Typography

**统一无衬线体，保证跨平台一致性。**

**Display / Body / Label Font:** `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", Roboto, sans-serif`

系统原生字体栈。没有自定义 web font——这是一个 Chrome 扩展，加载额外字体会增加打包体积和安装时间，且 Popup 窗口不需要华丽的排版。

### Hierarchy
- **Body** (400, `14px`, 1.5): Popup 正文、Options 表单内容、字幕文本
- **Body Small** (400, `12px`, 1.4): 辅助文字、版本号、副标签
- **Title** (600, `16px`, 1.4): 设置页区域标题
- **Label** (500, `13px`, 1.4, uppercase + 0.05em tracking): 表单字段标签、按钮文字

> 字体配对 `[待实施时确认]`。Popup 使用 14px 为主体——320px 宽的弹窗不需要标题尺寸层级。

## 4. Elevation

**扁平为主，轻度分层。**

这个系统不使用投影来表达深度。层级关系通过**背景色深浅**来表达：
- 最上层（弹出层、浮动气泡）：纯白背景（`oklch(100% 0 0)`）
- 中间层（卡片、设置区域）：Off-White 背景（`oklch(97% 0.005 260)`）
- 底层（页面背景）：White

Popup 本身作为浏览器扩展的弹出窗口，不添加额外阴影——浏览器已提供默认的弹窗边框。

### Named Rules
**The Flat Rule.** 所有表面在静止状态下无阴影。深度仅通过色彩明度传达。

## 5. Components

> 组件尚未实现。Seed 阶段省略详细组件规范。实施时——运行 `/impeccable document` 重新提取。

## 6. Do's and Don'ts

### Do:
- **Do** 使用系统原生无衬线字体栈，不加载外部字体
- **Do** 用背景色深浅区分层级，而不是投影
- **Do** 保持 Popup 宽度在 320px 以内，不滚动
- **Do** 过渡动画用 0.2s ease，保持一致的缓动曲线
- **Do** 使用蓝色 `oklch(50% 0.15 260)` 作为唯一的交互强调色
- **Do** 正文文本与背景对比度 ≥ 4.5:1

### Don't:
- **Don't** 使用彩虹配色、渐变文字、毛玻璃效果——色彩只在功能需要时出现
- **Don't** 制造拥挤的卡片堆叠或密集的信息层级——留白是功能
- **Don't** 在 Popup 中展示过多功能——只放高频操作，其他放 Options
- **Don't** 使用超过 0.2s 的动画——插件 UI 需要瞬时响应
- **Don't** 在 Popup 或 Options 中添加装饰性元素——每个像素都应服务于功能
