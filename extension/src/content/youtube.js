(function () {
  'use strict';

  const TRANSLATION_WORKER_COUNT = 4; // 初始 worker 数，实际并发由 RateLimiter 动态控制
  const WARMUP_TRANSLATION_SECONDS = 60;
  const WARMUP_MIN_GROUPS = 2;

  function init() {
    window.addEventListener('online', checkForVideo);
    // 监听 YouTube SPA 导航事件（用于从首页/搜索页点击视频后的检测）
    document.addEventListener('yt-navigate-finish', checkForVideo);

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

      // 检查是否有缓存
      const currentTask = await chrome.storage.local.get('ytVideoTasks');
      const allTasks = currentTask?.ytVideoTasks || {};
      const existingTask = allTasks[videoId];
      if (existingTask && existingTask.status === 'completed' && existingTask.targetLanguage === targetLanguage) {
        // 有已完成的翻译缓存 → 加载完整字幕数据
        try {
          const subtitleData = await fetchSubtitles(videoId);
          if (subtitleData && subtitleData.cues) {
            const groups = buildTranslationGroups(subtitleData.cues);
            const coverage = await getSubtitleCacheCoverage(groups, settings);
            const cues = coverage.complete
              ? await hydrateCachedTranslations(subtitleData.cues, groups, settings)
              : subtitleData.cues;
            return {
              needsTranslation: true,
              videoId,
              title: getCurrentTitle(),
              sourceLanguage,
              thumbnailUrl: 'https://i.ytimg.com/vi/' + videoId + '/default.jpg',
              status: coverage.complete ? 'completed' : 'available',
              progress: coverage.progress,
              completedGroups: coverage.cachedGroups,
              totalGroups: coverage.totalGroups,
              cues,
            };
          }
        } catch (_e) {
          // 降级：返回基础信息
        }
      }

      // 无需完整字幕数据，直接返回可用状态
      return {
        needsTranslation: true,
        videoId,
        title: getCurrentTitle(),
        sourceLanguage,
        thumbnailUrl: 'https://i.ytimg.com/vi/' + videoId + '/default.jpg',
        status: 'available',
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
      reportTask({
        status: 'preparing',
        videoId,
        title: getCurrentTitle(),
        targetLanguage: settings.targetLanguage,
        progress: 0,
      });
      const subtitleData = await fetchSubtitles(videoId);
      if (isSameLanguage(subtitleData.language, settings.targetLanguage)) {
        hasActiveTranslation = false;
        reportTask({ status: 'canceled' });
        return { ok: true, skipped: true };
      }

      settings.videoId = videoId;
      settings.sourceLanguage = subtitleData.language || 'unknown';
      settings.videoTitle = getCurrentTitle();
      const isShorts = isShortsPage();

      renderer.start(videoEl, {
        cues: subtitleData.cues,
        mode: settings.subtitleMode || 'bilingual',
        fontSize: settings.fontSize || 'medium',
        position: settings.subPosition || 'above',
        bgOpacity: settings.bgOpacity || 0.6,
        originalTextColor: settings.originalTextColor || 50,
        translatedTextColor: settings.translatedTextColor || 50,
        subBgColor: settings.subBgColor || 0,
        isShorts,
      });

      // ===== Phase 1: 尝试全文本 AI 重写（清洗+断句+翻译，一次性完成） =====
      reportTask({
        status: 'rewriting',
        sourceLanguage: subtitleData.language || 'unknown',
        progress: 0,
      });

      debugLog('YT-Translator', 'rewritePhase: trying full transcript rewrite');
      const rewrittenCues = await rewriteSubtitleTranscript(subtitleData.cues, settings);

      if (rewrittenCues && rewrittenCues.length > 0) {
        // 成功！重写后的字幕 = 清洗后文本 + 准确时间轴 + 翻译
        debugLog('YT-Translator', 'rewritePhase: success, got ' + rewrittenCues.length + ' cues');
        subtitleData.cues = rewrittenCues.map(function (item) {
          return {
            start: item.start,
            end: item.end,
            text: item.original,
            translated: item.translated,
          };
        });
        renderer.updateCues(subtitleData.cues);
        hasActiveTranslation = false;
        reportTask({
          status: 'completed',
          completedGroups: rewrittenCues.length,
          totalGroups: rewrittenCues.length,
          progress: 100,
        });
        return { ok: true };
      }

      // ===== Phase 2: 全文本重写失败，降级为逐组增量翻译 =====
      debugLog('YT-Translator', 'rewritePhase: failed, falling back to incremental translation');
      const groups = buildTranslationGroups(subtitleData.cues);
      const warmupGroups = selectWarmupGroups(groups, videoEl.currentTime);
      const warmupSet = new Set(warmupGroups);
      const remainingGroups = groups.filter(function (group) { return !warmupSet.has(group); });
      let completedGroups = 0;

      reportTask({
        status: 'translating',
        sourceLanguage: subtitleData.language || 'unknown',
        totalGroups: groups.length,
        completedGroups,
        progress: 0,
      });
      const applyTranslation = function (cueIndex, translated) {
        if (runId !== translationRunId) return false;
        subtitleData.cues[cueIndex] = { ...subtitleData.cues[cueIndex], translated };
        renderer.updateCues(subtitleData.cues);
        return true;
      };
      const isCurrentRun = function () {
        return runId === translationRunId;
      };
      const onGroupDone = function () {
        completedGroups += 1;
        const progress = groups.length ? Math.round((completedGroups / groups.length) * 100) : 0;
        reportTask({
          status: 'translating',
          completedGroups,
          totalGroups: groups.length,
          progress,
        });
      };

      const warmupPromise = translateGroupsRealtime(warmupGroups, settings, videoEl, applyTranslation, isCurrentRun, onGroupDone);
      warmupPromise.then(function () {
        if (!isCurrentRun()) return [];
        return translateGroupsRealtime(remainingGroups, settings, videoEl, applyTranslation, isCurrentRun, onGroupDone);
      }).then(function () {
        if (!isCurrentRun()) return;
        hasActiveTranslation = false;
        reportTask({
          status: 'completed',
          completedGroups: groups.length,
          totalGroups: groups.length,
          progress: 100,
        });
      }).catch(function (err) {
        hasActiveTranslation = false;
        reportTask({ status: 'failed', error: err.message });
      });

      if (!subtitleData.cues || subtitleData.cues.length === 0) {
        currentInterceptListener = async function onLateTimedtext(data) {
          const langMatch = data.url.match(/[?&]lang=([^&]+)/);
          const lang = langMatch ? decodeURIComponent(langMatch[1]) : 'unknown';
          const lateCues = cleanCues(parseSubtitleData(data.text));
          if (!lateCues.length || !isCurrentRun()) return;
          settings.sourceLanguage = lang;
          renderer.start(videoEl, {
            cues: lateCues,
            mode: settings.subtitleMode || 'bilingual',
            fontSize: settings.fontSize || 'medium',
            position: settings.subPosition || 'above',
            bgOpacity: settings.bgOpacity || 0.6,
            originalTextColor: settings.originalTextColor || 50,
            translatedTextColor: settings.translatedTextColor || 50,
            subBgColor: settings.subBgColor || 0,
            isShorts,
          });
          const lateGroups = buildTranslationGroups(lateCues);
          await translateGroupsRealtime(lateGroups, settings, videoEl, function (cueIndex, translated) {
            lateCues[cueIndex] = { ...lateCues[cueIndex], translated };
            renderer.updateCues(lateCues);
            return true;
          }, isCurrentRun, onGroupDone);
        };
        onInterceptedTimedtext(currentInterceptListener);
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
      if (!subtitleData.cues || subtitleData.cues.length === 0) {
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
        cues: subtitleData.cues,
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
        reportTask({ status: 'canceled' });
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

  async function translateGroupsRealtime(groups, settings, videoEl, onProgress, shouldContinue, onGroupDone) {
    const pending = groups.slice();
    const translated = [];
    const workers = [];
    var completedContexts = new Map();

    for (let i = 0; i < TRANSLATION_WORKER_COUNT; i++) {
      workers.push(runTranslationWorker());
    }

    await Promise.all(workers);
    return translated;

    async function runTranslationWorker() {
      while (pending.length > 0 && shouldContinue()) {
        const nextIndex = findNextTranslationGroupIndex(pending, videoEl.currentTime);
        const group = pending.splice(nextIndex, 1)[0];

        // 查找已完成翻译的、时间上最接近的前一组作为上下文
        var prevContext = null;
        var bestPrev = null;
        completedContexts.forEach(function (ctx, start) {
          if (start < group.start && (bestPrev === null || start > bestPrev)) {
            bestPrev = start;
            prevContext = ctx;
          }
        });

        const groupResult = await translateCueGroups([group], settings, prevContext, function (cueIndex, text, translatedGroup) {
          if (!shouldContinue()) return;
          if (onProgress) onProgress(cueIndex, text, translatedGroup);
        });

        // 将完成的翻译存入上下文池，供后续组使用
        if (groupResult[0] && groupResult[0].translations) {
          completedContexts.set(group.start, {
            texts: group.texts.slice(),
            translations: groupResult[0].translations.slice(),
          });
        }

        translated.push(groupResult[0] || group);
        if (shouldContinue() && onGroupDone) onGroupDone(group);
      }
    }
  }

  function selectWarmupGroups(groups, currentTime) {
    const ordered = groups.slice().sort(function (a, b) {
      return getGroupDistanceScore(a, currentTime) - getGroupDistanceScore(b, currentTime);
    });
    const windowEnd = currentTime + WARMUP_TRANSLATION_SECONDS;
    const selected = ordered.filter(function (group) {
      return group.end >= currentTime && group.start <= windowEnd;
    });
    return selected.length > 0 ? selected : ordered.slice(0, WARMUP_MIN_GROUPS);
  }

  function findNextTranslationGroupIndex(groups, currentTime) {
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    groups.forEach(function (group, index) {
      const score = getGroupDistanceScore(group, currentTime);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    return bestIndex;
  }

  function getGroupDistanceScore(group, currentTime) {
    if (currentTime >= group.start && currentTime < group.end) return -1;
    if (group.start >= currentTime) return group.start - currentTime;
    return 100000 + (currentTime - group.end);
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
