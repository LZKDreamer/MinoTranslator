/* ═══════════════════════════════════════════════
   youtube.js — YouTube 页面注入主入口
   初始化字幕获取和渲染模块
   ═══════════════════════════════════════════════ */

(function () {
  'use strict';

  // 等待页面加载完成后初始化
  function init() {
    // 注册在线恢复监听（必须在 return 之前，确保离线加载时也能注册）
    window.addEventListener('online', () => {
      checkForVideo();
    });

    // 检查网络状态
    if (!navigator.onLine) {
      showSubtitlesOfflineNotice();
      return;
    }

    function showSubtitlesOfflineNotice() {
      // 显示离线提示（使用渲染层短消息）
      console.log('Offline: subtitle translation unavailable');
    }

    // 注入字幕渲染层
    const renderer = new SubtitleRenderer();
    renderer.mount();

    // 监听 YouTube 页面导航（SPA 模式）
    let currentVideoId = null;

    function isShortsPage() {
      return window.location.pathname.startsWith('/shorts/');
    }

    function checkForVideo() {
      const videoEl = document.querySelector('video');
      const searchParams = new URLSearchParams(window.location.search);
      const newId = isShortsPage()
        ? window.location.pathname.split('/').pop()
        : searchParams.get('v');

      if (newId && newId !== currentVideoId) {
        currentVideoId = newId;
        onVideoChange(newId, videoEl);
      }
    }

    async function onVideoChange(videoId, videoEl) {
      if (!videoEl) return;

      // 获取设置
      const settings = await sendMessage({ type: 'GET_SETTINGS' });
      const isShorts = isShortsPage();

      // 获取字幕（Shorts 复用 extractFromPlayerResponse，无需额外改动）
      const subtitleData = await fetchSubtitles(videoId);

      // 翻译字幕
      const translatedCues = await translateCues(subtitleData.cues, settings);

      // 启动渲染（传递 isShorts 标记供渲染器适配竖屏布局）
      renderer.start(videoEl, {
        cues: translatedCues,
        mode: settings.subtitleMode || 'bilingual',
        fontSize: settings.fontSize || 'medium',
        position: settings.subPosition || 'below',
        bgOpacity: settings.bgOpacity || 0.6,
        isShorts,
      });
    }

    // 监听页面变化（SPA 页面切换）
    const observer = new MutationObserver(() => {
      checkForVideo();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 初次检查
    setTimeout(checkForVideo, 2000);
  }

  // 页面就绪后启动
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
