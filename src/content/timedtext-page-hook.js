(function () {
  'use strict';

  if (window.__ytTranslateTimedtextHookInstalled) return;
  window.__ytTranslateTimedtextHookInstalled = true;

  function dispatchTimedtext(text, url) {
    document.dispatchEvent(new CustomEvent('yt-translate-timedtext', {
      detail: { text: text, url: url },
    }));
  }

  function dispatchDebug(detail) {
    document.dispatchEvent(new CustomEvent('yt-translate-debug', { detail: detail }));
  }

  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = request.url;
      if (url.indexOf('/api/timedtext') === -1 && url.indexOf('youtubei/v1/player') === -1) {
        return origFetch.call(window, request);
      }

      return origFetch.call(window, request).then(function (response) {
        const clone = response.clone();
        if (url.indexOf('/api/timedtext') !== -1) {
          clone.text().then(function (text) {
            if (text && text.length > 0) dispatchTimedtext(text, url);
          }).catch(function () {});
        }

        if (url.indexOf('youtubei/v1/player') !== -1) {
          clone.json().then(function (json) {
            dispatchDebug({
              type: 'innertube',
              hasCaptions: !!(json && json.captions && json.captions.playerCaptionsTracklistRenderer),
              keys: Object.keys(json || {}).join(','),
            });
          }).catch(function () {});
        }
        return response;
      });
    };
  }

  const origXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (typeof url === 'string' && (url.indexOf('/api/timedtext') !== -1 || url.indexOf('youtubei/v1/player') !== -1)) {
      this._ytTimedtextUrl = url;
    }
    return origXHROpen.apply(this, arguments);
  };

  const origXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    if (this._ytTimedtextUrl) {
      const xhr = this;
      const origOnReadyStateChange = this.onreadystatechange;
      this.onreadystatechange = function () {
        if (xhr.readyState === 4) {
          handleXhrResponse(xhr);
        }
        if (origOnReadyStateChange) {
          origOnReadyStateChange.apply(xhr, arguments);
        }
      };
      this.addEventListener('load', function () {
        handleXhrResponse(xhr);
      });
    }
    return origXHRSend.apply(this, arguments);
  };

  function handleXhrResponse(xhr) {
    const url = xhr._ytTimedtextUrl || '';
    const text = xhr.responseText;
    if (text && text.length > 0 && url.indexOf('/api/timedtext') !== -1) {
      dispatchTimedtext(text, url);
    }
    if (text && url.indexOf('youtubei/v1/player') !== -1) {
      try {
        const json = JSON.parse(text);
        dispatchDebug({
          type: 'innertube',
          hasCaptions: !!(json && json.captions && json.captions.playerCaptionsTracklistRenderer),
          keys: Object.keys(json || {}).join(','),
        });
      } catch (_err) {}
    }
  }
})();
