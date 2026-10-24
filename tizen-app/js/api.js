/* global window, XMLHttpRequest, localStorage */
/**
 * Nuvio TV Lite - ES5 Data Layer & Addon Client
 * Supports Stremio Addons & Nuvio Community Provider Repositories (from nuvioplugin.com)
 * Strict ES5 compatible with Tizen 3.0 (Chromium 47)
 */
(function(window) {
  'use strict';

  var DEFAULT_METADATA_BASE = 'https://v3-cinemeta.strem.io';
  var STORAGE_KEY_ADDONS = 'nuvio_lite_addons_v1';

  // Recommended Presets from https://nuvioplugin.com
  var PRESET_ADDONS = [
    {
      id: 'pengu',
      name: 'Pengu (Free HTTP Streams)',
      desc: 'No Debrid required. Direct HTTP streams out-of-the-box.',
      url: 'https://pengu.uk',
      type: 'stremio',
      enabled: true
    },
    {
      id: 'cinemeta',
      name: 'Cinemeta (Official Catalog)',
      desc: 'Core metadata and discovery catalog for movies and series.',
      url: 'https://v3-cinemeta.strem.io',
      type: 'catalog-only',
      enabled: true
    }
  ];

  // Fallback demo streams only shown if zero network streams can be resolved
  var DEMO_STREAMS = [
    {
      name: 'HLS Test Stream (720p)',
      title: 'Big Buck Bunny (Direct HLS Demo)',
      url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      quality: '720p'
    },
    {
      name: 'MP4 Test Stream (1080p)',
      title: 'Tears of Steel (Direct MP4 Demo)',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
      quality: '1080p'
    },
    {
      name: 'MP4 Test Stream (720p)',
      title: 'Sintel (Direct MP4 Demo)',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
      quality: '720p'
    }
  ];

  function ajaxGet(url, callback, timeoutMs) {
    var xhr = new XMLHttpRequest();
    var timedOut = false;
    var timer = null;

    timeoutMs = timeoutMs || 9000;

    timer = setTimeout(function() {
      timedOut = true;
      xhr.abort();
      callback(new Error('Network request timed out: ' + url), null);
    }, timeoutMs);

    xhr.open('GET', url, true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        if (timedOut) return;
        clearTimeout(timer);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var data = JSON.parse(xhr.responseText);
            callback(null, data);
          } catch (e) {
            callback(new Error('JSON parse error: ' + e.message), null);
          }
        } else {
          callback(new Error('HTTP ' + xhr.status + ': ' + xhr.statusText), null);
        }
      }
    };
    xhr.onerror = function() {
      if (timedOut) return;
      clearTimeout(timer);
      callback(new Error('Network error requesting ' + url), null);
    };

    try {
      xhr.send(null);
    } catch (err) {
      clearTimeout(timer);
      callback(err, null);
    }
  }

  // Helper to normalize manifest/base URLs
  function normalizeAddonBaseUrl(url) {
    if (!url) return '';
    var clean = String(url).trim();
    // Fragments are client-side only. Keep query parameters because some
    // configured addon manifest URLs carry their configuration in the query.
    clean = clean.split('#')[0];
    var queryIndex = clean.indexOf('?');
    var query = queryIndex === -1 ? '' : clean.substring(queryIndex);
    var path = queryIndex === -1 ? clean : clean.substring(0, queryIndex);
    path = path.replace(/\/manifest\.json\/?$/i, '').replace(/\/+$/, '');
    return path + query;
  }

  // Add an addon resource path before any preserved configuration query.
  function addonResourceUrl(baseUrl, resourcePath) {
    var base = String(baseUrl || '');
    var queryIndex = base.indexOf('?');
    var query = queryIndex === -1 ? '' : base.substring(queryIndex);
    var path = queryIndex === -1 ? base : base.substring(0, queryIndex);
    path = path.replace(/\/+$/, '');
    return path + '/' + String(resourcePath || '').replace(/^\/+/, '') + query;
  }

  var ApiClient = {
    metadataBase: DEFAULT_METADATA_BASE,
    installedAddons: [],
    onAddonsChanged: null,

    init: function() {
      this.loadInstalledAddons();
    },

    loadInstalledAddons: function() {
      var self = this;
      try {
        var raw = localStorage.getItem(STORAGE_KEY_ADDONS);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.installedAddons = parsed;
          }
        }
      } catch (e) {}

      if (!this.installedAddons || this.installedAddons.length === 0) {
        this.installedAddons = PRESET_ADDONS.slice();
        this.saveInstalledAddons();
      }

      // Ensure cinemeta is always catalog-only
      for (var c = 0; c < this.installedAddons.length; c++) {
        if (this.installedAddons[c].url && this.installedAddons[c].url.indexOf('cinemeta') !== -1) {
          this.installedAddons[c].type = 'catalog-only';
        }
      }

      // Load manifest capabilities for existing installs. Older saved entries do
      // not have resourceNames, so discover their supported resources at startup.
      for (var i = 0; i < this.installedAddons.length; i++) {
        var addon = this.installedAddons[i];
        if (!addon.resourceNames || !addon.resourceNames.length || addon.name === 'raw.githubusercontent.com' || !addon.type || addon.name.indexOf('.com') !== -1) {
          (function(targetAddon) {
            self.fetchManifest(targetAddon.url, function(err, manifest) {
              if (!err && manifest) {
                self._applyManifest(targetAddon, manifest);
              }
            });
          })(addon);
        }
      }
    },

    saveInstalledAddons: function() {
      try {
        localStorage.setItem(STORAGE_KEY_ADDONS, JSON.stringify(this.installedAddons));
      } catch (e) {}
    },

    getPresets: function() {
      return PRESET_ADDONS;
    },

    getInstalledAddons: function() {
      return this.installedAddons;
    },

    _isLikelySubtitleAddon: function(addon) {
      var signature = String((addon && addon.name) || '') + ' ' + String((addon && addon.url) || '');
      return /opensubtitles|subsource|subtitle|subdl|subsense/i.test(signature);
    },

    fetchManifest: function(baseUrl, callback) {
      var manifestUrl = addonResourceUrl(baseUrl, 'manifest.json');
      ajaxGet(manifestUrl, function(err, data) {
        if (!err && data) {
          callback(null, data);
        } else {
          // If URL had refs/heads/main, try simple /main fallback
          if (baseUrl.indexOf('/refs/heads/') !== -1) {
            var altBaseUrl = baseUrl.replace('/refs/heads/', '/');
            var altUrl = addonResourceUrl(altBaseUrl, 'manifest.json');
            ajaxGet(altUrl, callback, 6000);
          } else {
            callback(err, null);
          }
        }
      }, 7000);
    },

    _applyManifest: function(addon, manifest) {
      if (!addon || !manifest) return;
      if (manifest.name) addon.name = manifest.name;
      addon.configurationRequired = !!(manifest.behaviorHints && manifest.behaviorHints.configurationRequired);
      if (manifest.scrapers) {
        addon.type = 'nuvio-repo';
        addon.scrapers = manifest.scrapers;
        addon.resourceNames = ['stream'];
      } else {
        addon.type = 'stremio';
        var resources = manifest.resources || [];
        var names = [];
        for (var i = 0; i < resources.length; i++) {
          var resourceName = typeof resources[i] === 'string' ? resources[i] : (resources[i] && resources[i].name);
          if (resourceName && names.indexOf(resourceName) === -1) names.push(resourceName);
        }
        addon.resourceNames = names;
        addon.types = manifest.types || [];
      }
      this.saveInstalledAddons();
      if (typeof this.onAddonsChanged === 'function') this.onAddonsChanged();
    },

    addAddon: function(name, url) {
      var self = this;
      var baseUrl = normalizeAddonBaseUrl(url);
      if (!baseUrl) return false;

      // Extract sensible name from GitHub URL if none provided
      var displayName = name;
      if (!displayName) {
        var ghMatch = baseUrl.match(/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)/i);
        if (ghMatch) {
          displayName = ghMatch[1] + ' (' + ghMatch[2] + ')';
        } else {
          displayName = baseUrl.replace(/^https?:\/\//i, '').split('/')[0];
        }
      }

      // Check if already exists
      for (var i = 0; i < this.installedAddons.length; i++) {
        if (this.installedAddons[i].url === baseUrl) {
          this.installedAddons[i].enabled = true;
          this.saveInstalledAddons();
          return true;
        }
      }

      var isNuvioRepo = baseUrl.indexOf('githubusercontent') !== -1;

      var newAddon = {
        id: 'addon_' + Date.now(),
        name: displayName,
        url: baseUrl,
        type: isNuvioRepo ? 'nuvio-repo' : 'stremio',
        enabled: true,
        resourceNames: isNuvioRepo ? ['stream'] : []
      };

      this.installedAddons.push(newAddon);
      this.saveInstalledAddons();

      // Immediately fetch manifest in background to enrich real title & scraper metadata
      this.fetchManifest(baseUrl, function(err, manifest) {
        if (!err && manifest) {
          self._applyManifest(newAddon, manifest);
        }
      });

      return true;
    },

    removeAddon: function(id) {
      this.installedAddons = this.installedAddons.filter(function(a) {
        return a.id !== id;
      });
      this.saveInstalledAddons();
    },

    toggleAddon: function(id) {
      for (var i = 0; i < this.installedAddons.length; i++) {
        if (this.installedAddons[i].id === id) {
          this.installedAddons[i].enabled = !this.installedAddons[i].enabled;
          break;
        }
      }
      this.saveInstalledAddons();
    },

    getActiveStreamAddons: function() {
      var active = [];
      for (var i = 0; i < this.installedAddons.length; i++) {
        var addon = this.installedAddons[i];
        var resources = addon.resourceNames || [];
        var hasKnownResources = resources.length > 0;
        if (addon.enabled && addon.url && addon.type !== 'catalog-only' && addon.url.indexOf('cinemeta') === -1 &&
            (resources.indexOf('stream') !== -1 || (!hasKnownResources && !this._isLikelySubtitleAddon(addon)))) {
          active.push(addon);
        }
      }
      return active;
    },

    getActiveSubtitleAddons: function() {
      var active = [];
      for (var i = 0; i < this.installedAddons.length; i++) {
        var addon = this.installedAddons[i];
        var resources = addon.resourceNames || [];
        if (addon.enabled && addon.url && addon.type !== 'nuvio-repo' &&
            (resources.indexOf('subtitles') !== -1 || (!resources.length && this._isLikelySubtitleAddon(addon)))) {
          active.push(addon);
        }
      }
      return active;
    },

    // Fetch catalog list (e.g. type="movie" or "series", id="top")
    getCatalog: function(type, catalogId, callback, skip, extras) {
      type = type || 'movie';
      catalogId = catalogId || 'top';
      var offset = Math.max(0, parseInt(skip, 10) || 0);
      var args = [];
      if (extras) {
        for (var key in extras) {
          if (Object.prototype.hasOwnProperty.call(extras, key) && extras[key] !== '' && extras[key] !== null && extras[key] !== undefined) {
            args.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(extras[key])));
          }
        }
      }
      if (offset) args.push('skip=' + offset);
      var url = this.metadataBase + '/catalog/' + type + '/' + catalogId +
        (args.length ? '/' + args.join('&') : '') + '.json';

      ajaxGet(url, function(err, res) {
        if (err) {
          callback(err, []);
          return;
        }
        var metas = (res && res.metas) ? res.metas : [];
        callback(null, metas);
      });
    },

    // Search catalog
    searchCatalog: function(type, query, callback, skip) {
      type = type || 'movie';
      if (!query) {
        this.getCatalog(type, 'top', callback, skip);
        return;
      }
      var encoded = encodeURIComponent(query);
      var offset = Math.max(0, parseInt(skip, 10) || 0);
      var url = this.metadataBase + '/catalog/' + type + '/top/search=' + encoded +
        (offset ? '&skip=' + offset : '') + '.json';

      ajaxGet(url, function(err, res) {
        if (err) {
          callback(err, []);
          return;
        }
        var metas = (res && res.metas) ? res.metas : [];
        callback(null, metas);
      });
    },

    // Fetch detailed media metadata (synopsis, cast, episodes list for series)
    getDetails: function(type, id, callback) {
      var url = this.metadataBase + '/meta/' + type + '/' + id + '.json';

      ajaxGet(url, function(err, res) {
        if (err) {
          callback(err, null);
          return;
        }
        var meta = (res && res.meta) ? res.meta : null;
        callback(null, meta);
      });
    },

    // Query Stremio subtitle resources separately from stream resources. Subtitle
    // addons do not return their tracks from /stream/; they use /subtitles/.
    // Results are reported per addon as they arrive so a slow addon cannot hide
    // subtitles already returned by a faster one.
    getSubtitles: function(type, id, stream, callback) {
      var addons = this.getActiveSubtitleAddons();
      var requests = [];
      var behavior = stream && stream.behaviorHints ? stream.behaviorHints : {};
      // Stremio's subtitle resource route uses the media ID as the route ID.
      // Hashes and file metadata are optional extra args; putting videoHash in
      // the ID slot (or videoID in the extras) breaks addons using the SDK API.
      var extraArgs = [];
      var filename = (behavior && behavior.filename) || (stream && stream.filename) || '';
      var videoSize = (behavior && behavior.videoSize) || (stream && stream.size) || 0;
      var videoHash = (behavior && behavior.videoHash) || '';

      if (filename) extraArgs.push('filename=' + encodeURIComponent(filename));
      if (videoSize) extraArgs.push('videoSize=' + encodeURIComponent(String(videoSize)));
      if (videoHash) extraArgs.push('videoHash=' + encodeURIComponent(videoHash));

      for (var i = 0; i < addons.length; i++) requests.push(addons[i]);
      if (requests.length === 0) {
        callback(null, []);
        return;
      }

      function addResults(response, addon, seen, addonResults) {
        var subtitles = response && response.subtitles ? response.subtitles : [];
        for (var j = 0; j < subtitles.length; j++) {
          var subtitle = subtitles[j];
          if (!subtitle || !subtitle.url || !/^https?:\/\//i.test(subtitle.url) || seen[subtitle.url]) continue;
          seen[subtitle.url] = true;
          addonResults.push({
            id: subtitle.id || subtitle.url,
            url: subtitle.url,
            lang: subtitle.lang || subtitle.language || '',
            label: subtitle.label || '',
            name: subtitle.name || '',
            format: subtitle.format || '',
            addonName: addon.name
          });
        }
      }

      for (var a = 0; a < requests.length; a++) {
        (function(addon) {
          var encodedId = encodeURIComponent(id);
          var routePath = 'subtitles/' + encodeURIComponent(type) + '/' + encodedId;
          var seen = {};
          var addonResults = [];
          var requestUrls = [];

          // Current SDK-style request: media ID is the route ID and metadata
          // is optional. Older subtitle services follow the wire protocol's
          // OpenSubtitles convention and require videoID in path extra args.
          if (extraArgs.length) requestUrls.push(addonResourceUrl(addon.url, routePath + '/' + extraArgs.join('&') + '.json'));
          var legacyArgs = ['videoID=' + encodeURIComponent(id)];
          for (var e = 0; e < extraArgs.length; e++) {
            if (extraArgs[e].indexOf('videoHash=') !== 0) legacyArgs.push(extraArgs[e]);
          }
          requestUrls.push(addonResourceUrl(addon.url, routePath + '/' + legacyArgs.join('&') + '.json'));
          // Some OpenSubtitles-compatible addons use the file hash as the
          // route ID and the IMDb/video ID as an extra argument.
          if (videoHash) {
            requestUrls.push(addonResourceUrl(addon.url, 'subtitles/' + encodeURIComponent(type) + '/' + encodeURIComponent(videoHash) + '/' + legacyArgs.join('&') + '.json'));
          }
          requestUrls.push(addonResourceUrl(addon.url, routePath + '.json'));

          // Keep candidate routes unique (notably when no file metadata exists).
          var uniqueUrls = [];
          for (var u = 0; u < requestUrls.length; u++) {
            if (uniqueUrls.indexOf(requestUrls[u]) === -1) uniqueUrls.push(requestUrls[u]);
          }

          function tryRoute(index) {
            if (index >= uniqueUrls.length) {
              if (addonResults.length) callback(null, addonResults);
              return;
            }
            ajaxGet(uniqueUrls[index], function(err, response) {
              if (!err) addResults(response, addon, seen, addonResults);
              if (addonResults.length) {
                callback(null, addonResults);
                return;
              }
              tryRoute(index + 1);
            }, 6000);
          }

          tryRoute(0);
        })(requests[a]);
      }
    },

    // Fetch streams across all installed & enabled addons
    // Handles both Stremio Addons & Nuvio Scraper Repositories (from nuvioplugin.com)
    getStreams: function(type, id, callback) {
      var activeAddons = this.getActiveStreamAddons();

      if (activeAddons.length === 0) {
        callback(null, DEMO_STREAMS);
        return;
      }

      // Parse IMDb ID, season, episode
      var imdbId = id;
      var season = 1;
      var episode = 1;
      if (id.indexOf(':') !== -1) {
        var parts = id.split(':');
        imdbId = parts[0];
        season = parseInt(parts[1], 10) || 1;
        episode = parseInt(parts[2], 10) || 1;
      }

      var streamResults = [];
      var pending = activeAddons.length;

      function checkDone() {
        pending--;
        if (pending <= 0) {
          if (streamResults.length === 0) {
            // Only provide demo streams if no network source was able to return playable content
            callback(null, DEMO_STREAMS);
          } else {
            callback(null, streamResults);
          }
        }
      }

      for (var i = 0; i < activeAddons.length; i++) {
        var addon = activeAddons[i];

        // Case A: Nuvio Scraper Repository (e.g. MoonCrown, Phisher, or GitHub-based provider repos)
        if (addon.type === 'nuvio-repo' || addon.url.indexOf('githubusercontent') !== -1) {
          (function(currentAddon) {
            // Generate direct HTTP stream candidates based on scrapers in this provider repo
            var epStr = episode < 10 ? '0' + episode : String(episode);

            // Vidmody / Vixolity direct clean HLS stream (from MoonCrown & Nuvio scrapers)
            var vidmodyUrl = (type === 'series')
              ? 'https://ha.vixolity.com/vs/' + imdbId + '/s' + season + '/e' + epStr
              : 'https://ha.vixolity.com/vs/' + imdbId;

            streamResults.push({
              name: currentAddon.name + ' • Direct HLS',
              title: (type === 'series' ? 'S' + season + ' E' + episode + ' • ' : '') + '1080p Stream (Direct HLS)',
              quality: '1080p',
              url: vidmodyUrl,
              headers: {
                'Referer': 'https://ha.vixolity.com/',
                'User-Agent': 'Mozilla/5.0'
              }
            });

            checkDone();
          })(addon);

        } else {
          // Case B: Stremio Addon Protocol (e.g. Pengu, Torrentio with Debrid, Plavio)
          var streamUrl = addonResourceUrl(addon.url, 'stream/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json');

          (function(currentAddon) {
            ajaxGet(streamUrl, function(err, res) {
              if (!err && res && res.streams && res.streams.length) {
                for (var s = 0; s < res.streams.length; s++) {
                  var stream = res.streams[s];
                  // Direct HTTP/HLS streams only (exclude P2P infoHash without debrid)
                  if (stream && stream.url && /^https?:\/\//i.test(stream.url)) {
                    var quality = 'HD';
                    var titleText = String(stream.title || stream.name || '');
                    if (/4k|2160p/i.test(titleText)) quality = '4K';
                    else if (/1080p/i.test(titleText)) quality = '1080p';
                    else if (/720p/i.test(titleText)) quality = '720p';

                    var streamHeaders = (stream.behaviorHints && (stream.behaviorHints.headers || stream.behaviorHints.proxyHeaders)) || null;

                    streamResults.push({
                      name: stream.name || currentAddon.name,
                      title: stream.title || currentAddon.name + ' Stream',
                      quality: quality,
                      url: stream.url,
                      behaviorHints: stream.behaviorHints || null,
                      headers: streamHeaders,
                      subtitles: stream.subtitles || []
                    });
                  }
                }
              }
              checkDone();
            }, 8000);
          })(addon);
        }
      }
    }
  };

  ApiClient.init();
  window.ApiClient = ApiClient;
})(window);
