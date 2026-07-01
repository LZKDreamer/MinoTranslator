## Context

Popup 宽度 340px，item 内部结构为 thumb(44px) + meta(flex) + button(48px)，meta 可用宽度约 208px。当前两行结构（title + status）中 status 行承载了语言对和状态指示两种语义，导致文字过长、视觉拥挤。

## Goals / Non-Goals

**Goals:**
- 语言对与状态分开展示，各自独占一行不截断
- COMPLETED 卡片不回退到拥挤的一行——语言对本身已完整表达信息，状态行省略
- 改动最小化，复用现有 CSS 变量和排版节奏

**Non-Goals:**
- 不改变按钮布局、缩略图样式、进度环设计
- 不引入新的颜色体系或字体变化

## Decisions

### Decision 1: 两行变三行（可选）

```
当前:                          改后:
┌──────────────────────┐      ┌──────────────────────┐
│ 📺 韩国综艺           │      │ 📺 韩国综艺           │
│   한국어→简体中文·翻...│      │   한국어 → 简体中文   │  ← .video-lang
│              [取消]   │      │   翻译中...  [取消]   │  ← .video-status (条件)
└──────────────────────┘      └──────────────────────┘
```

模板新增 `.video-lang`  `<div>`，位于 `.video-title` 和 `.video-status` 之间。

### Decision 2: COMPLETED 状态省略状态行

已完成视频的 item 只需要两行（title + lang），状态行 `display: none`。

```javascript
function getStatusLabel(item) {
    var src = getDisplayLangName(item.sourceLanguage, t);
    var tgt = getDisplayLangName(item.targetLanguage, t);
    var pair = src + ' → ' + tgt;
    var status = null;
    if (item.status === STATUS.PREPARING) status = t('popup.statusPreparing', '准备字幕');
    else if (item.status === STATUS.TRANSLATING) status = t('popup.statusTranslating', '翻译中...');
    else if (item.status === STATUS.FAILED) status = t('popup.statusFailed', '失败');
    else if (item.status === STATUS.AVAILABLE) status = t('popup.statusAvailable', '可翻译');
    return { lang: pair, status: status };
}
```

`renderItems` 中：
```javascript
$lang.textContent = label.lang;
if (label.status) {
    $status.textContent = label.status;
    $status.hidden = false;
} else {
    $status.hidden = true;
}
```

### Decision 3: CSS 调整

```css
.video-item {
    min-height: 62px;  /* 原 58px, 适配三行 */
}

.video-lang {
    font-size: 12px;
    color: var(--color-ink);
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
}

.video-status {
    font-size: 11px;        /* 原 12px, 状态更轻 */
    color: var(--color-muted);
    line-height: 1.35;
    white-space: nowrap;
}

.video-status.is-error {
    color: var(--color-danger);
}
```

## Risks / Trade-offs

- [卡片高度增加 ~4px] → 可接受，340×176 视口下仍可展示 2-3 个 item
- [CANCELED 状态无语言对] → 此时 `.video-lang` 为空或隐藏，仅显示状态
