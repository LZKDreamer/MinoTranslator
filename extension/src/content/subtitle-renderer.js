/* ═══════════════════════════════════════════════
   subtitle-renderer.js — 自定义字幕渲染层
   使用 Shadow DOM 隔离，通过 requestVideoFrameCallback 同步
   ═══════════════════════════════════════════════ */

const SUBTITLE_DISPLAY_DELAY_SECONDS = 0;
const SUBTITLE_GAP_HOLD_SEC = 2.0; // 字幕间隙 <2s 时保持显示上一句，避免闪烁

class SubtitleRenderer {
  constructor() {
    this.host = null;
    this.shadow = null;
    this.video = null;
    this.cues = [];
    this.config = {
      mode: 'bilingual',
      fontSize: 'medium',
      position: 'above',
      bgOpacity: 0.6,
      originalTextColor: 50,
      translatedTextColor: 50,
      subBgColor: 0,
    };
    this.rafId = null;
    this.currentCueIndex = -1;
    this._lastRenderedIndex = -1;
    this._lastValidIndex = -1;  // 间隙 hold 策略：记录上一个有效 cue 索引
  }

  /**
   * 创建并挂载字幕 DOM 容器
   */
  mount(retries) {
    retries = retries || 0;
    if (retries > 30) {
      console.warn('[SubtitleRenderer] mount: player not found after 30s, giving up');
      return;
    }
    const player = document.querySelector('#movie_player') ||
                   document.querySelector('.html5-video-player');

    if (!player) {
      // 重试直到找到播放器，最多 30 次（30 秒）
      var self = this;
      setTimeout(function () { self.mount((retries || 0) + 1); }, 1000);
      return;
    }

    console.log('[SubtitleRenderer] mount: player found, creating host');
    debugLog('SubRenderer', 'mount: player found, creating host');
    this.host = document.createElement('div');
    this.host.id = 'yt-translate-subtitles';
    this.host.style.cssText = 'position: absolute; inset: 0; pointer-events: none; z-index: 2147483647;';

    // 确保播放器是定位祖先
    const playerStyle = getComputedStyle(player);
    if (playerStyle.position === 'static') {
      player.style.position = 'relative';
    }

    this.shadow = this.host.attachShadow({ mode: 'open' });

    // 加载样式
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('src/content/styles/subtitle.css');
    this.shadow.appendChild(styleLink);

    // 字幕容器
    const container = document.createElement('div');
    container.className = 'cue-container';
    container.id = 'cueContainer';
    this.shadow.appendChild(container);

    // 挂载到播放器容器内部——与 YouTube 原生字幕位置一致
    player.appendChild(this.host);
    console.log('[SubtitleRenderer] mount: appended to player');
    debugLog('SubRenderer', 'mount: appended to player');
  }

  /**
   * 开始渲染循环
   * @param {HTMLVideoElement} video - 视频元素
   * @param {Object} options - { cues, mode, fontSize, position, bgOpacity }
   */
  start(video, options) {
    // 强制清理旧循环和旧数据，防止跨视频残留
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.video = video;
    this.cues = options.cues || [];
    this.config = { ...this.config, ...options };
    this.currentCueIndex = -1;
    this._lastRenderedIndex = -1;
    this._lastValidIndex = -1;  // D5: 重置，避免旧 hold 残留

    console.log('[SubtitleRenderer] start: cues=' + this.cues.length + ' mode=' + this.config.mode + ' hostInDOM=' + !!(this.host && this.host.parentNode) + ' videoReadyState=' + (video ? video.readyState : 'null'));
    debugLog('SubRenderer', 'start: cues=' + this.cues.length + ' mode=' + this.config.mode + ' hostInDOM=' + !!(this.host && this.host.parentNode) + ' videoReadyState=' + (video ? video.readyState : 'null'));
    if (this.cues.length > 0) {
      console.log('[SubtitleRenderer] start: first cue=' + JSON.stringify(this.cues[0]));
      debugLog('SubRenderer', 'start: first cue=' + JSON.stringify(this.cues[0]));
    }

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }

    // D5: 监听 seeking/seeked — seek 时清空 _lastValidIndex 让 gap-hold 失效，字幕立即隐藏
    this._removeSeekListeners();
    if (video) {
      this._onSeeking = () => { this._lastValidIndex = -1; };
      this._onSeeked = () => { this._lastValidIndex = -1; };
      video.addEventListener('seeking', this._onSeeking);
      video.addEventListener('seeked', this._onSeeked);
    }

    this.renderLoop();
  }

  _removeSeekListeners() {
    if (this.video && this._onSeeking) {
      this.video.removeEventListener('seeking', this._onSeeking);
      this._onSeeking = null;
    }
    if (this.video && this._onSeeked) {
      this.video.removeEventListener('seeked', this._onSeeked);
      this._onSeeked = null;
    }
  }

  renderLoop() {
    if (!this.video || this.video.readyState < 2) {
      this.rafId = requestAnimationFrame(() => this.renderLoop());
      return;
    }

    // 视频播放结束 → 隐藏字幕但保持渲染循环（用户可能拖进度条重播）
    if (this.video.ended) {
      if (this.currentCueIndex !== -1) {
        this.currentCueIndex = -1;
        this.renderCue(-1);
      }
      this.rafId = requestAnimationFrame(() => this.renderLoop());
      return;
    }

    if (this.isAdShowing()) {
      // D5: 广告期间强制隐藏字幕，不走 gap-hold、不依赖 renderCue(-1) 一次性触发
      if (this.currentCueIndex !== -1) {
        this.currentCueIndex = -1;
      }
      const container = this.shadow && this.shadow.getElementById('cueContainer');
      if (container) {
        container.classList.remove('visible');
        container.innerHTML = '';
      }
      this.rafId = requestAnimationFrame(() => this.renderLoop());
      return;
    }

    const currentTime = this.video.currentTime;
    const cueIndex = this.findCueIndex(currentTime);

    if (cueIndex !== this.currentCueIndex) {
      this.currentCueIndex = cueIndex;
      this.renderCue(cueIndex);
    }

    this.rafId = requestAnimationFrame(() => this.renderLoop());
  }

  /**
   * 二分查找当前时间对应的字幕索引
   */
  findCueIndex(time) {
    if (!this.cues.length) return -1;
    const effectiveTime = time - SUBTITLE_DISPLAY_DELAY_SECONDS;

    let low = 0;
    let high = this.cues.length - 1;
    let found = -1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const cue = this.cues[mid];

      if (effectiveTime >= cue.start && effectiveTime < cue.end) {
        found = mid;         // 记录匹配，继续向左搜索第一个
        high = mid - 1;
      } else if (effectiveTime < cue.start) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return found;
  }

  renderCue(index) {
    const container = this.shadow.getElementById('cueContainer');
    if (!container) {
      console.log('[SubtitleRenderer] renderCue: container not found in shadow');
      debugLog('SubRenderer', 'renderCue: container not found in shadow');
      return;
    }

    if (index < 0 || index >= this.cues.length) {
      // 间隙 hold 策略：如果间隙很短，保持显示上一句避免字幕闪烁
      // D5: 广告期间或 seek 后（_lastValidIndex<0）跳过 hold，立即隐藏
      if (this._lastValidIndex >= 0 && !this.isAdShowing() && this._lastValidIndex < this.cues.length && this.video) {
        var currentTime = this.video.currentTime;
        // 二分查找第一个 start > currentTime 的 cue
        var nextCueIdx = -1;
        var lo = 0, hi = this.cues.length - 1;
        while (lo <= hi) {
          var mid = Math.floor((lo + hi) / 2);
          if (this.cues[mid].start > currentTime) {
            nextCueIdx = mid;
            hi = mid - 1;
          } else {
            lo = mid + 1;
          }
        }
        if (nextCueIdx >= 0) {
          var waitSec = this.cues[nextCueIdx].start - currentTime;
          if (waitSec < SUBTITLE_GAP_HOLD_SEC) {
            return; // 间隙很短，保持当前字幕不隐藏
          }
        }
      }
      container.classList.remove('visible');
      container.innerHTML = '';
      return;
    }
    this._lastValidIndex = index;

    const cue = this.cues[index];

    // 跳过目标语言匹配段：译文与原文相同时（即已在目标语言），不渲染字幕
    if (cue.translated && cue.translated === cue.text) {
      this._lastRenderedIndex = index;
      container.classList.remove('visible');
      container.innerHTML = '';
      return;
    }

    const mode = this.config.mode;
    const position = this.config.position;
    const wasHidden = !container.classList.contains('visible');

    // [Render] 日志：每次实际渲染都输出（含时间偏差），仅 DEBUG 模式
    if (index !== this._lastRenderedIndex && window.SUBTITLE_PIPELINE_LOG === true) {
      var delta = this.video ? (this.video.currentTime - cue.start).toFixed(3) : '?';
      console.log('[Render] cue=' + index + ' │ videoTime=' + (this.video ? this.video.currentTime.toFixed(3) : '?') + ' │ cueRange=' + cue.start.toFixed(3) + '→' + cue.end.toFixed(3) + ' │ delta=' + delta + ' │ ORIG=' + cue.text + ' │ TRANS=' + (cue.translated || '(none)'));
    }
    this._lastRenderedIndex = index;

    // 构建颜色值（滑块位置 → 颜色映射）
    const origColor = this.posToColor(this.config.originalTextColor);
    const transColor = this.posToColor(this.config.translatedTextColor);
    const bgColor = this.posToColor(this.config.subBgColor);
    const bgAlpha = this.config.bgOpacity;

    let html = '';

    if (mode === 'original') {
      html += `<div class="cue-original" style="color:${origColor}">${this.escapeHtml(cue.text)}</div>`;
    } else if (mode === 'translated') {
      html += `<div class="cue-translated" style="color:${transColor}">${this.escapeHtml(cue.translated || cue.text)}</div>`;
    } else if (mode === 'bilingual') {
      if (position === 'replace') {
        // 仅显示译文
        html += `<div class="cue-translated" style="color:${transColor}">${this.escapeHtml(cue.translated || cue.text)}</div>`;
      } else if (position === 'above') {
        // 译文在上，原文在下；译文与原文相同时跳过（目标语言匹配，无需重复显示）
        if (cue.translated && cue.translated !== cue.text) {
          html += `<div class="cue-translated" style="color:${transColor}">${this.escapeHtml(cue.translated)}</div>`;
        }
        html += `<div class="cue-original" style="color:${origColor}">${this.escapeHtml(cue.text)}</div>`;
      } else {
        // below: 原文在上，译文在下；译文与原文相同时跳过
        html += `<div class="cue-original" style="color:${origColor}">${this.escapeHtml(cue.text)}</div>`;
        if (cue.translated && cue.translated !== cue.text) {
          html += `<div class="cue-translated" style="color:${transColor}">${this.escapeHtml(cue.translated)}</div>`;
        }
      }
    }

    container.innerHTML = html;
    container.className = `cue-container size-${this.config.fontSize}`;
    // 应用背景色 + 透明度
    container.style.background = `rgba(${this.hslToRgb(bgColor)}, ${bgAlpha})`;
    container.style.borderRadius = '8px';
    container.style.padding = '8px 16px';

    if (wasHidden) {
      // 首次显示（从隐藏态→显示），用 rAF 触发淡入 transition
      requestAnimationFrame(() => {
        container.classList.add('visible');
      });
    } else {
      // 字幕间切换：保持 visible，直接替换内容，消除闪白
      container.classList.add('visible');
    }
  }

  isAdShowing() {
    const player = document.querySelector('#movie_player') ||
                   document.querySelector('.html5-video-player');
    return !!(player && player.classList && player.classList.contains('ad-showing'));
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  getMessage(key, fallback) {
    try {
      return chrome.i18n.getMessage(key) || fallback;
    } catch (_err) {
      return fallback;
    }
  }

  /**
   * 更新配置（由 Popup 设置变更时调用）
   */
  updateConfig(partial) {
    Object.assign(this.config, partial);
    // 重新渲染当前 cue
    this.renderCue(this.currentCueIndex);
  }

  updateCues(cues) {
    this.cues = cues || [];
    const nextIndex = this.video ? this.findCueIndex(this.video.currentTime) : this.currentCueIndex;
    this.currentCueIndex = nextIndex;
    this.renderCue(nextIndex);
  }

  /**
   * 将 HSL 分量转为 CSS hsl() 字符串
   */
  hslString(h, s, l) {
    return `hsl(${h}, ${s}%, ${l}%)`;
  }

  /**
   * 将 HSL 颜色转为 RGB 分量字符串（用于 rgba）
   */
  hslToRgb(hslStr) {
    // hslStr 是 hsl(h, s%, l%) 格式，提取 h, s, l
    const m = hslStr.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (!m) return '0,0,0';
    let h = parseInt(m[1]) / 360;
    let s = parseInt(m[2]) / 100;
    let l = parseInt(m[3]) / 100;
    let r, g, b;

    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }

    return `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`;
  }

  /**
   * 将滑块位置 (0-360) 映射为颜色字符串
   * 0→黑, 50→白, 50-360→彩虹全色
   */
  posToColor(pos) {
    if (pos <= 50) {
      const l = Math.round((pos / 50) * 100);
      return `hsl(0, 0%, ${l}%)`;
    }
    const hue = Math.round(((pos - 50) / 310) * 360);
    return `hsl(${hue}, 100%, 50%)`;
  }

  /**
   * 清除字幕：清空 cues 并隐藏已显示的字幕，停止渲染循环
   * （切换视频时调用，防止旧视频的字幕残留）
   */
  clear() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this._removeSeekListeners();  // D5: 移除 seek 监听
    this.cues = [];
    this.currentCueIndex = -1;
    this._lastValidIndex = -1;
    this.renderCue(-1);
  }

  /**
   * 停止并清理
   */
  destroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    this._removeSeekListeners();  // D5: 移除 seek 监听
    if (this.host && this.host.parentNode) {
      this.host.parentNode.removeChild(this.host);
    }
  }
}
