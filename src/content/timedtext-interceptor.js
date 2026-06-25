/* timedtext-interceptor.js - bridge page-world timedtext events to content scripts */

let __interceptorInjected = false;
let __interceptedData = null;
let __pendingResolvers = [];
let __persistentListeners = [];

function resetInterceptorState() {
  __interceptedData = null;
  const resolvers = __pendingResolvers;
  __pendingResolvers = [];
  resolvers.forEach(function (item) {
    clearTimeout(item.timer);
    item.reject(new Error('Interceptor state reset (video changed)'));
  });
}

function onInterceptedTimedtext(callback) {
  if (__interceptedData) {
    callback(__interceptedData);
  }
  __persistentListeners.push(callback);
}

function offInterceptedTimedtext(callback) {
  const idx = __persistentListeners.indexOf(callback);
  if (idx !== -1) __persistentListeners.splice(idx, 1);
}

function ensureInterceptorInjected() {
  if (__interceptorInjected) return;
  __interceptorInjected = true;

  document.addEventListener('yt-translate-timedtext', function (e) {
    const data = e.detail;
    __interceptedData = data;

    const resolvers = __pendingResolvers;
    __pendingResolvers = [];
    resolvers.forEach(function (item) {
      clearTimeout(item.timer);
      item.resolve(data);
    });

    __persistentListeners.forEach(function (fn) {
      try {
        fn(data);
      } catch (err) {
        console.warn('[TimedtextInterceptor] listener error:', err);
      }
    });
  });

  document.addEventListener('yt-translate-debug', function (e) {
    try {
      debugLog('YT-Intercept', 'InnerTube debug: ' + JSON.stringify(e.detail));
    } catch (_err) {}
  });

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('src/content/timedtext-page-hook.js');
  script.async = false;
  script.onload = function () {
    script.remove();
  };
  script.onerror = function () {
    console.warn('[TimedtextInterceptor] failed to load page hook');
    script.remove();
  };
  (document.head || document.documentElement).appendChild(script);
}

function waitForInterceptedTimedtext(timeout, videoId) {
  timeout = timeout || 20000;
  ensureInterceptorInjected();

  if (__interceptedData) {
    if (!videoId || __interceptedData.url.indexOf('v=' + videoId) !== -1) {
      return Promise.resolve(__interceptedData);
    }
    __interceptedData = null;
  }

  return new Promise(function (resolve, reject) {
    const timer = setTimeout(function () {
      for (let i = 0; i < __pendingResolvers.length; i++) {
        if (__pendingResolvers[i].timer === timer) {
          __pendingResolvers.splice(i, 1);
          break;
        }
      }
      reject(new Error('Timedtext interception timed out after ' + timeout + 'ms'));
    }, timeout);

    __pendingResolvers.push({ resolve, reject, timer });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureInterceptorInjected);
} else {
  ensureInterceptorInjected();
}
