(function () {
  'use strict';

  function init() {
    window.addEventListener('online', checkForVideo);
    // 监听 YouTube SPA 导航事件（用于从首页/搜索页点击视频后的检测）
    document.addEventListener('yt-navigate-finish', checkForVideo);
    // 导航开始时立即清除旧字幕，防止残留 1 秒
    document.addEventListener('yt-navigate-start', function () {
      renderer.clear();
    });

    if (!navigator.onLine) {
      console.log('Offline: subtitle translation unavailable');
      return;
    }

    const renderer = new SubtitleRenderer();
    renderer.mount();

    let currentVideoId = null;
    let currentInterceptListener = null;
    let translationRunId = 0;
    let activeVideoEl = null;
    let hasActiveTranslation = false;

    // 立即检测当前页是否有视频（覆盖直接导航到视频页的场景）
    checkForVideo();

    chrome.runtime.onMessage.addListener(function (request, _sender, sendResponse) {
      if (request.type === 'DETECT_VIDEO_TRANSLATABLE') {
        detectVideo(request.targetLanguage).then(sendResponse).catch(function (err) {
          sendResponse({ error: err.message });
        });
        return true;
      }

      if (request.type === 'PREPARE_VIDEO_TRANSLATION') {
        prepareVideo(request.targetLanguage).then(sendResponse).catch(function (err) {
          sendResponse({ error: err.message });
        });
        return true;
      }

      if (request.type === 'APPLY_VIDEO_TRANSLATIONS') {
        applyVideoTranslations(request.payload).then(sendResponse).catch(function (err) {
          sendResponse({ error: err.message });
        });
        return true;
      }

      if (request.type === 'START_SUBTITLE_TRANSLATION') {
        startTranslation(request.targetLanguage).then(sendResponse).catch(function (err) {
          sendResponse({ error: err.message });
        });
        return true;
      }

    });

    // 实时监听设置变更并同步到字幕渲染器
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'sync') return;
      var renderConfig = {};
      if (changes.subtitleMode) renderConfig.mode = changes.subtitleMode.newValue;
      if (changes.fontSize) renderConfig.fontSize = changes.fontSize.newValue;
      if (changes.subPosition) renderConfig.position = changes.subPosition.newValue;
      if (changes.bgOpacity) renderConfig.bgOpacity = changes.bgOpacity.newValue;
      if (changes.originalTextColor) renderConfig.originalTextColor = changes.originalTextColor.newValue;
      if (changes.translatedTextColor) renderConfig.translatedTextColor = changes.translatedTextColor.newValue;
      if (changes.subBgColor) renderConfig.subBgColor = changes.subBgColor.newValue;
      if (Object.keys(renderConfig).length > 0) {
        renderer.updateConfig(renderConfig);
      }
    });

    function isShortsPage() {
      return window.location.pathname.startsWith('/shorts/');
    }

    function getCurrentVideoId() {
      const searchParams = new URLSearchParams(window.location.search);
      return isShortsPage()
        ? window.location.pathname.split('/').filter(Boolean)[1]
        : searchParams.get('v');
    }

    function getCurrentTitle() {
      const heading = document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
        document.querySelector('h1.title yt-formatted-string') ||
        document.querySelector('h1');
      return (heading && heading.textContent ? heading.textContent : document.title)
        .replace(/\s*-\s*YouTube\s*$/i, '')
        .trim();
    }

    function checkForVideo() {
      const videoEl = document.querySelector('video');
      const newId = getCurrentVideoId();
      activeVideoEl = videoEl || activeVideoEl;

      if (newId && newId !== currentVideoId) {
        debugLog('YT-Translator', 'detected video: ' + newId);
        currentVideoId = newId;
        if (hasActiveTranslation) {
          cancelTranslation();
        } else {
          translationRunId += 1;
          cleanupInterceptListener();
        }
        resetInterceptorState();
        // 清除旧视频的字幕，防止残留
        renderer.clear();
      }
    }

    async function detectVideo(targetLanguage) {
      checkForVideo();
      const videoId = currentVideoId || getCurrentVideoId();
      if (!videoId) return { needsTranslation: false, error: 'Not a YouTube video page' };

      // 快速检测：仅检查字幕元数据，不下载完整字幕文件（约快 10-30 倍）
      const quickInfo = await quickDetectSubtitles(videoId);
      if (!quickInfo.available) {
        return { needsTranslation: false, error: 'No subtitles available' };
      }

      const sourceLanguage = quickInfo.language;
      if (isSameLanguage(sourceLanguage, targetLanguage)) {
        return { needsTranslation: false, sourceLanguage };
      }

      const settings = await loadSettings(targetLanguage);
      settings.videoId = videoId;
      settings.sourceLanguage = sourceLanguage || 'unknown';

      // 检查是否有缓存的已完成翻译
      const currentTask = await chrome.storage.local.get('ytVideoTasks');
      const allTasks = currentTask?.ytVideoTasks || {};
      const existingTask = allTasks[videoId];
      if (existingTask && existingTask.status === STATUS.COMPLETED && existingTask.targetLanguage === targetLanguage) {
        // 有已完成翻译缓存 → 加载完整数据并尝试恢复
        try {
          const subtitleData = await fetchSubtitles(videoId);
          if (subtitleData && subtitleData.sentences) {
            return {
              needsTranslation: true,
              videoId,
              title: getCurrentTitle(),
              sourceLanguage,
              thumbnailUrl: 'https://i.ytimg.com/vi/' + videoId + '/default.jpg',
              status: STATUS.COMPLETED,
              progress: 100,
              cues: subtitleData.sentences.map(function (s) { return { start: s.start, end: s.end, text: s.text }; }),
            };
          }
        } catch (_e) { /* 降级 */ }
      }

      // 无需完整字幕数据，直接返回可用状态
      return {
        needsTranslation: true,
        videoId,
        title: getCurrentTitle(),
        sourceLanguage,
        thumbnailUrl: 'https://i.ytimg.com/vi/' + videoId + '/default.jpg',
        status: STATUS.AVAILABLE,
        progress: 0,
        completedGroups: 0,
        totalGroups: 0,
        cues: [],
      };
    }

    async function startTranslation(targetLanguage) {
      checkForVideo();
      const videoId = currentVideoId || getCurrentVideoId();
      const videoEl = document.querySelector('video');
      if (!videoId || !videoEl) throw new Error('No active YouTube video');

      activeVideoEl = videoEl;
      translationRunId += 1;
      hasActiveTranslation = true;
      const runId = translationRunId;
      cleanupInterceptListener();
      resetInterceptorState();

      const settings = await loadSettings(targetLanguage);
      reportTask({ status: STATUS.PREPARING, videoId, title: getCurrentTitle(), targetLanguage: settings.targetLanguage, progress: 0 });

      // 获取字幕 + 本地断句
      const subtitleData = await fetchSubtitles(videoId);
      if (!subtitleData.sentences || subtitleData.sentences.length === 0) {
        hasActiveTranslation = false;
        reportTask({ status: STATUS.FAILED, error: 'No subtitles available' });
        return { ok: false, error: 'No subtitles available' };
      }
      if (isSameLanguage(subtitleData.language, settings.targetLanguage)) {
        hasActiveTranslation = false;
        reportTask({ status: STATUS.CANCELED });
        return { ok: true, skipped: true };
      }

      settings.videoId = videoId;
      settings.sourceLanguage = subtitleData.language || 'unknown';
      settings.videoTitle = getCurrentTitle();

      // 初始化渲染器（先显示原文）
      var cues = subtitleData.sentences.map(function (s) {
        return { start: s.start, end: s.end, text: s.text, translated: null };
      });
      renderer.start(videoEl, {
        cues: cues,
        mode: settings.subtitleMode || 'bilingual',
        fontSize: settings.fontSize || 'medium',
        position: settings.subPosition || 'above',
        bgOpacity: settings.bgOpacity || 0.6,
        originalTextColor: settings.originalTextColor || 50,
        translatedTextColor: settings.translatedTextColor || 50,
        subBgColor: settings.subBgColor || 0,
        isShorts: isShortsPage(),
      });

      // 批量翻译
      reportTask({ status: STATUS.TRANSLATING, sourceLanguage: subtitleData.language });

      try {
        var translations = await batchTranslateSentences(subtitleData.sentences, settings);

        // 将译文写回 cues
        for (var i = 0; i < subtitleData.sentences.length; i++) {
          cues[i].translated = translations[i] || '';
        }
        renderer.updateCues(cues);
        hasActiveTranslation = false;

        reportTask({
          status: STATUS.COMPLETED,
          cues: cues,
        });
      } catch (err) {
        hasActiveTranslation = false;
        if (runId !== translationRunId) return { ok: false, error: 'Translation cancelled' };
        reportTask({ status: STATUS.FAILED, error: err.message });
        debugLog('YT-Translator', 'batch translation failed: ' + err.message);
      }

      return { ok: true };
    }

    async function prepareVideo(targetLanguage) {
      checkForVideo();
      const videoId = currentVideoId || getCurrentVideoId();
      const videoEl = document.querySelector('video');
      if (!videoId || !videoEl) throw new Error('No active YouTube video');
      const settings = await loadSettings(targetLanguage);
      const subtitleData = await fetchSubtitles(videoId);
      if (!subtitleData.sentences || subtitleData.sentences.length === 0) {
        throw new Error('No subtitles available');
      }
      if (isSameLanguage(subtitleData.language, settings.targetLanguage)) {
        throw new Error('Subtitle language already matches target language');
      }
      return {
        videoId,
        title: getCurrentTitle(),
        url: window.location.href,
        thumbnailUrl: 'https://i.ytimg.com/vi/' + videoId + '/default.jpg',
        sourceLanguage: subtitleData.language || 'unknown',
        cues: subtitleData.sentences.map(function (s) { return { start: s.start, end: s.end, text: s.text }; }),
      };
    }

    async function applyVideoTranslations(payload) {
      checkForVideo();
      const videoId = currentVideoId || getCurrentVideoId();
      const videoEl = document.querySelector('video');
      if (!videoEl) throw new Error('No active YouTube video');
      if (payload.videoId && videoId && payload.videoId !== videoId) {
        return { ok: false, skipped: true };
      }
      // 仅更新字幕数据，不重置渲染器（start() 会重置当前 cue 索引和 raf 循环）
      // 首次调用时如果 host 尚未挂载或未有 video，才需要走 start
      if (renderer.host && renderer.video) {
        renderer.updateCues(payload.cues || []);
      } else {
        const settings = await loadSettings(payload.targetLanguage);
        renderer.start(videoEl, {
          cues: payload.cues || [],
          mode: settings.subtitleMode || 'bilingual',
          fontSize: settings.fontSize || 'medium',
          position: settings.subPosition || 'above',
          bgOpacity: settings.bgOpacity || 0.6,
          originalTextColor: settings.originalTextColor || 50,
          translatedTextColor: settings.translatedTextColor || 50,
          subBgColor: settings.subBgColor || 0,
          isShorts: isShortsPage(),
        });
      }
      return { ok: true };
    }

    function cancelTranslation() {
      translationRunId += 1;
      cleanupInterceptListener();
      if (hasActiveTranslation) {
        hasActiveTranslation = false;
        reportTask({ status: STATUS.CANCELED });
      }
    }

    function cleanupInterceptListener() {
      if (currentInterceptListener) {
        offInterceptedTimedtext(currentInterceptListener);
        currentInterceptListener = null;
      }
    }

    async function loadSettings(targetLanguage) {
      const rawSettings = await new Promise(function (resolve) {
        chrome.storage.sync.get(null, resolve);
      });
      // 解密 models 中的 apiKey 字段
      if (rawSettings.models) {
        rawSettings.models = await ApiKeyCrypto.decryptModels(rawSettings.models);
      }
      const defaults = {
        translationEnabled: true,
        subtitleMode: 'bilingual',
        targetLanguage: targetLanguage || 'zh-CN',
        fontSize: 'medium',
        subPosition: 'above',
        bgOpacity: 0.6,
        originalTextColor: 50,
        translatedTextColor: 50,
        subBgColor: 0,
        defaultModel: 'agnes-ai',
        models: {
          'agnes-ai': {
            name: 'Agnes AI',
            apiUrl: 'https://apihub.agnes-ai.com/v1',
            apiKey: '',
            modelId: 'agnes-2.0-flash',
            enabled: true,
          },
        },
      };
      const settings = Object.assign({}, defaults, rawSettings, {
        translationEnabled: true,
        targetLanguage: targetLanguage || rawSettings.targetLanguage || defaults.targetLanguage,
      });
      settings.models = Object.assign({}, defaults.models, rawSettings.models || {});
      return settings;
    }

    function reportTask(payload) {
      chrome.runtime.sendMessage({
        type: 'VIDEO_TASK_PROGRESS',
        payload: Object.assign({
          videoId: currentVideoId || getCurrentVideoId(),
          title: getCurrentTitle(),
          thumbnailUrl: currentVideoId ? 'https://i.ytimg.com/vi/' + currentVideoId + '/default.jpg' : '',
        }, payload),
      }, function () {
        void chrome.runtime.lastError;
      });
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = String(text || '');
      return div.innerHTML;
    }

    const observer = new MutationObserver(function () {
      clearTimeout(observer._timer);
      observer._timer = setTimeout(checkForVideo, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(checkForVideo, 1500);
  }

  function isSameLanguage(sourceLanguage, targetLanguage) {
    return normalizeLanguage(sourceLanguage) === normalizeLanguage(targetLanguage);
  }

  function normalizeLanguage(language) {
    const value = String(language || '').toLowerCase();
    if (value === 'zh' || value.startsWith('zh-') || value.includes('chinese') || value.includes('中文')) {
      return 'zh';
    }
    if (value === 'en' || value.startsWith('en-') || value.includes('english')) {
      return 'en';
    }
    return value.split('-')[0] || 'unknown';
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
