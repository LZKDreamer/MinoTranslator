(function () {
  'use strict';

  /* ── I18n ────────────────────────────── */
  const SUPPORTED = ['zh-CN', 'en'];
  const FALLBACK = 'en';

  function detectUILang() {
    // 优先使用用户设置
    if (state.uiLanguage && state.uiLanguage !== 'auto') return state.uiLanguage;
    const raw = chrome.i18n.getUILanguage();
    if (SUPPORTED.includes(raw)) return raw;
    const prefix = raw.split('-')[0];
    if (prefix === 'zh') return 'zh-CN';
    if (prefix === 'en') return 'en';
    return FALLBACK;
  }

  async function loadMessages(lang) {
    try {
      const url = chrome.runtime.getURL('src/i18n/' + lang + '.json');
      const resp = await fetch(url);
      return resp.json();
    } catch (_err) {
      return {};
    }
  }

  function applyI18n(messages) {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      const key = el.dataset.i18n;
      const parts = key.split('.');
      let val = messages;
      for (const p of parts) {
        val = val?.[p];
        if (!val) break;
      }
      if (val) el.textContent = val;
    });
  }

  function t(key, fallback) {
    const parts = key.split('.');
    let val = _messages;
    for (const p of parts) {
      val = val?.[p];
      if (!val) return fallback || key;
    }
    return val;
  }

  /* ── State ───────────────────────────── */
  const DEFAULTS = { targetLanguage: 'zh-CN', uiLanguage: 'auto', defaultModel: 'agnes-ai', models: { 'agnes-ai': { apiKey: '' } } };

  let state = { ...DEFAULTS };
  let showAllCompleted = false;
  let refreshTimer = null;
  let isRefreshing = false;
  let _messages = {};

  const $targetLang = document.getElementById('targetLanguage');
  const $settingsBtn = document.getElementById('openSettings');
  const $configBanner = document.getElementById('configBanner');
  const $goToSettingsBtn = document.getElementById('goToSettingsBtn');
  const $videoList = document.getElementById('videoList');
  const $template = document.getElementById('videoItemTemplate');

  function sendRuntimeMessage(message) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(message, function (response) {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || {});
      });
    });
  }

  async function loadState() {
    const result = await chrome.storage.sync.get(Object.keys(DEFAULTS));
    state = { ...DEFAULTS, ...result };
    $targetLang.value = state.targetLanguage;
  }

  async function saveState(partial) {
    state = { ...state, ...partial };
    await chrome.storage.sync.set(partial);
  }

  function getActionForStatus(status) {
    if (status === STATUS.PREPARING || status === STATUS.TRANSLATING) {
      return { label: t('popup.actionCancel'), intent: 'cancel', className: 'danger' };
    }
    if (status === STATUS.FAILED) {
      return { label: t('popup.actionRetry'), intent: 'start', className: '' };
    }
    if (status === STATUS.COMPLETED) {
      return { label: t('popup.actionOpen'), intent: 'open', className: 'primary' };
    }
    return { label: t('popup.actionTranslate'), intent: 'start', className: 'primary' };
  }

  function getStatusLabel(item) {
    if (item.status === STATUS.TRANSLATING) return t('popup.statusTranslating');
    if (item.status === STATUS.PREPARING) return t('popup.statusPreparing');
    if (item.status === STATUS.FAILED) return t('popup.statusFailed');
    if (item.status === STATUS.COMPLETED) return t('popup.statusCompleted');
    if (item.status === STATUS.CANCELED) return t('popup.statusCanceled');
    if (item.status === STATUS.AVAILABLE) return t('popup.statusAvailable');
    return '';
  }

  function setProgress($ring, percent, isIndeterminate) {
    $ring.classList.toggle('indeterminate', !!isIndeterminate);
    if (!isIndeterminate) {
      const circumference = 125.6;
      const value = Math.max(0, Math.min(100, Number(percent || 0)));
      $ring.style.strokeDashoffset = String(circumference - (circumference * value / 100));
    }
  }

  function renderEmpty() {
    $videoList.innerHTML = '<div class="empty-state">' + t('popup.emptyState', '打开有字幕的 YouTube 视频后可在这里翻译') + '</div>';
  }

  function renderLoading() {
    $videoList.innerHTML =
      '<div class="video-list-loading">' +
        '<div class="loading-bar">' +
          '<span class="loading-dot"></span>' +
          '<span class="loading-dot"></span>' +
          '<span class="loading-dot"></span>' +
          '<span class="loading-dot"></span>' +
          '<span class="loading-dot"></span>' +
        '</div>' +
        '<div class="loading-prompt">' + t('popup.loadingPrompt', '正在扫描视频\u00B7\u00B7\u00B7') + '</div>' +
      '</div>';
  }

  function renderItems(items, hasMoreCompleted) {
    // 清除所有非 item 占位节点（加载动画、空状态等）
    for (let i = $videoList.children.length - 1; i >= 0; i--) {
      const child = $videoList.children[i];
      if (!child.dataset || !child.dataset.videoId) {
        child.remove();
      }
    }

    if (!items.length) {
      renderEmpty();
      return;
    }

    // 移除已不在列表中的 item
    const keepVideoIds = new Set(items.map(i => i.videoId));
    for (let i = $videoList.children.length - 1; i >= 0; i--) {
      const child = $videoList.children[i];
      if (child.dataset && child.dataset.videoId && !keepVideoIds.has(child.dataset.videoId)) {
        child.remove();
      }
    }

    // 按顺序原地更新或创建 item（不销毁已有 DOM，避免 hover/focus 闪烁）
    items.forEach(function (item) {
      const existing = $videoList.querySelector('[data-video-id="' + item.videoId + '"]');
      const isNew = !existing;
      const $item = existing || ($template.content.cloneNode(true)).querySelector('.video-item');
      const $thumb = $item.querySelector('.video-thumb');
      const $ring = $item.querySelector('.progress-ring-value');
      const $title = $item.querySelector('.video-title');
      const $status = $item.querySelector('.video-status');
      const $button = $item.querySelector('.video-action');
      const action = getActionForStatus(item.status);

      $item.dataset.videoId = item.videoId;
      $item.dataset.tabId = item.tabId || '';
      $thumb.src = item.thumbnailUrl || '';
      $thumb.hidden = !item.thumbnailUrl;
      $title.textContent = item.title || item.videoId || 'YouTube ' + t('popup.statusAvailable', '视频');
      $status.textContent = getStatusLabel(item);
      $status.classList.toggle('is-error', item.status === STATUS.FAILED);

      // 只有在按钮不在 pending 过渡态时才更新按钮文案/意图
      if ($button.dataset.intent !== 'pending') {
        $button.textContent = action.label;
        $button.dataset.intent = action.intent;
        $button.disabled = !!action.disabled;
        $button.className = 'video-action';
        if (action.className) $button.classList.add(action.className);
      }
      $button.dataset.videoId = item.videoId;
      $button.dataset.tabId = item.tabId || '';

      const isIndeterminate = item.status === STATUS.TRANSLATING || item.status === STATUS.PREPARING;
      setProgress($ring, item.progress || 0, isIndeterminate);

      if (isNew) {
        $videoList.appendChild($item);
      } else if (existing && existing !== $videoList.children[items.indexOf(item)]) {
        // 保持 DOM 顺序与数组一致
        $videoList.insertBefore($item, $videoList.children[items.indexOf(item)]);
      }
    });

    // 显示更多按钮（仅在未展开全部且有更多已完成视频时显示）
    var $moreBtn = $videoList.querySelector('.show-more-btn');
    if (hasMoreCompleted && !showAllCompleted) {
      if (!$moreBtn) {
        $moreBtn = document.createElement('button');
        $moreBtn.className = 'show-more-btn';
        $moreBtn.type = 'button';
        $moreBtn.addEventListener('click', function () {
          showAllCompleted = true;
          refreshVideos();
        });
        $videoList.appendChild($moreBtn);
      }
      $moreBtn.textContent = t('popup.showMore', '显示全部已完成') + ' \u2192';
      $moreBtn.hidden = false;
    } else if ($moreBtn) {
      $moreBtn.hidden = true;
    }
  }

  async function refreshVideos() {
    if (isRefreshing) return;
    isRefreshing = true;
    if ($videoList.children.length === 0) {
      renderLoading();
    }
    var response = await sendRuntimeMessage({
      type: 'GET_VIDEO_TASKS',
      targetLanguage: state.targetLanguage,
      showAllCompleted: showAllCompleted,
    });
    isRefreshing = false;

    // content script 可能尚未就绪，快速重试一次
    if (response.error || !response.items || response.items.length === 0) {
      await new Promise(function (r) { return setTimeout(r, 600); });
      response = await sendRuntimeMessage({
        type: 'GET_VIDEO_TASKS',
        targetLanguage: state.targetLanguage,
        showAllCompleted: showAllCompleted,
      });
    }

    if (response.error) {
      renderEmpty();
      return;
    }
    renderItems(response.items || [], response.hasMoreCompleted);
  }

  async function handleClick(event) {
    const button = event.target.closest('.video-action');
    if (button) {
      await handleAction(button);
      return;
    }

    const item = event.target.closest('.video-item');
    if (item?.dataset.videoId) {
      await sendRuntimeMessage({ type: 'OPEN_VIDEO_TASK', videoId: item.dataset.videoId });
      window.close();
    }
  }

  async function handleAction(button) {
    if (button.disabled) return;
    const videoId = button.dataset.videoId;
    const tabId = Number(button.dataset.tabId || 0);
    const intent = button.dataset.intent;
    if (!videoId || intent === 'none') return;

    // 即时视觉反馈：按钮立即变为过渡态
    button.disabled = true;
    if (intent === 'open') {
      await sendRuntimeMessage({ type: 'OPEN_VIDEO_TASK', videoId });
      window.close();
      return;
    }
    if (intent === 'start') {
      button.textContent = '\u00B7\u00B7\u00B7';
      button.dataset.intent = 'pending';
      button.className = 'video-action pending';
    }
    if (intent === 'cancel') {
      button.textContent = t('popup.actionCancel', '取消') + '\u4E2D';
      button.dataset.intent = 'pending';
      button.className = 'video-action pending danger';
    }

    // 操作期间暂停自动轮询，防止中间态被覆盖
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }

    try {
      if (intent === 'cancel') {
        await sendRuntimeMessage({ type: 'CANCEL_VIDEO_TASK', videoId });
      } else {
        await sendRuntimeMessage({
          type: 'START_VIDEO_TASK',
          videoId,
          tabId,
          targetLanguage: state.targetLanguage,
        });
      }
    } finally {
      button.dataset.intent = ''; // 清除 pending 标记
      await refreshVideos();
      // 恢复自动轮询
      if (!refreshTimer) {
        refreshTimer = setInterval(refreshVideos, 1500);
      }
    }
  }

  /* ── Update config banner based on model state ── */
  function updateConfigBanner() {
    const modelKey = state.defaultModel || 'agnes-ai';
    const model = state.models?.[modelKey];
    if ($configBanner) {
      // 默认模型存在且有 API Key 时隐藏横幅
      $configBanner.hidden = !!(model && model.apiKey);
    }
  }

  async function init() {
    await loadState();
    const lang = detectUILang();
    _messages = await loadMessages(lang);
    applyI18n(_messages);

    updateConfigBanner();

    // 监听存储变化，实时更新配置提示
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (changes.models) {
        state.models = { ...DEFAULTS.models, ...(changes.models.newValue || {}) };
      }
      if (changes.defaultModel) {
        state.defaultModel = changes.defaultModel.newValue;
      }
      if (changes.models || changes.defaultModel) {
        updateConfigBanner();
      }
    });

    // 事件处理器在异步操作前注册，确保立即可用
    $settingsBtn.addEventListener('click', function () {
      chrome.runtime.openOptionsPage();
    });
    if ($goToSettingsBtn) {
      $goToSettingsBtn.addEventListener('click', function () {
        chrome.runtime.openOptionsPage();
        window.close();
      });
    }
    $targetLang.addEventListener('change', async function () {
      await saveState({ targetLanguage: $targetLang.value });
      await refreshVideos();
    });
    $videoList.addEventListener('click', handleClick);
    refreshTimer = setInterval(refreshVideos, 1500);
    window.addEventListener('unload', function () {
      if (refreshTimer) clearInterval(refreshTimer);
    });

    // 首次加载视频列表（不阻塞事件处理器）
    refreshVideos().catch(function (err) {
      console.warn('[Popup] init refresh failed:', err);
    });
  }

  init();
})();
