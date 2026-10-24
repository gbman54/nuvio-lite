/* global window, document, console, XMLHttpRequest */
/**
 * Nuvio TV Lite - Dual Engine Video Player with EngineFS Proxy Support
 * Supports Samsung Tizen AVPlay (hardware acceleration) with HTML5/HLS.js fallback
 * Automatic loopback media proxy resolution (127.0.0.1:2710) for custom headers (Referer, User-Agent) & CORS bypass
 * Strict ES5 for Samsung Tizen 3.0 (Chromium 47)
 */
(function(window) {
  'use strict';

  function isEmbedUrl(url) {
    if (!url) return false;
    var clean = String(url).toLowerCase();
    // Direct stream containers take priority
    if (clean.indexOf('.m3u8') !== -1 || clean.indexOf('.mp4') !== -1 || clean.indexOf('.mkv') !== -1) {
      return false;
    }
    return (
      clean.indexOf('vidlink.pro') !== -1 ||
      clean.indexOf('vidsrc.') !== -1 ||
      clean.indexOf('multiembed') !== -1 ||
      clean.indexOf('embed.su') !== -1 ||
      clean.indexOf('2embed') !== -1 ||
      clean.indexOf('moviesapi.club') !== -1 ||
      clean.indexOf('embed') !== -1
    );
  }

  var Player = {
    engine: 'none', // 'avplay' or 'html5'
    avplay: null,
    videoEl: null,
    embedEl: null,
    containerEl: null,
    activeUrl: null,
    currentTitle: '',
    isPlayingState: false,
    isEmbedMode: false,
    hlsInstance: null,
    audioTracks: [],
    subtitleTracks: [],
    durationMs: 0,
    currentTimeMs: 0,
    listener: null,

    proxyBase: 'http://127.0.0.1:2710',
    subtitleFetchServiceBase: 'http://127.0.0.1:2711',
    proxyAvailable: false,
    activeHeaders: null,
    externalSubtitleTracks: [],
    externalSubtitleElements: [],
    externalSubtitleRequestId: 0,
    externalSubtitleRequest: null,
    subtitleDelayMs: 0,

    init: function(containerId, videoId, embedFrameId) {
      this.containerEl = document.getElementById(containerId);
      this.videoEl = document.getElementById(videoId);
      this.embedEl = document.getElementById(embedFrameId || 'embed-frame');

      if (window.webapis && window.webapis.avplay) {
        this.avplay = window.webapis.avplay;
        this.engine = 'avplay';
      } else {
        this.engine = 'html5';
      }

      this._bindHtml5Events();
      this.launchTizenService();
      this.probeProxy();
    },

    launchTizenService: function() {
      // If running on Samsung Smart TV, launch the background EngineFS Service
      if (window.tizen && window.tizen.application && window.tizen.ApplicationControl) {
        try {
          var control = new window.tizen.ApplicationControl('http://tizen.org/appcontrol/operation/default');
          window.tizen.application.launchAppControl(control, 'NuvioTV030.EngineFsService', function() {
            console.log('[Tizen Service EngineFS launched successfully]');
          }, function(err) {
            console.warn('[Tizen Service EngineFS launch notification]', err);
          });
        } catch (e) {
          console.warn('[Tizen launchAppControl failed]', e);
        }
      }
    },

    probeProxy: function(cb) {
      var self = this;
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', this.proxyBase + '/heartbeat', true);
        xhr.timeout = 2000;
        xhr.onload = function() {
          if (xhr.status === 200) {
            self.proxyAvailable = true;
            console.log('[Player] EngineFS Proxy detected active on ' + self.proxyBase);
          } else {
            self.proxyAvailable = false;
          }
          if (cb) cb(self.proxyAvailable);
        };
        xhr.onerror = function() {
          self.proxyAvailable = false;
          if (cb) cb(false);
        };
        xhr.ontimeout = function() {
          self.proxyAvailable = false;
          if (cb) cb(false);
        };
        xhr.send();
      } catch (e) {
        self.proxyAvailable = false;
        if (cb) cb(false);
      }
    },

    buildProxyUrl: function(targetUrl, headers) {
      if (!targetUrl) return '';
      // If already routed through proxy, return as is
      if (targetUrl.indexOf('/proxy/') !== -1) return targetUrl;

      try {
        var a = document.createElement('a');
        a.href = targetUrl;
        var destOrigin = a.protocol + '//' + a.host;
        var pathname = a.pathname || '/';
        if (pathname.charAt(0) !== '/') pathname = '/' + pathname;
        var search = a.search || '';

        var queryParts = ['d=' + encodeURIComponent(destOrigin)];

        if (headers && typeof headers === 'object') {
          for (var k in headers) {
            if (Object.prototype.hasOwnProperty.call(headers, k)) {
              var val = String(headers[k] || '');
              queryParts.push('h=' + encodeURIComponent(k + ':' + val));
            }
          }
        }

        var base = String(this.proxyBase || 'http://127.0.0.1:2710').replace(/\/+$/, '');
        return base + '/proxy/' + queryParts.join('&') + pathname + search;
      } catch (e) {
        return targetUrl;
      }
    },

    _bindHtml5Events: function() {
      var self = this;
      if (!this.videoEl) return;

      this.videoEl.addEventListener('play', function() {
        self.isPlayingState = true;
        self._notify('play');
      });

      this.videoEl.addEventListener('pause', function() {
        self.isPlayingState = false;
        self._notify('pause');
      });

      this.videoEl.addEventListener('timeupdate', function() {
        self.currentTimeMs = Math.floor(self.videoEl.currentTime * 1000);
        self.durationMs = Math.floor((self.videoEl.duration || 0) * 1000);
        if (self.subtitleDelayMs) self._applyHtml5SubtitleDelay();
        if (self.videoEl.currentTime > 0) {
          self._notify('buffering', false);
        }
        self._notify('timeupdate', {
          current: self.currentTimeMs,
          duration: self.durationMs
        });
      });

      this.videoEl.addEventListener('ended', function() {
        self.isPlayingState = false;
        self._notify('ended');
      });

      this.videoEl.addEventListener('error', function(err) {
        if (self.isEmbedMode || !self.activeUrl) return;
        self.isPlayingState = false;
        self._notify('error', err);
      });

      this.videoEl.addEventListener('waiting', function() {
        self._notify('buffering', true);
      });

      this.videoEl.addEventListener('playing', function() {
        self._notify('buffering', false);
      });
    },

    _notify: function(event, data) {
      if (this.listener && typeof this.listener[event] === 'function') {
        this.listener[event](data);
      }
    },

    setEventListener: function(listener) {
      this.listener = listener;
    },

    _languageName: function(value) {
      var code = String(value || '').replace(/_/g, '-').toLowerCase();
      var names = {
        en: 'English', eng: 'English', ar: 'Arabic', ara: 'Arabic',
        es: 'Spanish', spa: 'Spanish', fr: 'French', fra: 'French', fre: 'French',
        de: 'German', deu: 'German', ger: 'German', it: 'Italian', ita: 'Italian',
        pt: 'Portuguese', por: 'Portuguese', ru: 'Russian', rus: 'Russian',
        ja: 'Japanese', jpn: 'Japanese', ko: 'Korean', kor: 'Korean',
        zh: 'Chinese', zho: 'Chinese', chi: 'Chinese', hi: 'Hindi', hin: 'Hindi',
        tr: 'Turkish', tur: 'Turkish', und: 'Unknown'
      };
      var shortCode = code.split('-')[0];
      return names[code] || names[shortCode] || (value ? String(value).toUpperCase() : 'Unknown');
    },

    getTracks: function(type) {
      var tracks = [];
      var isSubtitle = type === 'subtitle';
      var self = this;

      if (this.engine === 'avplay' && this.avplay && typeof this.avplay.getTotalTrackInfo === 'function') {
        try {
          if (isSubtitle) tracks.push({ value: -1, label: 'Off', selected: false });
          var avTracks = this.avplay.getTotalTrackInfo() || [];
          for (var a = 0; a < avTracks.length; a++) {
            var avTrack = avTracks[a];
            var avType = String(avTrack.type || '').toUpperCase();
            if ((isSubtitle && avType !== 'TEXT') || (!isSubtitle && avType !== 'AUDIO')) continue;

            var extra = avTrack.extra_info || {};
            if (typeof extra === 'string') {
              try { extra = JSON.parse(extra); } catch (parseError) { extra = {}; }
            }
            var language = extra.track_lang || extra.language || avTrack.language || '';
            var label = self._languageName(language);
            if (extra.codec || extra.fourCC) label += ' · ' + (extra.codec || extra.fourCC);
            tracks.push({ value: avTrack.index, label: label, selected: tracks.length === 0 });
          }
        } catch (avTrackError) {
          console.warn('[Player] Could not read AVPlay tracks', avTrackError);
        }
      } else if (this.hlsInstance) {
        var hlsTracks = isSubtitle ? (this.hlsInstance.subtitleTracks || []) : (this.hlsInstance.audioTracks || []);
        var selectedTrack = isSubtitle ? this.hlsInstance.subtitleTrack : this.hlsInstance.audioTrack;
        tracks.push({ value: -1, label: isSubtitle ? 'Off' : 'Auto', selected: selectedTrack === -1 });
        for (var h = 0; h < hlsTracks.length; h++) {
          var hlsTrack = hlsTracks[h];
          var hlsLanguage = hlsTrack.lang || hlsTrack.language || '';
          var hlsLabel = hlsTrack.name && hlsTrack.name !== 'undefined'
            ? hlsTrack.name
            : self._languageName(hlsLanguage);
          if (hlsTrack.channels) hlsLabel += ' · ' + hlsTrack.channels;
          tracks.push({ value: hlsTrack.id, label: hlsLabel, selected: hlsTrack.id === selectedTrack });
        }
        if (isSubtitle) tracks = tracks.concat(this._getExternalSubtitleOptions());
      } else if (this.videoEl) {
        var nativeTracks = isSubtitle ? this.videoEl.textTracks : this.videoEl.audioTracks;
        if (isSubtitle) tracks.push({ value: -1, label: 'Off', selected: true });
        if (nativeTracks) {
          for (var n = 0; n < nativeTracks.length; n++) {
            var nativeTrack = nativeTracks[n];
            var nativeLabel = nativeTrack.label || self._languageName(nativeTrack.language);
            tracks.push({ value: n, label: nativeLabel, selected: isSubtitle ? nativeTrack.mode === 'showing' : nativeTrack.enabled });
          }
        }
        if (isSubtitle) tracks = tracks.concat(this._getExternalSubtitleOptions());
      }
      if (isSubtitle && this.engine === 'avplay') tracks = tracks.concat(this._getExternalSubtitleOptions());
      if (isSubtitle) {
        // External and stream-provided subtitles share one picker, but each
        // source reports its own selected state. An external selection must
        // take precedence so the UI never marks English and Arabic together.
        var hasSelectedExternal = false;
        for (var selectedExternalIndex = 0; selectedExternalIndex < this.externalSubtitleTracks.length; selectedExternalIndex++) {
          if (this.externalSubtitleTracks[selectedExternalIndex].selected === true) {
            hasSelectedExternal = true;
            break;
          }
        }
        if (hasSelectedExternal) {
          for (var selectedTrackIndex = 0; selectedTrackIndex < tracks.length; selectedTrackIndex++) {
            tracks[selectedTrackIndex].selected = /^external-/.test(String(tracks[selectedTrackIndex].value))
              ? tracks[selectedTrackIndex].selected
              : false;
          }
        }
      }
      return tracks;
    },

    _getExternalSubtitleOptions: function() {
      var options = [];
      for (var i = 0; i < this.externalSubtitleTracks.length; i++) {
        var track = this.externalSubtitleTracks[i];
        var trackLabel = track.label || this._languageName(track.lang || track.language || track.name);
        if (track.addonName) trackLabel += ' · ' + track.addonName;
        options.push({
          value: 'external-' + i,
          label: trackLabel,
          selected: track.selected === true
        });
      }
      return options;
    },

    addExternalSubtitleTracks: function(subtitles) {
      if (!(subtitles instanceof Array)) return;
      var existing = {};
      for (var i = 0; i < this.externalSubtitleTracks.length; i++) {
        existing[this.externalSubtitleTracks[i].url] = true;
      }
      for (var j = 0; j < subtitles.length; j++) {
        var track = subtitles[j];
        if (!track || !track.url || !/^https?:\/\//i.test(track.url) || existing[track.url]) continue;
        existing[track.url] = true;
        this.externalSubtitleTracks.push(track);
      }
      this._notify('trackschange');
    },

    _removeExternalSubtitleElements: function() {
      this.externalSubtitleRequestId++;
      if (this.externalSubtitleRequest) {
        try { this.externalSubtitleRequest.abort(); } catch (abortError) {}
        this.externalSubtitleRequest = null;
      }
      for (var i = 0; i < this.externalSubtitleElements.length; i++) {
        var element = this.externalSubtitleElements[i];
        if (element && element._nuvioSubtitleObjectUrl) {
          try {
            var urlApi = window.URL || window.webkitURL;
            if (urlApi && urlApi.revokeObjectURL) urlApi.revokeObjectURL(element._nuvioSubtitleObjectUrl);
          } catch (revokeError) {}
        }
        if (element && element.parentNode) element.parentNode.removeChild(element);
      }
      this.externalSubtitleElements = [];
    },

    _fetchExternalSubtitleText: function(url, callback) {
      var self = this;
      var finished = false;
      var cancelled = false;
      var fallbackStarted = false;
      var currentRequest = null;
      // OpenSubtitles addon responses have been observed with a redundant
      // slash before the query string. Some deployments return nginx 500 for
      // that spelling, while serving the canonical route without it.
      var retryUrl = String(url || '').replace(/\/sub\.vtt\/(\?)/i, '/sub.vtt$1');
      if (retryUrl === url) retryUrl = '';
      var requestHandle = {
        abort: function() {
          cancelled = true;
          if (currentRequest) {
            try { currentRequest.abort(); } catch (abortError) {}
          }
        }
      };
      this.externalSubtitleRequest = requestHandle;
      function finish(error, text) {
        if (finished || cancelled) return;
        finished = true;
        if (self.externalSubtitleRequest === requestHandle) self.externalSubtitleRequest = null;
        callback(error, text);
      }

      function fetchThroughEngineFs() {
        if (finished || cancelled || fallbackStarted) return;
        fallbackStarted = true;
        if (currentRequest) {
          try { currentRequest.abort(); } catch (abortError) {}
        }
        var proxyRequest = new XMLHttpRequest();
        currentRequest = proxyRequest;
        var requestUrl = url;
        var proxyUrl = self.proxyAvailable ? self.buildProxyUrl(requestUrl) : requestUrl;
        proxyRequest.open('GET', proxyUrl, true);
        proxyRequest.timeout = 20000;
        proxyRequest.onreadystatechange = function() {
          if (proxyRequest.readyState !== 4) return;
          if (proxyRequest.status >= 200 && proxyRequest.status < 300) {
            finish(null, proxyRequest.responseText || '');
          } else if (proxyRequest.status >= 500 && retryUrl) {
            // Retry once with the canonical no-trailing-slash endpoint. Keep
            // the retry on the same transport so proxy routing stays intact.
            var retryTarget = retryUrl;
            retryUrl = '';
            var retryRequest = new XMLHttpRequest();
            currentRequest = retryRequest;
            var retryProxyUrl = self.proxyAvailable ? self.buildProxyUrl(retryTarget) : retryTarget;
            retryRequest.open('GET', retryProxyUrl, true);
            retryRequest.timeout = 20000;
            retryRequest.onreadystatechange = function() {
              if (retryRequest.readyState !== 4) return;
              if (retryRequest.status >= 200 && retryRequest.status < 300) finish(null, retryRequest.responseText || '');
              else finish(new Error('Subtitle provider returned HTTP ' + retryRequest.status + ' (original URL: HTTP ' + proxyRequest.status + ')'), null);
            };
            retryRequest.onerror = function() { finish(new Error('Subtitle retry request failed'), null); };
            retryRequest.ontimeout = function() { finish(new Error('Subtitle retry request timed out'), null); };
            try { retryRequest.send(null); } catch (retryError) { finish(retryError, null); }
          } else {
            finish(new Error('Subtitle provider returned HTTP ' + proxyRequest.status), null);
          }
        };
        proxyRequest.onerror = function() {
          finish(new Error('Subtitle proxy request failed'), null);
        };
        proxyRequest.ontimeout = function() {
          finish(new Error('Subtitle proxy request timed out'), null);
        };
        try {
          proxyRequest.send(null);
        } catch (proxyError) {
          finish(proxyError, null);
        }
      }

      // The lightweight PluginService can fetch text resources without the
      // EngineFS media proxy's playlist/stream handling. Keep EngineFS as a
      // fallback for TVs where PluginService is unavailable (older Tizen).
      var serviceRequest = new XMLHttpRequest();
      currentRequest = serviceRequest;
      serviceRequest.open('POST', this.subtitleFetchServiceBase + '/fetch', true);
      // text/plain avoids a browser preflight; the local service parses JSON
      // bodies independently of their Content-Type.
      serviceRequest.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
      serviceRequest.timeout = 22000;
      serviceRequest.onreadystatechange = function() {
        if (serviceRequest.readyState !== 4 || finished || cancelled || fallbackStarted) return;
        if (serviceRequest.status >= 200 && serviceRequest.status < 300) {
          try {
            var result = JSON.parse(serviceRequest.responseText || '{}');
            if (result && result.returnValue && result.ok && typeof result.body === 'string') {
              finish(null, result.body);
              return;
            }
            if (result && result.returnValue && result.status) {
              console.warn('[Player] Subtitle provider returned HTTP ' + result.status, String(result.body || '').slice(0, 240));
            }
          } catch (parseError) {}
        }
        fetchThroughEngineFs();
      };
      serviceRequest.onerror = fetchThroughEngineFs;
      serviceRequest.ontimeout = fetchThroughEngineFs;
      try {
        serviceRequest.send(JSON.stringify({
          url: url,
          method: 'GET',
          responseEncoding: 'text',
          maxResponseBytes: 1500000,
          timeoutMs: 18000,
          headers: {
            Accept: 'text/vtt, text/plain;q=0.9, */*;q=0.8',
            'User-Agent': window.navigator && window.navigator.userAgent ? window.navigator.userAgent : 'Mozilla/5.0'
          }
        }));
      } catch (serviceError) {
        fetchThroughEngineFs();
      }
    },

    setSubtitleDelay: function(delayMs) {
      var bounded = Math.max(-10000, Math.min(10000, Number(delayMs) || 0));
      this.subtitleDelayMs = Math.round(bounded / 250) * 250;
      if (this.engine === 'avplay' && this.avplay && typeof this.avplay.setSubtitlePosition === 'function') {
        try {
          this.avplay.setSubtitlePosition(this.subtitleDelayMs);
          return true;
        } catch (avplayDelayError) {
          console.warn('[Player] AVPlay could not set subtitle delay', avplayDelayError);
          return false;
        }
      }
      this._applyHtml5SubtitleDelay();
      return true;
    },

    _applyHtml5SubtitleDelay: function() {
      if (!this.videoEl || !this.videoEl.textTracks) return false;
      var offsetSeconds = this.subtitleDelayMs / 1000;
      var tracks = this.videoEl.textTracks;
      var changed = false;
      for (var trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
        var cues = tracks[trackIndex].cues;
        if (!cues) continue;
        for (var cueIndex = 0; cueIndex < cues.length; cueIndex++) {
          var cue = cues[cueIndex];
          if (!cue || typeof cue.startTime !== 'number' || typeof cue.endTime !== 'number') continue;
          if (typeof cue._nuvioBaseStartTime !== 'number') {
            try {
              cue._nuvioBaseStartTime = cue.startTime;
              cue._nuvioBaseEndTime = cue.endTime;
            } catch (baselineError) {
              continue;
            }
          }
          try {
            cue.startTime = Math.max(0, cue._nuvioBaseStartTime + offsetSeconds);
            cue.endTime = Math.max(cue.startTime + 0.05, cue._nuvioBaseEndTime + offsetSeconds);
            changed = true;
          } catch (cueDelayError) {
            // Some native/browser-provided cues are read-only; continue with
            // other tracks and cues that permit timing adjustments.
          }
        }
      }
      return changed;
    },

    _addHtml5ExternalSubtitle: function(index) {
      var track = this.externalSubtitleTracks[index];
      if (!this.videoEl || !track || !track.url || !document.createElement) return false;
      this._removeExternalSubtitleElements();
      var self = this;
      var requestId = this.externalSubtitleRequestId;
      var previousHlsSubtitleTrack = this.hlsInstance ? this.hlsInstance.subtitleTrack : null;
      var previousNativeSubtitleModes = [];
      var previousNativeTracks = this.videoEl.textTracks;
      if (previousNativeTracks) {
        for (var previousNativeIndex = 0; previousNativeIndex < previousNativeTracks.length; previousNativeIndex++) {
          previousNativeSubtitleModes.push(previousNativeTracks[previousNativeIndex].mode);
        }
      }
      this._fetchExternalSubtitleText(track.url, function(requestError, responseText) {
        if (requestId !== self.externalSubtitleRequestId) return;
        self.externalSubtitleRequest = null;
        if (requestError) {
          console.warn('[Player] External subtitle request failed', requestError.message, track.url);
          // The provider did not return a subtitle file. Clear the optimistic
          // external selection and restore the stream subtitle that was active
          // before the user tried this track.
          for (var failedIndex = 0; failedIndex < self.externalSubtitleTracks.length; failedIndex++) {
            self.externalSubtitleTracks[failedIndex].selected = false;
          }
          try {
            if (self.hlsInstance && previousHlsSubtitleTrack !== null) {
              self.hlsInstance.subtitleTrack = previousHlsSubtitleTrack;
            }
            var currentNativeTracks = self.videoEl && self.videoEl.textTracks;
            if (currentNativeTracks) {
              for (var restoreIndex = 0; restoreIndex < currentNativeTracks.length; restoreIndex++) {
                currentNativeTracks[restoreIndex].mode = previousNativeSubtitleModes[restoreIndex] || 'disabled';
              }
            }
          } catch (restoreError) {
            console.warn('[Player] Could not restore previous subtitles', restoreError);
          }
          self._notify('trackschange');
          return;
        }

        try {
          var subtitleText = String(responseText || '').replace(/^\uFEFF/, '');
          if (!/^WEBVTT(?:\s|$)/i.test(subtitleText)) {
            // HTML5 text tracks require WebVTT. Convert the common SRT cue
            // timestamp separator while keeping the cue text unchanged.
            subtitleText = 'WEBVTT\n\n' + subtitleText.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
          }
          var blob = new Blob([subtitleText], { type: 'text/vtt;charset=utf-8' });
          var urlApi = window.URL || window.webkitURL;
          if (!urlApi || !urlApi.createObjectURL) throw new Error('Blob URLs are unavailable');
          var objectUrl = urlApi.createObjectURL(blob);
          var element = document.createElement('track');
          element.setAttribute('kind', 'subtitles');
          element.setAttribute('src', objectUrl);
          element.setAttribute('srclang', String(track.lang || track.language || 'und').split(/[-_]/)[0]);
          element.setAttribute('label', self._languageName(track.lang || track.language || track.label || track.name));
          element._nuvioSubtitleObjectUrl = objectUrl;
          element.addEventListener('load', function() {
            if (requestId !== self.externalSubtitleRequestId) return;
            try {
              if (self.hlsInstance) self.hlsInstance.subtitleTrack = -1;
              var nativeTracks = self.videoEl && self.videoEl.textTracks;
              if (nativeTracks) {
                for (var nativeIndex = 0; nativeIndex < nativeTracks.length; nativeIndex++) {
                  nativeTracks[nativeIndex].mode = nativeTracks[nativeIndex] === element.track ? 'showing' : 'disabled';
                }
              }
              if (element.track) element.track.mode = 'showing';
              self._applyHtml5SubtitleDelay();
              for (var selectedIndex = 0; selectedIndex < self.externalSubtitleTracks.length; selectedIndex++) {
                self.externalSubtitleTracks[selectedIndex].selected = selectedIndex === index;
              }
              self._notify('trackschange');
            } catch (selectionError) {
              console.warn('[Player] Could not activate external subtitle track', selectionError);
            }
          });
          element.addEventListener('error', function() {
            console.warn('[Player] Browser could not load external subtitle track', track.url);
          });
          self.videoEl.appendChild(element);
          self.externalSubtitleElements.push(element);
          if (element.track) element.track.mode = 'showing';
        } catch (attachError) {
          console.warn('[Player] Could not attach external subtitle track', attachError);
        }
      });
      return true;
    },

    _downloadAvplaySubtitle: function(index) {
      var self = this;
      var track = this.externalSubtitleTracks[index];
      if (!track || !track.url || !window.tizen || !window.tizen.download || !window.tizen.DownloadRequest ||
          typeof this.avplay.setExternalSubtitlePath !== 'function') return false;
      try {
        var request = new window.tizen.DownloadRequest(track.url, 'wgt-private-tmp');
        window.tizen.download.start(request, {
          oncompleted: function(downloadId, fullPath) {
            try {
              self.avplay.setExternalSubtitlePath(fullPath);
              if (typeof self.avplay.setSilentSubtitle === 'function') self.avplay.setSilentSubtitle(false);
              if (typeof self.avplay.setSelectTrack === 'function') {
                try { self.avplay.setSelectTrack('TEXT', -1); } catch (disableEmbeddedError) {}
              }
              for (var i = 0; i < self.externalSubtitleTracks.length; i++) self.externalSubtitleTracks[i].selected = i === index;
              self._notify('trackschange');
            } catch (subtitleError) {
              console.warn('[Player] Could not set downloaded subtitle', subtitleError);
            }
          },
          onfailed: function(downloadId, error) {
            console.warn('[Player] External subtitle download failed', error);
          }
        });
        return true;
      } catch (downloadError) {
        console.warn('[Player] Could not download external subtitle', downloadError);
      }
      return false;
    },

    selectTrack: function(type, value) {
      var isSubtitle = type === 'subtitle';
      var externalMatch = isSubtitle && /^external-(\d+)$/.exec(String(value));
      if (externalMatch) {
        var externalIndex = parseInt(externalMatch[1], 10);
        if (this.engine === 'avplay') return this._downloadAvplaySubtitle(externalIndex);
        if (!this._addHtml5ExternalSubtitle(externalIndex)) return false;
        // Stop the embedded subtitle as soon as the user chooses an external
        // one. Waiting for the external VTT load event leaves the old language
        // visible during loading (and indefinitely if the provider is slow).
        try {
          if (this.hlsInstance) this.hlsInstance.subtitleTrack = -1;
          var embeddedTracks = this.videoEl && this.videoEl.textTracks;
          if (embeddedTracks) {
            for (var embeddedIndex = 0; embeddedIndex < embeddedTracks.length; embeddedIndex++) {
              embeddedTracks[embeddedIndex].mode = 'disabled';
            }
          }
        } catch (disableEmbeddedError) {
          console.warn('[Player] Could not disable embedded subtitles', disableEmbeddedError);
        }
        for (var externalTrackIndex = 0; externalTrackIndex < this.externalSubtitleTracks.length; externalTrackIndex++) {
          this.externalSubtitleTracks[externalTrackIndex].selected = externalTrackIndex === externalIndex;
        }
        return true;
      }
      if (isSubtitle && String(value) === '-1') {
        this._removeExternalSubtitleElements();
        for (var offIndex = 0; offIndex < this.externalSubtitleTracks.length; offIndex++) this.externalSubtitleTracks[offIndex].selected = false;
      }
      var index = Number(value);
      try {
        if (this.engine === 'avplay' && this.avplay) {
          if (isSubtitle && index === -1) {
            if (typeof this.avplay.setSilentSubtitle === 'function') this.avplay.setSilentSubtitle(true);
            return true;
          }
          this.avplay.setSelectTrack(isSubtitle ? 'TEXT' : 'AUDIO', index);
          if (isSubtitle && typeof this.avplay.setSilentSubtitle === 'function') this.avplay.setSilentSubtitle(false);
          return true;
        }
        if (this.hlsInstance) {
          if (isSubtitle) this.hlsInstance.subtitleTrack = index;
          else this.hlsInstance.audioTrack = index;
          return true;
        }
        if (this.videoEl) {
          var nativeTracks = isSubtitle ? this.videoEl.textTracks : this.videoEl.audioTracks;
          if (!nativeTracks) return false;
          for (var i = 0; i < nativeTracks.length; i++) {
            if (isSubtitle) nativeTracks[i].mode = (i === index ? 'showing' : 'disabled');
            else nativeTracks[i].enabled = (i === index);
          }
          return true;
        }
      } catch (selectError) {
        console.warn('[Player] Could not select ' + type + ' track', selectError);
      }
      return false;
    },

    play: function(streamOrUrl, title) {
      this.subtitleDelayMs = 0;
      var rawUrl = '';
      var headers = null;

      if (typeof streamOrUrl === 'object' && streamOrUrl !== null) {
        rawUrl = streamOrUrl.url || streamOrUrl.src || '';
        headers = streamOrUrl.headers || (streamOrUrl.behaviorHints && (streamOrUrl.behaviorHints.headers || streamOrUrl.behaviorHints.proxyHeaders)) || null;
        this.externalSubtitleTracks = [];
        var subtitleSources = streamOrUrl.subtitles instanceof Array ? streamOrUrl.subtitles : [];
        for (var subtitleIndex = 0; subtitleIndex < subtitleSources.length; subtitleIndex++) {
          var subtitleSource = subtitleSources[subtitleIndex];
          if (subtitleSource && subtitleSource.url && /^https?:\/\//i.test(subtitleSource.url)) {
            this.externalSubtitleTracks.push(subtitleSource);
          }
        }
      } else {
        rawUrl = String(streamOrUrl || '');
        this.externalSubtitleTracks = [];
      }
      this._removeExternalSubtitleElements();

      this.currentTitle = title || 'Playing Stream';
      this.currentTimeMs = 0;
      this.durationMs = 0;
      this.activeHeaders = headers;

      if (this.containerEl) {
        this.containerEl.style.display = 'block';
      }

      // Check if URL is an interactive web embed player
      if (isEmbedUrl(rawUrl)) {
        this._playWithEmbed(rawUrl);
        return;
      }

      this.isEmbedMode = false;
      if (this.embedEl) {
        this.embedEl.src = '';
        this.embedEl.style.display = 'none';
      }

      // If stream requires headers (like ha.vixolity.com or Vidmody), ensure headers are present
      if (rawUrl.indexOf('ha.vixolity.com') !== -1 && !headers) {
        headers = {
          'Referer': 'https://ha.vixolity.com/',
          'User-Agent': 'Mozilla/5.0'
        };
        this.activeHeaders = headers;
      }

      var playUrl = rawUrl;

      // Determine if we should proxy this stream
      var needsProxy = Boolean(
        (headers && Object.keys(headers).length > 0) ||
        rawUrl.indexOf('ha.vixolity.com') !== -1
      );

      // In browser testing or if proxy is active, transform URL through 127.0.0.1:2710 proxy
      if (needsProxy && (this.proxyAvailable || this.engine === 'html5')) {
        playUrl = this.buildProxyUrl(rawUrl, headers);
        console.log('[Player] Proxied Stream URL:', playUrl);
      }

      this.activeUrl = playUrl;

      if (this.engine === 'avplay' && this.avplay) {
        this._playWithAvPlay(playUrl, headers);
      } else {
        this._playWithHtml5(playUrl, headers, rawUrl);
      }
    },

    _playWithEmbed: function(url) {
      this.isEmbedMode = true;
      this.activeUrl = url;

      if (this.videoEl) {
        this.videoEl.pause();
        this.videoEl.src = '';
        this.videoEl.style.display = 'none';
      }
      this._removeExternalSubtitleElements();
      this.externalSubtitleTracks = [];
      if (this.hlsInstance) {
        this.hlsInstance.destroy();
        this.hlsInstance = null;
      }

      if (this.embedEl) {
        this.embedEl.style.display = 'block';
        this.embedEl.src = url;
      }

      this.isPlayingState = true;
      this._notify('play');
    },

    _playWithAvPlay: function(url, headers) {
      var self = this;
      var avplay = this.avplay;

      if (this.videoEl) {
        this.videoEl.style.display = 'none';
      }

      try {
        avplay.stop();
        avplay.close();
      } catch (e) {}

      try {
        avplay.open(url);
        avplay.setDisplayRect(0, 0, 1920, 1080);

        // Configure custom User-Agent if provided
        var ua = (headers && headers['User-Agent'])
          ? headers['User-Agent']
          : 'Mozilla/5.0 (SMART-TV; Linux; Tizen 3.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/3.0 TV Safari/538.1';
        try {
          avplay.setStreamingProperty('USER_AGENT', ua);
        } catch (uaErr) {}

        avplay.setListener({
          onbufferingstart: function() {
            self._notify('buffering', true);
          },
          onbufferingprogress: function(percent) {
            self._notify('bufferingProgress', percent);
          },
          onbufferingcomplete: function() {
            self._notify('buffering', false);
          },
          oncurrentplaytime: function(timeMs) {
            self.currentTimeMs = timeMs;
            try {
              self.durationMs = avplay.getDuration();
            } catch (e) {}
            self._notify('timeupdate', {
              current: self.currentTimeMs,
              duration: self.durationMs
            });
          },
          onstreamcompleted: function() {
            self.isPlayingState = false;
            self._notify('ended');
          },
          onerror: function(err) {
            console.error('[AVPlay Error]', err);
            self.engine = 'html5';
            self._playWithHtml5(url, headers);
          }
        });

        avplay.prepareAsync(function() {
          try {
            self.durationMs = avplay.getDuration();
            avplay.play();
            if (typeof avplay.setSubtitlePosition === 'function') {
              try { avplay.setSubtitlePosition(self.subtitleDelayMs); } catch (subtitleDelayError) {}
            }
            self._notify('trackschange');
            self.isPlayingState = true;
            self._notify('play');
          } catch (err) {
            console.error('[AVPlay Play Threw]', err);
          }
        }, function(prepareErr) {
          console.error('[AVPlay Prepare Failed, falling back to HTML5]', prepareErr);
          self.engine = 'html5';
          self._playWithHtml5(url, headers);
        });

      } catch (err) {
        console.error('[AVPlay Open Failed]', err);
        self.engine = 'html5';
        self._playWithHtml5(url, headers);
      }
    },

    _playWithHtml5: function(url, headers, rawUrl) {
      var self = this;
      if (!this.videoEl) return;
      this.videoEl.style.display = 'block';

      if (this.hlsInstance) {
        this.hlsInstance.destroy();
        this.hlsInstance = null;
      }

      var isHlsStream = /\.m3u8(?:[?#].*)?$/i.test(url) ||
                        url.indexOf('ha.vixolity.com/vs/') !== -1 ||
                        url.indexOf('/proxy/') !== -1;

      if (isHlsStream && window.Hls && window.Hls.isSupported()) {
        try {
          var hls = new window.Hls({
            enableWorker: false,
            lowLatencyMode: false,
            progressive: false,
            backBufferLength: 90,
            maxBufferLength: 30,
            maxMaxBufferLength: 60
          });
          this.hlsInstance = hls;
          hls.loadSource(url);
          hls.attachMedia(this.videoEl);

          hls.on(window.Hls.Events.MANIFEST_PARSED, function(event, data) {
            console.log('[HLS.js Manifest Parsed] Levels:', data && data.levels ? data.levels.length : 0);
            self._notify('trackschange');
            var playPromise = self.videoEl.play();
            if (playPromise && typeof playPromise.catch === 'function') {
              playPromise.catch(function(err) {
                console.warn('[HLS.js Auto-play prevented]', err);
              });
            }
          });

          hls.on(window.Hls.Events.ERROR, function(event, data) {
            if (self.hlsInstance !== hls) return;
            console.warn('[HLS.js error event]', {
              type: data.type,
              details: data.details,
              fatal: data.fatal,
              error: data.error ? (data.error.message || String(data.error)) : null,
              reason: data.reason || null,
              fragUrl: data.frag ? data.frag.url : null
            });

            // Some providers advertise subtitle playlists as image URLs (for
            // example /vtt/.../sub_en.jpg). A failed subtitle request must not
            // stop an otherwise valid video stream.
            var failedFragUrl = data.frag && data.frag.url ? String(data.frag.url) : '';
            var isSubtitleFailure = (data.frag && data.frag.type === 'subtitle') ||
                                    /\/vtt\/|\/subs?[-_/]|\.(?:vtt|srt)(?:[?#]|$)/i.test(failedFragUrl);
            if (data.fatal && data.type === window.Hls.ErrorTypes.NETWORK_ERROR && isSubtitleFailure) {
              console.warn('[HLS.js] Disabling the unavailable subtitle track; continuing video playback');
              try { hls.subtitleTrack = -1; } catch (subtitleErr) {}
              return;
            }

            if (data.fatal) {
              console.warn('[HLS.js fatal error]', data.type, data.details);

              switch (data.type) {
                case window.Hls.ErrorTypes.NETWORK_ERROR:
                  if ((data.details === 'manifestLoadError' || data.details === 'manifestLoadTimeOut') &&
                      url.indexOf('/proxy/') !== -1) {
                    console.warn('[HLS.js] Stream manifest could not be loaded; returning control to the source picker');
                    hls.destroy();
                    if (self.hlsInstance === hls) self.hlsInstance = null;
                    self.isPlayingState = false;
                    self._notify('unavailable', {
                      details: data.details,
                      status: data.response && data.response.code ? data.response.code : null,
                      url: url
                    });
                    return;
                  }
                  if (url.indexOf('/proxy/') === -1) {
                    var proxied = self.buildProxyUrl(rawUrl || url, headers);
                    console.log('[HLS.js Retrying with EngineFS Proxy]', proxied);
                    hls.destroy();
                    self.hlsInstance = null;
                    self._playWithHtml5(proxied, headers, rawUrl);
                    return;
                  }
                  console.log('[HLS.js] Attempting network error recovery with startLoad()');
                  hls.startLoad();
                  break;

                case window.Hls.ErrorTypes.MEDIA_ERROR:
                  if (data.details === 'fragParsingError') {
                    console.warn('[HLS.js] Non-recoverable fragment parsing error on:', data.frag ? data.frag.url : 'unknown');
                    hls.destroy();
                    self.hlsInstance = null;
                    return;
                  }
                  console.log('[HLS.js] Attempting media error recovery with recoverMediaError()');
                  hls.recoverMediaError();
                  break;

                default:
                  console.warn('[HLS.js] Fatal unrecoverable error:', data.details);
                  if (self.videoEl.canPlayType('application/vnd.apple.mpegurl')) {
                    hls.destroy();
                    self.hlsInstance = null;
                    self.videoEl.src = url;
                    var p = self.videoEl.play();
                    if (p && typeof p.catch === 'function') {
                      p.catch(function(playErr) {
                        console.warn('[Native HTML5 fallback failed]', playErr);
                      });
                    }
                  }
                  break;
              }
            }
          });
          return;
        } catch (e) {
          console.warn('[Hls.js init error, falling back to native src]', e);
        }
      }

      // Direct HTML5 src fallback
      this.videoEl.src = url;
      var playPromise = this.videoEl.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(function(err) {
          console.warn('[HTML5 Play auto-play rejected]', err);
        });
      }
    },

    togglePlayPause: function() {
      if (this.isEmbedMode) return;
      if (this.isPlayingState) {
        this.pause();
      } else {
        this.resume();
      }
    },

    pause: function() {
      if (this.isEmbedMode) return;
      this.isPlayingState = false;
      if (this.engine === 'avplay' && this.avplay) {
        try {
          this.avplay.pause();
          this._notify('pause');
        } catch (e) {}
      } else if (this.videoEl) {
        this.videoEl.pause();
      }
    },

    resume: function() {
      if (this.isEmbedMode) return;
      this.isPlayingState = true;
      if (this.engine === 'avplay' && this.avplay) {
        try {
          this.avplay.play();
          this._notify('play');
        } catch (e) {}
      } else if (this.videoEl) {
        this.videoEl.play();
      }
    },

    seek: function(deltaSeconds) {
      if (this.isEmbedMode) return;
      var targetMs = this.currentTimeMs + (deltaSeconds * 1000);
      if (targetMs < 0) targetMs = 0;
      if (this.durationMs > 0 && targetMs > this.durationMs) {
        targetMs = this.durationMs;
      }

      this.currentTimeMs = targetMs;

      if (this.engine === 'avplay' && this.avplay) {
        try {
          this.avplay.seekTo(targetMs);
        } catch (e) {}
      } else if (this.videoEl) {
        this.videoEl.currentTime = targetMs / 1000;
      }
      this._notify('timeupdate', {
        current: this.currentTimeMs,
        duration: this.durationMs
      });
    },

    stop: function() {
      this.isPlayingState = false;
      this.isEmbedMode = false;
      this.activeUrl = null;

      if (this.embedEl) {
        this.embedEl.src = '';
        this.embedEl.style.display = 'none';
      }

      if (this.hlsInstance) {
        this.hlsInstance.destroy();
        this.hlsInstance = null;
      }

      if (this.engine === 'avplay' && this.avplay) {
        try {
          this.avplay.stop();
          this.avplay.close();
        } catch (e) {}
      }

      if (this.videoEl) {
        this.videoEl.pause();
        this.videoEl.src = '';
        this.videoEl.style.display = 'none';
      }

      this._removeExternalSubtitleElements();
      this.externalSubtitleTracks = [];

      if (this.containerEl) {
        this.containerEl.style.display = 'none';
      }
      this._notify('stop');
    }
  };

  window.Player = Player;
})(window);
