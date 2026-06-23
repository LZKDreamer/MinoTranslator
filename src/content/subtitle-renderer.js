/* ═══════════════════════════════════════════════
   subtitle-renderer.js — 自定义字幕渲染层
   使用 Shadow DOM 隔离，通过 requestVideoFrameCallback 同步
   ═══════════════════════════════════════════════ */

class SubtitleRenderer {
  constructor() {
    this.host = null;
    this.shadow = null;
    this.video = null;
    this.cues = [];
    this.config = {
      mode: 'bilingual',
      fontSize: 'medium',
      position: 'below',
      bgOpacity: 0.6,
    };
    this.rafId = null;
    this.currentCueIndex = -1;
  }

  /**
   * 创建并挂载字幕 DOM 容器
   */
  mount() {
    const player = document.querySelector('#movie_player') ||
                   document.querySelector('.html5-video-player');

    if (!player) {
      // 重试直到找到播放器
      setTimeout(() => this.mount(), 1000);
      return;
    }

    this.host = document.createElement('div');
    this.host.id = 'yt-translate-subtitles';
    this.host.style.cssText = 'position: absolute; bottom: 8%; left: 0; right: 0; pointer-events: none; z-index: 1000;';

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

    // 插入到视频播放器
    // 尝试找到正确的插入位置——在 ytp-caption-window-container 旁边或在播放器底部
    const captionWindow = player.querySelector('.ytp-caption-window-container');
    if (captionWindow) {
      captionWindow.style.display = 'none'; // 隐藏 YouTube 原生字幕
      captionWindow.parentNode.insertBefore(this.host, captionWindow);
    } else {
      player.appendChild(this.host);
    }
  }

  /**
   * 开始渲染循环
   * @param {HTMLVideoElement} video - 视频元素
   * @param {Object} options - { cues, mode, fontSize, position, bgOpacity }
   */
  start(video, options) {
    this.video = video;
    this.cues = options.cues || [];
    this.config = { ...this.config, ...options };

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }

    this.renderLoop();
  }

  renderLoop() {
    if (!this.video || this.video.readyState < 2) {
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

    let low = 0;
    let high = this.cues.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const cue = this.cues[mid];

      if (time >= cue.start && time < cue.end) {
        return mid;
      } else if (time < cue.start) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return -1;
  }

  renderCue(index) {
    const container = this.shadow.getElementById('cueContainer');
    if (!container) return;

    container.className = 'cue-container';

    if (index < 0 || index >= this.cues.length) {
      container.classList.remove('visible');
      container.innerHTML = '';
      return;
    }

    const cue = this.cues[index];
    const mode = this.config.mode;

    let html = '';

    if (mode === 'original' || mode === 'bilingual') {
      html += `<div class="cue-original">${this.escapeHtml(cue.text)}</div>`;
    }

    if ((mode === 'translated' || mode === 'bilingual') && cue.translated) {
      html += `<div class="cue-translated">${this.escapeHtml(cue.translated)}</div>`;
    }

    container.innerHTML = html;
    container.className = `cue-container size-${this.config.fontSize}`;

    // 触发 transition
    requestAnimationFrame(() => {
      container.classList.add('visible');
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 更新配置（由 Popup 设置变更时调用）
   */
  updateConfig(partial) {
    Object.assign(this.config, partial);
    // 重新渲染当前 cue
    this.renderCue(this.currentCueIndex);
  }

  /**
   * 停止并清理
   */
  destroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    if (this.host && this.host.parentNode) {
      this.host.parentNode.removeChild(this.host);
    }
  }
}
