/* global window, document, KeyHandler, RemoteKeys, ApiClient, Player */
/**
 * Nuvio TV Lite - Main Application Controller
 * Spatial Navigation and UI Flow for Samsung Tizen 3.0 TV
 * Strict ES5 syntax
 */
(function(window) {
  'use strict';

  // Application view states
  var VIEW_GRID = 'grid';
  var VIEW_DETAILS = 'details';
  var VIEW_SOURCES = 'sources';
  var VIEW_PLAYER = 'player';
  var VIEW_ADDONS = 'addons';

  // Focus zones within VIEW_GRID
  var ZONE_TABS = 'tabs';
  var ZONE_FILTERS = 'filters';
  var ZONE_SEARCH = 'search';
  var ZONE_GRID = 'grid';
  var ZONE_PAGINATION = 'pagination';

  var App = {
    currentView: VIEW_GRID,
    currentTab: 'movie', // 'movie', 'series', 'search'
    currentZone: ZONE_GRID,

    // Data lists
    mediaList: [],
    currentMedia: null,
    currentEpisodes: [],
    streamList: [],

    // Focus indices
    tabIndex: 0,
    gridIndex: 0,
    catalogSkip: 0,
    catalogPageSize: 100,
    catalogHasNext: false,
    catalogLoading: false,
    catalogQuery: '',
    paginationIndex: 1,
    catalogFilters: { category: '', year: '', sort: 'Popular' },
    filterFocusIndex: 0,
    filterMenuOpen: false,
    filterMenuType: '',
    filterMenuOptions: [],
    filterMenuIndex: 0,
    detailsBtnIndex: 0,
    episodeIndex: 0,
    sourceIndex: 0,
    installedAddonIndex: 0,
    addonFocusIndex: 0,
    currentPlaybackMediaId: null,
    currentPlaybackMediaType: 'movie',
    playbackSubtitleRequestId: 0,
    playerBtnIndex: 1, // rw, play/pause, ff, audio, subtitles, subtitle delay, stop
    playerTrackPickerOpen: false,
    subtitleDelayPanelOpen: false,
    playerTrackPickerType: 'audio',
    playerTrackOptions: [],
    playerTrackIndex: 0,

    // OSD timer
    osdTimer: null,
    isOsdVisible: true,

    init: function() {
      var self = this;

      // Initialize hardware video player and remote keys
      Player.init('player-container', 'html5-video', 'embed-frame');
      KeyHandler.init();
      KeyHandler.setDelegate(this);

      // Set player event listeners
      Player.setEventListener({
        play: function() {
          self._updatePlayerPlayPauseBtn(true);
        },
        pause: function() {
          self._updatePlayerPlayPauseBtn(false);
        },
        timeupdate: function(data) {
          self._updatePlayerTimeline(data.current, data.duration);
        },
        trackschange: function() {
          self._updateTrackButtonLabels();
        },
        buffering: function(isBuffering) {
          var bufEl = document.getElementById('player-buffering');
          if (bufEl) bufEl.style.display = isBuffering ? 'block' : 'none';
        },
        ended: function() {
          self.closePlayer();
        },
        error: function(err) {
          if (self.currentView !== VIEW_PLAYER) return;
          console.error('[App Player Error]', err);
          var bufEl = document.getElementById('player-buffering');
          var textEl = document.getElementById('player-buffering-text');
          if (bufEl && textEl) {
            bufEl.style.display = 'block';
            textEl.textContent = 'Playback error or unsupported format.';
          }
        },
        unavailable: function(info) {
          self.returnToSourcePicker(info);
        }
      });

      // Bind mouse/click events for PC browser testing
      this._bindMouseEvents();
      this.updateSourceIndicator();

      ApiClient.onAddonsChanged = function() {
        self.renderInstalledAddons();
        self.updateSourceIndicator();
      };

      // Load initial catalog
      this.loadCatalog('movie');
    },

    _bindMouseEvents: function() {
      var self = this;
      var tabEls = document.querySelectorAll('.nav-tab');
      for (var i = 0; i < tabEls.length; i++) {
        (function(idx, el) {
          el.addEventListener('click', function() {
            self.tabIndex = idx;
            self.currentZone = ZONE_TABS;
            self.onTabSelect(el.getAttribute('data-tab'));
          });
        })(i, tabEls[i]);
      }

      var addSrcBtn = document.getElementById('btn-add-source');
      if (addSrcBtn) {
        addSrcBtn.addEventListener('click', function() {
          self.openAddonsManager();
        });
      }

      var previousPageButton = document.getElementById('catalog-page-previous');
      var nextPageButton = document.getElementById('catalog-page-next');
      if (previousPageButton) previousPageButton.addEventListener('click', function() {
        self.changeCatalogPage(-1);
      });
      if (nextPageButton) nextPageButton.addEventListener('click', function() {
        self.changeCatalogPage(1);
      });

      var filterButtons = document.querySelectorAll('.catalog-filter-button');
      for (var f = 0; f < filterButtons.length; f++) {
        (function(button) {
          button.addEventListener('click', function() {
            self.filterFocusIndex = parseInt(button.getAttribute('data-filter-index'), 10) || 0;
            self.openCatalogFilterMenu(button.getAttribute('data-filter'));
          });
        })(filterButtons[f]);
      }
      var filterMenu = document.getElementById('catalog-filter-menu');
      if (filterMenu) {
        filterMenu.addEventListener('click', function(event) {
          var target = event.target;
          while (target && target !== filterMenu && target.getAttribute('data-option-index') === null) target = target.parentNode;
          if (target && target !== filterMenu) self.selectCatalogFilterOption(parseInt(target.getAttribute('data-option-index'), 10) || 0);
        });
      }

      var btnPengu = document.getElementById('btn-install-pengu');
      if (btnPengu) {
        btnPengu.addEventListener('click', function() {
          ApiClient.addAddon('Pengu (Free HTTP)', 'https://pengu.uk');
          self.renderInstalledAddons();
          self.updateSourceIndicator();
        });
      }

      var btnTorrentio = document.getElementById('btn-install-torrentio');
      if (btnTorrentio) {
        btnTorrentio.addEventListener('click', function() {
          var url = window.prompt('Paste your configured Torrentio Debrid URL from https://torrentio.strem.fun/configure (e.g. https://torrentio.strem.fun/realdebrid=KEY):', 'https://torrentio.strem.fun');
          if (url) {
            ApiClient.addAddon('Torrentio Debrid', url);
            self.renderInstalledAddons();
            self.updateSourceIndicator();
          }
        });
      }

      var btnSaveCustom = document.getElementById('btn-save-custom-addon');
      if (btnSaveCustom) {
        btnSaveCustom.addEventListener('click', function() {
          var input = document.getElementById('input-custom-addon');
          if (input && input.value) {
            ApiClient.addAddon('', input.value.trim());
            input.value = '';
            self.renderInstalledAddons();
            self.updateSourceIndicator();
          }
        });
      }

      var customAddonInput = document.getElementById('input-custom-addon');
      if (customAddonInput) {
        customAddonInput.addEventListener('focus', function() {
          if (self.currentView !== VIEW_ADDONS) return;
          self.addonFocusIndex = 2;
          self.updateFocus();
        });
        customAddonInput.addEventListener('click', function() {
          if (self.currentView !== VIEW_ADDONS) return;
          self.addonFocusIndex = 2;
          self.updateFocus();
        });
      }

      var btnCloseAddons = document.getElementById('btn-close-addons');
      if (btnCloseAddons) {
        btnCloseAddons.addEventListener('click', function() {
          self.closeAddonsManager();
        });
      }

      var btnPlay = document.getElementById('btn-play');
      if (btnPlay) {
        btnPlay.addEventListener('click', function() {
          self.onPlayClicked();
        });
      }

      var btnCloseDetails = document.getElementById('btn-close-details');
      if (btnCloseDetails) {
        btnCloseDetails.addEventListener('click', function() {
          self.closeDetails();
        });
      }

      var btnCancelSrc = document.getElementById('btn-cancel-source');
      if (btnCancelSrc) {
        btnCancelSrc.addEventListener('click', function() {
          self.closeSourcePicker();
        });
      }

      // OSD buttons
      var osdPlay = document.getElementById('btn-osd-play');
      if (osdPlay) {
        osdPlay.addEventListener('click', function() {
          Player.togglePlayPause();
        });
      }
      var osdRw = document.getElementById('btn-osd-rw');
      if (osdRw) {
        osdRw.addEventListener('click', function() {
          Player.seek(-10);
        });
      }
      var osdFf = document.getElementById('btn-osd-ff');
      if (osdFf) {
        osdFf.addEventListener('click', function() {
          Player.seek(10);
        });
      }
      var osdStop = document.getElementById('btn-osd-stop');
      if (osdStop) {
        osdStop.addEventListener('click', function() {
          self.closePlayer();
        });
      }

      var osdAudio = document.getElementById('btn-osd-audio');
      if (osdAudio) {
        osdAudio.addEventListener('click', function() {
          self.openPlayerTrackPicker('audio');
        });
      }
      var osdSubtitles = document.getElementById('btn-osd-subtitles');
      if (osdSubtitles) {
        osdSubtitles.addEventListener('click', function() {
          self.openPlayerTrackPicker('subtitle');
        });
      }
      var osdSubtitleDelay = document.getElementById('btn-osd-subtitle-delay');
      if (osdSubtitleDelay) {
        osdSubtitleDelay.addEventListener('click', function() {
          self.openSubtitleDelayPanel();
        });
      }
      var subtitleDelaySlider = document.getElementById('subtitle-delay-slider');
      if (subtitleDelaySlider) {
        subtitleDelaySlider.addEventListener('input', function() {
          self.setSubtitleDelay(Number(subtitleDelaySlider.value));
        });
        subtitleDelaySlider.addEventListener('change', function() {
          self.setSubtitleDelay(Number(subtitleDelaySlider.value));
        });
      }
      var trackList = document.getElementById('player-track-list');
      if (trackList) {
        trackList.addEventListener('click', function(event) {
          var target = event.target;
          while (target && target !== trackList && target.getAttribute('data-track-index') === null) {
            target = target.parentNode;
          }
          if (target && target !== trackList) {
            self.playerTrackIndex = parseInt(target.getAttribute('data-track-index'), 10) || 0;
            self.selectPlayerTrackOption();
          }
        });
      }
    },

    loadCatalog: function(type, query, skip) {
      var self = this;
      var titleEl = document.getElementById('section-title');
      var loadingEl = document.getElementById('loading-indicator');
      var gridEl = document.getElementById('media-grid');

      this.catalogSkip = Math.max(0, parseInt(skip, 10) || 0);
      this.catalogQuery = query || '';
      this.catalogLoading = true;
      this.updateCatalogPagination();

      if (loadingEl) loadingEl.style.display = 'block';
      if (gridEl) gridEl.innerHTML = '';

      if (titleEl) {
        if (query) {
          titleEl.textContent = 'Search results for: "' + query + '"';
        } else {
          var mediaLabel = type === 'series' ? 'TV Series' : 'Movies';
          titleEl.textContent = this.catalogFilters.sort + ' ' + mediaLabel;
        }
      }
      this.updateCatalogFilterLabels();
      var requestSort = this.catalogFilters.sort;
      var catalogId = requestSort === 'New' ? 'year' : requestSort === 'Trending' ? 'imdbRating' : 'top';
      var catalogExtras = {};
      if (requestSort === 'New') catalogExtras.genre = this.catalogFilters.year || String(new Date().getFullYear());
      else if (this.catalogFilters.category) catalogExtras.genre = this.catalogFilters.category;

      function handleResults(err, metas) {
        self.catalogLoading = false;
        if (loadingEl) loadingEl.style.display = 'none';
        if (err) {
          if (titleEl) titleEl.textContent = 'Error loading media (Check connection)';
          self.catalogHasNext = false;
          self.updateCatalogPagination();
          return;
        }
        var rawMetas = metas || [];
        self.catalogHasNext = rawMetas.length >= self.catalogPageSize;
        self.mediaList = self._filterCatalogMetas(rawMetas, requestSort);
        self.renderGrid(self.mediaList);
        self.updateCatalogPagination();
      }

      if (query) {
        ApiClient.searchCatalog(type, query, handleResults, this.catalogSkip);
      } else {
        ApiClient.getCatalog(type, catalogId, handleResults, this.catalogSkip, catalogExtras);
      }
    },

    _filterCatalogMetas: function(metas, sort) {
      var filters = this.catalogFilters;
      var results = [];
      for (var i = 0; i < metas.length; i++) {
        var meta = metas[i] || {};
        if (filters.year && sort !== 'New' && String(meta.year || '') !== String(filters.year)) continue;
        if (filters.category && sort === 'New') {
          var genres = meta.genre || [];
          if (typeof genres === 'string') genres = genres.split(',');
          var found = false;
          for (var g = 0; g < genres.length; g++) {
            if (String(genres[g]).replace(/^\s+|\s+$/g, '').toLowerCase() === filters.category.toLowerCase()) found = true;
          }
          if (!found) continue;
        }
        results.push(meta);
      }
      return results;
    },

    updateCatalogFilterLabels: function() {
      var labels = {
        category: this.catalogFilters.category || 'All',
        year: this.catalogFilters.year || 'All years',
        sort: this.catalogFilters.sort
      };
      var buttons = document.querySelectorAll('.catalog-filter-button');
      for (var i = 0; i < buttons.length; i++) {
        var type = buttons[i].getAttribute('data-filter');
        var value = buttons[i].querySelector('span');
        if (value) value.textContent = labels[type] || '';
        buttons[i].setAttribute('data-filter-index', String(i));
        buttons[i].className = 'catalog-filter-button' + (this.currentZone === ZONE_FILTERS && i === this.filterFocusIndex ? ' focused' : '');
      }
    },

    openCatalogFilterMenu: function(type) {
      var menu = document.getElementById('catalog-filter-menu');
      if (!menu) return;
      var values = [];
      if (type === 'category') {
        values = ['All', 'Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'];
        if (this.currentTab === 'series') values.push('Reality-TV', 'Talk-Show', 'Game-Show');
      } else if (type === 'year') {
        values.push('All years');
        for (var year = new Date().getFullYear(); year >= 1920; year--) values.push(String(year));
      } else {
        values = ['Popular', 'New', 'Trending'];
      }
      this.filterMenuType = type;
      this.filterMenuOptions = values;
      var currentValue = type === 'category' ? (this.catalogFilters.category || 'All') : type === 'year' ? (this.catalogFilters.year || 'All years') : this.catalogFilters.sort;
      this.filterMenuIndex = Math.max(0, values.indexOf(currentValue));
      this.filterMenuOpen = true;
      this.currentZone = ZONE_FILTERS;
      this.renderCatalogFilterMenu();
    },

    renderCatalogFilterMenu: function() {
      var menu = document.getElementById('catalog-filter-menu');
      if (!menu) return;
      menu.innerHTML = '';
      menu.className = 'catalog-filter-menu open menu-' + this.filterMenuType;
      menu.style.display = this.filterMenuOpen ? 'block' : 'none';
      for (var i = 0; i < this.filterMenuOptions.length; i++) {
        var option = document.createElement('button');
        option.type = 'button';
        option.className = 'catalog-filter-option' + (i === this.filterMenuIndex ? ' focused' : '');
        option.setAttribute('data-option-index', String(i));
        option.textContent = this.filterMenuOptions[i];
        menu.appendChild(option);
      }
      var focused = menu.children[this.filterMenuIndex];
      if (focused) {
        var top = focused.offsetTop - menu.offsetTop;
        var bottom = top + focused.offsetHeight;
        if (top < menu.scrollTop) menu.scrollTop = top;
        else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
      }
    },

    closeCatalogFilterMenu: function() {
      this.filterMenuOpen = false;
      this.filterMenuType = '';
      var menu = document.getElementById('catalog-filter-menu');
      if (menu) menu.style.display = 'none';
      this.updateFocus();
    },

    selectCatalogFilterOption: function(index) {
      var value = this.filterMenuOptions[index];
      if (value === undefined) return;
      if (this.filterMenuType === 'category') this.catalogFilters.category = value === 'All' ? '' : value;
      else if (this.filterMenuType === 'year') this.catalogFilters.year = value === 'All years' ? '' : value;
      else this.catalogFilters.sort = value;
      this.filterMenuOpen = false;
      this.filterMenuType = '';
      var menu = document.getElementById('catalog-filter-menu');
      if (menu) menu.style.display = 'none';
      this.catalogSkip = 0;
      this.gridIndex = 0;
      this.currentZone = ZONE_FILTERS;
      var scrollContainer = document.getElementById('media-scroll');
      if (scrollContainer) scrollContainer.scrollTop = 0;
      this.loadCatalog(this.currentTab, '', 0);
      this.updateFocus();
    },

    updateCatalogPagination: function() {
      var previousButton = document.getElementById('catalog-page-previous');
      var nextButton = document.getElementById('catalog-page-next');
      var pageLabel = document.getElementById('catalog-page-label');
      var pagination = document.getElementById('catalog-pagination');
      var canGoPrevious = this.catalogSkip > 0 && !this.catalogLoading;
      var canGoNext = this.catalogHasNext && !this.catalogLoading;
      if (pagination) pagination.style.display = (canGoPrevious || canGoNext || (this.catalogLoading && this.catalogSkip > 0)) ? 'block' : 'none';
      if (previousButton) {
        previousButton.className = 'catalog-page-button' + (this.currentZone === ZONE_PAGINATION && this.paginationIndex === 0 ? ' focused' : '') + (!canGoPrevious ? ' disabled' : '');
      }
      if (nextButton) {
        nextButton.className = 'catalog-page-button' + (this.currentZone === ZONE_PAGINATION && this.paginationIndex === 1 ? ' focused' : '') + (!canGoNext ? ' disabled' : '');
      }
      if (pageLabel) pageLabel.textContent = 'Page ' + (Math.floor(this.catalogSkip / this.catalogPageSize) + 1);
    },

    changeCatalogPage: function(direction) {
      if (this.catalogLoading) return;
      var nextSkip = this.catalogSkip + (direction < 0 ? -this.catalogPageSize : this.catalogPageSize);
      if (nextSkip < 0 || (direction > 0 && !this.catalogHasNext)) return;
      this.gridIndex = 0;
      this.currentZone = ZONE_GRID;
      var scrollContainer = document.getElementById('media-scroll');
      if (scrollContainer) scrollContainer.scrollTop = 0;
      this.loadCatalog(this.currentTab === 'search' ? 'movie' : this.currentTab, this.catalogQuery, nextSkip);
      this.updateFocus();
    },

    renderGrid: function(items) {
      var gridEl = document.getElementById('media-grid');
      if (!gridEl) return;
      gridEl.innerHTML = '';

      if (!items || items.length === 0) {
        gridEl.innerHTML = '<div style="color:#94a3b8; font-size:22px; padding:40px;">No media found.</div>';
        return;
      }

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var card = document.createElement('div');
        card.className = 'media-card' + (i === 0 && this.currentZone === ZONE_GRID ? ' focused' : '');
        card.setAttribute('data-index', i);

        var posterUrl = item.poster || 'assets/brand/app_logo_wordmark.png';
        var rating = item.imdbRating ? '★ ' + item.imdbRating : (item.type === 'series' ? 'TV' : 'MOVIE');
        var year = item.releaseInfo || (item.year ? String(item.year) : '');

        var html = '' +
          '<div class="media-poster-box">' +
            '<img class="media-poster-img" src="' + posterUrl + '" onerror="this.src=\'assets/brand/app_logo_wordmark.png\'" />' +
            '<div class="media-badge">' + rating + '</div>' +
          '</div>' +
          '<div class="media-info">' +
            '<div class="media-title">' + (item.name || 'Untitled') + '</div>' +
            '<div class="media-meta">' + year + (item.genres && item.genres[0] ? ' • ' + item.genres[0] : '') + '</div>' +
          '</div>';

        card.innerHTML = html;

        (function(index, el) {
          el.addEventListener('click', function() {
            App.gridIndex = index;
            App.currentZone = ZONE_GRID;
            App.updateFocus();
            App.openDetails(App.mediaList[index]);
          });
        })(i, card);

        gridEl.appendChild(card);
      }

      this.gridIndex = 0;
      this.updateFocus();
    },

    openDetails: function(summaryItem) {
      if (!summaryItem) return;
      var self = this;
      this.currentView = VIEW_DETAILS;
      this.detailsBtnIndex = 0;

      var modal = document.getElementById('details-modal');
      var titleEl = document.getElementById('details-title');
      var synopsisEl = document.getElementById('details-synopsis');
      var posterEl = document.getElementById('details-poster');
      var backdropEl = document.getElementById('details-backdrop');
      var yearEl = document.getElementById('details-year');
      var ratingEl = document.getElementById('details-rating');
      var genreEl = document.getElementById('details-genre');
      var epSection = document.getElementById('episodes-section');

      if (modal) modal.style.display = 'block';

      // Initial populate from catalog summary
      if (titleEl) titleEl.textContent = summaryItem.name || '';
      if (synopsisEl) synopsisEl.textContent = summaryItem.description || 'Loading detailed synopsis...';
      if (posterEl) posterEl.src = summaryItem.poster || '';
      if (backdropEl) backdropEl.src = summaryItem.background || summaryItem.poster || '';
      if (yearEl) yearEl.textContent = summaryItem.releaseInfo || '';
      if (ratingEl) ratingEl.textContent = summaryItem.imdbRating ? '★ ' + summaryItem.imdbRating : '★ 8.0';
      if (genreEl) genreEl.textContent = summaryItem.genres ? summaryItem.genres.join(', ') : (summaryItem.type || 'Movie');

      if (epSection) epSection.style.display = 'none';

      // Fetch full details
      ApiClient.getDetails(summaryItem.type, summaryItem.id, function(err, fullMeta) {
        if (!err && fullMeta) {
          self.currentMedia = fullMeta;
          if (synopsisEl) synopsisEl.textContent = fullMeta.description || fullMeta.overview || '';
          if (fullMeta.background && backdropEl) backdropEl.src = fullMeta.background;

          // If series, populate episodes
          if (fullMeta.videos && fullMeta.videos.length) {
            self.currentEpisodes = fullMeta.videos;
            self.renderEpisodes(fullMeta.videos);
            if (epSection) epSection.style.display = 'block';
          }
        } else {
          self.currentMedia = summaryItem;
        }
      });

      this.updateFocus();
    },

    renderEpisodes: function(episodes) {
      var listEl = document.getElementById('episodes-list');
      if (!listEl) return;
      listEl.innerHTML = '';

      for (var i = 0; i < episodes.length; i++) {
        var ep = episodes[i];
        var item = document.createElement('div');
        item.className = 'episode-card' + (i === 0 ? ' focused' : '');
        item.setAttribute('data-index', i);

        var sNum = ep.season != null ? ep.season : 1;
        var eNum = ep.episode != null ? ep.episode : (i + 1);
        var label = 'S' + (sNum < 10 ? '0' : '') + sNum + ' E' + (eNum < 10 ? '0' : '') + eNum;

        item.innerHTML = '' +
          '<div class="episode-num">' + label + '</div>' +
          '<div class="episode-name">' + (ep.title || 'Episode ' + eNum) + '</div>';

        (function(index, epData) {
          item.addEventListener('click', function() {
            App.episodeIndex = index;
            App.fetchAndPickStreams(epData.id || (App.currentMedia.id + ':' + epData.season + ':' + epData.episode), epData.title);
          });
        })(i, ep);

        listEl.appendChild(item);
      }
    },

    closeDetails: function() {
      var modal = document.getElementById('details-modal');
      if (modal) modal.style.display = 'none';
      this.currentView = VIEW_GRID;
      this.currentZone = ZONE_GRID;
      this.updateFocus();
    },

    onPlayClicked: function() {
      if (!this.currentMedia) return;
      if (this.currentEpisodes && this.currentEpisodes.length) {
        var ep = this.currentEpisodes[this.episodeIndex] || this.currentEpisodes[0];
        var epId = ep.id || (this.currentMedia.id + ':' + ep.season + ':' + ep.episode);
        this.fetchAndPickStreams(epId, (this.currentMedia.name || '') + ' - ' + (ep.title || 'Episode'));
      } else {
        this.fetchAndPickStreams(this.currentMedia.id, this.currentMedia.name);
      }
    },

    fetchAndPickStreams: function(mediaId, title) {
      var self = this;
      var modal = document.getElementById('source-modal');
      var listEl = document.getElementById('source-list');

      if (modal) modal.style.display = 'block';
      if (listEl) listEl.innerHTML = '<div style="color:#94a3b8; padding:20px;">Fetching direct streams...</div>';

      this.currentView = VIEW_SOURCES;
      this.sourceIndex = 0;

      var mediaType = (this.currentMedia && this.currentMedia.type) || 'movie';
      this.currentPlaybackMediaId = mediaId;
      this.currentPlaybackMediaType = mediaType;

      ApiClient.getStreams(mediaType, mediaId, function(err, streams) {
        self.streamList = streams || [];
        self.renderSourceList(self.streamList, title);
      });
    },

    renderSourceList: function(streams, mediaTitle) {
      var listEl = document.getElementById('source-list');
      if (!listEl) return;
      listEl.innerHTML = '';

      if (!streams || streams.length === 0) {
        listEl.innerHTML = '<div style="color:#ef4444; padding:20px;">No direct HTTP streams available for this item.</div>';
        return;
      }

      for (var i = 0; i < streams.length; i++) {
        var s = streams[i];
        var item = document.createElement('div');
        item.className = 'source-item' + (i === 0 ? ' focused' : '');
        item.setAttribute('data-index', i);

        var qualityBadge = s.quality
          ? '<span style="float:right; background:#38bdf8; color:#0c0f17; font-size:12px; font-weight:800; padding:2px 8px; border-radius:4px;">' + s.quality + '</span>'
          : '';

        item.innerHTML = '' +
          '<div class="source-item-name">' + qualityBadge + (s.name || 'Stream #' + (i + 1)) + '</div>' +
          '<div class="source-item-detail">' + (s.title || s.url) + '</div>';

        (function(streamObj, streamIndex) {
          item.addEventListener('click', function() {
            App.sourceIndex = streamIndex;
            App.launchPlayer(streamObj, mediaTitle);
          });
        })(s, i);

        listEl.appendChild(item);
      }

      this.sourceIndex = 0;
      this.updateFocus();
    },

    closeSourcePicker: function() {
      var modal = document.getElementById('source-modal');
      if (modal) modal.style.display = 'none';
      this.currentView = VIEW_DETAILS;
      this.updateFocus();
    },

    launchPlayer: function(streamOrUrl, title) {
      var srcModal = document.getElementById('source-modal');
      if (srcModal) srcModal.style.display = 'none';

      var detailsModal = document.getElementById('details-modal');
      if (detailsModal) detailsModal.style.display = 'none';

      this.currentView = VIEW_PLAYER;
      this.playerBtnIndex = 1; // Play/Pause focused
      this.playerTrackPickerOpen = false;
      this.subtitleDelayPanelOpen = false;
      var trackPicker = document.getElementById('player-track-picker');
      if (trackPicker) trackPicker.style.display = 'none';
      var delayPanel = document.getElementById('subtitle-delay-panel');
      if (delayPanel) delayPanel.style.display = 'none';
      var sourceSubtitle = document.getElementById('source-subtitle');
      if (sourceSubtitle) sourceSubtitle.textContent = 'Direct HTTP/HLS streams compatible with Tizen 3.0 AVPlay';

      var titleEl = document.getElementById('player-title');
      if (titleEl) titleEl.textContent = title || 'Playing Stream';

      Player.play(streamOrUrl, title);
      this._renderSubtitleDelayValue();

      var subtitleRequestId = ++this.playbackSubtitleRequestId;
      if (this.currentPlaybackMediaId) {
        ApiClient.getSubtitles(this.currentPlaybackMediaType, this.currentPlaybackMediaId, streamOrUrl, function(err, subtitles) {
          if (err || subtitleRequestId !== App.playbackSubtitleRequestId || App.currentView !== VIEW_PLAYER) return;
          Player.addExternalSubtitleTracks(subtitles);
          App._updateTrackButtonLabels();
          if (App.playerTrackPickerOpen && App.playerTrackPickerType === 'subtitle') {
            App.playerTrackOptions = Player.getTracks('subtitle');
            App.renderPlayerTrackPicker();
          }
        });
      }

      var engineTag = document.getElementById('player-engine-tag');
      if (engineTag) {
        if (Player.isEmbedMode) {
          engineTag.textContent = 'Web Embed Player';
        } else if (Player.engine === 'avplay') {
          engineTag.textContent = 'Tizen AVPlay (HW)';
        } else if (Player.hlsInstance) {
          engineTag.textContent = 'HLS Stream';
        } else {
          engineTag.textContent = 'HTML5 Video';
        }
      }
    },

    closePlayer: function() {
      this.playbackSubtitleRequestId++;
      this.playerTrackPickerOpen = false;
      Player.stop();
      var container = document.getElementById('player-container');
      if (container) container.style.display = 'none';

      this.currentView = VIEW_DETAILS;
      var detailsModal = document.getElementById('details-modal');
      if (detailsModal) detailsModal.style.display = 'block';

      this.updateFocus();
    },

    returnToSourcePicker: function(info) {
      this.playbackSubtitleRequestId++;
      Player.stop();
      var playerContainer = document.getElementById('player-container');
      var sourceModal = document.getElementById('source-modal');
      var detailsModal = document.getElementById('details-modal');
      var sourceSubtitle = document.getElementById('source-subtitle');
      if (playerContainer) playerContainer.style.display = 'none';
      if (detailsModal) detailsModal.style.display = 'none';

      if (!this.streamList || !this.streamList.length) {
        this.closePlayer();
        return;
      }

      this.currentView = VIEW_SOURCES;
      if (sourceModal) sourceModal.style.display = 'block';
      if (sourceSubtitle) {
        sourceSubtitle.textContent = info && Number(info.status) === 404
          ? 'This source returned 404. Choose another stream or go back.'
          : 'This source could not be opened. Choose another stream or go back.';
      }
      if (this.sourceIndex < this.streamList.length - 1) this.sourceIndex++;
      else this.sourceIndex = 0;
      this.updateFocus();
    },

    openAddonsManager: function() {
      this.currentView = VIEW_ADDONS;
      this.installedAddonIndex = 0;
      this.addonFocusIndex = 0;
      var modal = document.getElementById('addons-modal');
      if (modal) modal.style.display = 'block';
      this.renderInstalledAddons();
      this.updateSourceIndicator();
      this.updateFocus();
    },

    closeAddonsManager: function() {
      var modal = document.getElementById('addons-modal');
      var customInput = document.getElementById('input-custom-addon');
      if (customInput && document.activeElement === customInput) customInput.blur();
      if (modal) modal.style.display = 'none';
      this.currentView = VIEW_GRID;
      this.updateFocus();
    },

    updateSourceIndicator: function() {
      var indicator = document.getElementById('source-indicator');
      if (indicator) {
        var active = ApiClient.getActiveStreamAddons().length;
        indicator.textContent = 'Active Sources (' + active + ')';
      }
    },

    renderInstalledAddons: function() {
      var self = this;
      var listEl = document.getElementById('installed-addons-list');
      if (!listEl) return;
      listEl.innerHTML = '';

      var addons = ApiClient.getInstalledAddons();
      if (addons.length === 0) {
        listEl.innerHTML = '<div style="color:#94a3b8; padding:20px;">No addons installed yet. Choose a preset above or add a manifest URL.</div>';
        if (this.currentView === VIEW_ADDONS) this.updateFocus();
        return;
      }

      if (this.installedAddonIndex >= addons.length) this.installedAddonIndex = addons.length - 1;
      if (this.installedAddonIndex < 0) this.installedAddonIndex = 0;

      for (var i = 0; i < addons.length; i++) {
        var a = addons[i];
        var item = document.createElement('div');
        item.className = 'installed-item clearfix' + (i === this.installedAddonIndex ? ' focused' : '');
        item.setAttribute('data-index', String(i));

        var statusBadge = a.enabled
          ? '<span class="badge-active">ACTIVE</span>'
          : '<span class="badge-disabled">DISABLED</span>';

        item.innerHTML = '' +
          '<div class="installed-item-info">' +
            '<div class="installed-item-name">' + a.name + '</div>' +
            '<div class="installed-item-url">' + a.url + '</div>' +
          '</div>' +
          '<div class="installed-item-actions">' +
            statusBadge +
            (a.configurationRequired ? '<span class="badge-disabled">CONFIGURE</span>' : '') +
            '<span class="btn-remove-addon" data-id="' + a.id + '">Remove</span>' +
          '</div>';

        (function(addonId, addonIndex) {
          var btnRem = item.querySelector('.btn-remove-addon');
          if (btnRem) {
            btnRem.addEventListener('click', function(e) {
              e.stopPropagation();
              self.installedAddonIndex = addonIndex;
              self.addonFocusIndex = 4 + addonIndex;
              ApiClient.removeAddon(addonId);
              self.renderInstalledAddons();
              self.updateSourceIndicator();
            });
          }
          item.addEventListener('click', function() {
            self.installedAddonIndex = addonIndex;
            self.addonFocusIndex = 4 + addonIndex;
            ApiClient.toggleAddon(addonId);
            self.renderInstalledAddons();
            self.updateSourceIndicator();
          });
        })(a.id, i);

        listEl.appendChild(item);
      }
      if (this.currentView === VIEW_ADDONS) this.updateFocus();
    },

    onTabSelect: function(tab) {
      this.currentTab = tab;
      var tabs = document.querySelectorAll('.nav-tab');
      for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i].getAttribute('data-tab');
        if (t === tab) {
          tabs[i].className = 'nav-tab active' + (this.currentZone === ZONE_TABS ? ' focused' : '');
        } else {
          tabs[i].className = 'nav-tab';
        }
      }

      var searchBox = document.getElementById('search-container');
      var filterBar = document.getElementById('catalog-filter-bar');
      if (tab === 'search') {
        if (searchBox) searchBox.style.display = 'block';
        if (filterBar) filterBar.style.display = 'none';
        var mediaScroll = document.getElementById('media-scroll');
        if (mediaScroll) mediaScroll.style.height = '720px';
        var input = document.getElementById('search-input');
        if (input) input.focus();
        this.currentZone = ZONE_SEARCH;
      } else {
        if (searchBox) searchBox.style.display = 'none';
        if (filterBar) filterBar.style.display = 'block';
        var catalogScroll = document.getElementById('media-scroll');
        if (catalogScroll) catalogScroll.style.height = '750px';
        this.loadCatalog(tab);
      }
    },

    // =========================================================================
    // Spatial Navigation and Focus Engine
    // =========================================================================
    updateFocus: function() {
      if (this.currentView === VIEW_GRID) {
        // Clear all grid / tab focus states
        var tabs = document.querySelectorAll('.nav-tab');
        for (var t = 0; t < tabs.length; t++) {
          var isActive = tabs[t].getAttribute('data-tab') === this.currentTab;
          tabs[t].className = 'nav-tab' + (isActive ? ' active' : '') + (this.currentZone === ZONE_TABS && t === this.tabIndex ? ' focused' : '');
        }

        var addSrcBtn = document.getElementById('btn-add-source');
        if (addSrcBtn) {
          addSrcBtn.className = 'btn-custom-stream' + (this.currentZone === ZONE_TABS && this.tabIndex === 3 ? ' focused' : '');
        }

        var searchInput = document.getElementById('search-input');
        if (searchInput) {
          searchInput.className = 'search-input-box' + (this.currentZone === ZONE_SEARCH ? ' focused' : '');
        }

        this.updateCatalogFilterLabels();

        var cards = document.querySelectorAll('.media-card');
        for (var c = 0; c < cards.length; c++) {
          if (this.currentZone === ZONE_GRID && c === this.gridIndex) {
            cards[c].className = 'media-card focused';
            this._scrollCardIntoView(cards[c], c);
          } else {
            cards[c].className = 'media-card';
          }
        }
        this.updateCatalogPagination();
      } else if (this.currentView === VIEW_DETAILS) {
        var btnPlay = document.getElementById('btn-play');
        var btnClose = document.getElementById('btn-close-details');
        if (btnPlay) {
          btnPlay.className = 'action-btn' + (this.detailsBtnIndex === 0 ? ' focused' : '');
        }
        if (btnClose) {
          btnClose.className = 'action-btn action-btn-secondary' + (this.detailsBtnIndex === 1 ? ' focused' : '');
        }

        var epCards = document.querySelectorAll('.episode-card');
        for (var e = 0; e < epCards.length; e++) {
          epCards[e].className = 'episode-card' + (this.detailsBtnIndex === 2 && e === this.episodeIndex ? ' focused' : '');
        }
      } else if (this.currentView === VIEW_SOURCES) {
        var items = document.querySelectorAll('.source-item');
        for (var s = 0; s < items.length; s++) {
          items[s].className = 'source-item' + (s === this.sourceIndex ? ' focused' : '');
        }
        var sourceList = document.getElementById('source-list');
        if (sourceList && items[this.sourceIndex]) {
          var focusedSource = items[this.sourceIndex];
          var sourceTop = focusedSource.offsetTop - sourceList.offsetTop;
          var sourceBottom = sourceTop + focusedSource.offsetHeight;
          if (sourceTop < sourceList.scrollTop) sourceList.scrollTop = sourceTop;
          else if (sourceBottom > sourceList.scrollTop + sourceList.clientHeight) {
            sourceList.scrollTop = sourceBottom - sourceList.clientHeight;
          }
        }
      } else if (this.currentView === VIEW_PLAYER) {
        var osdBtns = [
          document.getElementById('btn-osd-rw'),
          document.getElementById('btn-osd-play'),
          document.getElementById('btn-osd-ff'),
          document.getElementById('btn-osd-audio'),
          document.getElementById('btn-osd-subtitles'),
          document.getElementById('btn-osd-subtitle-delay'),
          document.getElementById('btn-osd-stop')
        ];
        for (var b = 0; b < osdBtns.length; b++) {
          if (osdBtns[b]) {
            osdBtns[b].className = 'player-osd-btn' + (b === this.playerBtnIndex ? ' focused' : '');
          }
        }
        var trackOptions = document.querySelectorAll('.player-track-option');
        for (var t = 0; t < trackOptions.length; t++) {
          trackOptions[t].className = 'player-track-option' +
            (this.playerTrackPickerOpen && t === this.playerTrackIndex ? ' focused' : '') +
            (this.playerTrackOptions[t] && this.playerTrackOptions[t].selected ? ' selected' : '');
        }
      } else if (this.currentView === VIEW_ADDONS) {
        var addonControls = this._getAddonFocusableControls();
        var addonsModal = document.getElementById('addons-modal');
        var customAddonInput = document.getElementById('input-custom-addon');
        if (this.addonFocusIndex < 0) this.addonFocusIndex = 0;
        if (this.addonFocusIndex >= addonControls.length) this.addonFocusIndex = addonControls.length - 1;
        for (var addonIdx = 0; addonIdx < addonControls.length; addonIdx++) {
          var addonControl = addonControls[addonIdx];
          var isFocused = addonIdx === this.addonFocusIndex;
          if (addonControl.id === 'input-custom-addon') {
            addonControl.className = 'custom-addon-input' + (isFocused ? ' focused' : '');
          } else if (addonControl.className.indexOf('installed-item') !== -1) {
            addonControl.className = 'installed-item clearfix' + (isFocused ? ' focused' : '');
          } else if (addonControl.id === 'btn-install-torrentio' || addonControl.id === 'btn-close-addons') {
            addonControl.className = 'action-btn action-btn-secondary' + (isFocused ? ' focused' : '');
          } else {
            addonControl.className = 'action-btn' + (isFocused ? ' focused' : '');
          }
        }
        if (customAddonInput) {
          if (addonControls[this.addonFocusIndex] === customAddonInput && document.activeElement !== customAddonInput) {
            customAddonInput.focus();
          } else if (addonControls[this.addonFocusIndex] !== customAddonInput && document.activeElement === customAddonInput) {
            customAddonInput.blur();
          }
        }
        var focusedAddonControl = addonControls[this.addonFocusIndex];
        if (addonsModal && focusedAddonControl) {
          var focusTop = focusedAddonControl.offsetTop;
          var focusBottom = focusTop + focusedAddonControl.offsetHeight;
          if (focusTop < addonsModal.scrollTop + 50) addonsModal.scrollTop = Math.max(0, focusTop - 80);
          else if (focusBottom > addonsModal.scrollTop + addonsModal.clientHeight - 50) {
            addonsModal.scrollTop = focusBottom - addonsModal.clientHeight + 100;
          }
        }
      }
    },

    _getAddonFocusableControls: function() {
      var controls = [
        document.getElementById('btn-install-pengu'),
        document.getElementById('btn-install-torrentio'),
        document.getElementById('input-custom-addon'),
        document.getElementById('btn-save-custom-addon')
      ];
      var installedItems = document.querySelectorAll('.installed-item');
      var i;
      for (i = 0; i < installedItems.length; i++) controls.push(installedItems[i]);
      controls.push(document.getElementById('btn-close-addons'));
      return controls.filter(function(control) { return Boolean(control); });
    },

    _scrollCardIntoView: function(cardEl, index) {
      var scrollContainer = document.getElementById('media-scroll');
      if (!scrollContainer || !cardEl) return;
      var cardTop = cardEl.offsetTop;
      var cardBottom = cardTop + cardEl.offsetHeight;
      if (cardTop < scrollContainer.scrollTop) {
        scrollContainer.scrollTop = cardTop;
      } else if (cardBottom > scrollContainer.scrollTop + scrollContainer.clientHeight) {
        scrollContainer.scrollTop = cardBottom - scrollContainer.clientHeight;
      }
    },

    showOsd: function() {
      var osd = document.getElementById('player-osd');
      if (!osd) return;
      osd.style.opacity = '1';
      this.isOsdVisible = true;

      var self = this;
      if (this.osdTimer) clearTimeout(this.osdTimer);
      this.osdTimer = setTimeout(function() {
        if (Player.isPlayingState && self.currentView === VIEW_PLAYER && !self.playerTrackPickerOpen) {
          osd.style.opacity = '0';
          self.isOsdVisible = false;
        }
      }, 4000);
    },

    _updatePlayerPlayPauseBtn: function(isPlaying) {
      var btn = document.getElementById('btn-osd-play');
      if (btn) {
        btn.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
      }
    },

    _updateTrackButtonLabels: function() {
      var audioButton = document.getElementById('btn-osd-audio');
      var subtitleButton = document.getElementById('btn-osd-subtitles');
      var audioTracks = Player.getTracks('audio');
      var subtitleTracks = Player.getTracks('subtitle');
      if (audioButton) audioButton.textContent = '♪ Audio (' + Math.max(0, audioTracks.length - (Player.hlsInstance ? 1 : 0)) + ')';
      if (subtitleButton) subtitleButton.textContent = 'CC Subtitles (' + Math.max(0, subtitleTracks.length - 1) + ')';
    },

    openPlayerTrackPicker: function(type) {
      this.playerTrackPickerType = type;
      this.playerTrackOptions = Player.getTracks(type);
      this.playerTrackIndex = 0;
      for (var i = 0; i < this.playerTrackOptions.length; i++) {
        if (this.playerTrackOptions[i].selected) {
          this.playerTrackIndex = i;
          break;
        }
      }
      this.playerTrackPickerOpen = true;
      var picker = document.getElementById('player-track-picker');
      var title = document.getElementById('player-track-title');
      if (picker) picker.style.display = 'block';
      if (title) title.textContent = type === 'audio' ? 'Choose audio language' : 'Choose subtitles';
      this.showOsd();
      this.renderPlayerTrackPicker();
    },

    closePlayerTrackPicker: function() {
      this.playerTrackPickerOpen = false;
      var picker = document.getElementById('player-track-picker');
      if (picker) picker.style.display = 'none';
      this.updateFocus();
    },

    openSubtitleDelayPanel: function() {
      this.subtitleDelayPanelOpen = true;
      var panel = document.getElementById('subtitle-delay-panel');
      if (panel) panel.style.display = 'block';
      this._renderSubtitleDelayValue();
      this.showOsd();
    },

    closeSubtitleDelayPanel: function() {
      this.subtitleDelayPanelOpen = false;
      var panel = document.getElementById('subtitle-delay-panel');
      if (panel) panel.style.display = 'none';
      this.updateFocus();
    },

    setSubtitleDelay: function(delayMs) {
      Player.setSubtitleDelay(delayMs);
      this._renderSubtitleDelayValue();
    },

    _renderSubtitleDelayValue: function() {
      var value = Number(Player.subtitleDelayMs) || 0;
      var label = document.getElementById('subtitle-delay-value');
      var slider = document.getElementById('subtitle-delay-slider');
      var seconds = Math.abs(value / 1000).toFixed(2);
      var formatted = value > 0 ? '+' + seconds + ' s' : value < 0 ? '-' + seconds + ' s' : '0.00 s';
      if (label) label.textContent = formatted;
      if (slider) slider.value = String(value);
    },

    renderPlayerTrackPicker: function() {
      var list = document.getElementById('player-track-list');
      if (!list) return;
      while (list.firstChild) list.removeChild(list.firstChild);

      if (!this.playerTrackOptions.length) {
        var empty = document.createElement('div');
        empty.className = 'player-track-empty';
        empty.textContent = this.playerTrackPickerType === 'audio'
          ? 'No alternate audio tracks are available for this stream.'
          : 'No subtitle tracks are available for this stream.';
        list.appendChild(empty);
        return;
      }

      for (var i = 0; i < this.playerTrackOptions.length; i++) {
        var option = document.createElement('div');
        var track = this.playerTrackOptions[i];
        option.className = 'player-track-option' +
          (i === this.playerTrackIndex ? ' focused' : '') +
          (track.selected ? ' selected' : '');
        option.textContent = track.label;
        option.setAttribute('data-track-index', String(i));
        list.appendChild(option);
      }
      var focusedOption = list.children[this.playerTrackIndex];
      if (focusedOption) {
        var optionTop = focusedOption.offsetTop - list.offsetTop;
        var optionBottom = optionTop + focusedOption.offsetHeight;
        if (optionTop < list.scrollTop) list.scrollTop = optionTop;
        else if (optionBottom > list.scrollTop + list.clientHeight) {
          list.scrollTop = optionBottom - list.clientHeight;
        }
      }
    },

    selectPlayerTrackOption: function() {
      var option = this.playerTrackOptions[this.playerTrackIndex];
      if (!option) return;
      if (Player.selectTrack(this.playerTrackPickerType, option.value)) {
        this.closePlayerTrackPicker();
        this._updateTrackButtonLabels();
      }
    },

    _updatePlayerTimeline: function(currentMs, durationMs) {
      var timeLabel = document.getElementById('player-time');
      var progressBar = document.getElementById('player-progress');

      function formatTime(ms) {
        if (!ms || ms < 0) ms = 0;
        var totalSec = Math.floor(ms / 1000);
        var min = Math.floor(totalSec / 60);
        var sec = totalSec % 60;
        return (min < 10 ? '0' : '') + min + ':' + (sec < 10 ? '0' : '') + sec;
      }

      if (timeLabel) {
        timeLabel.textContent = formatTime(currentMs) + ' / ' + formatTime(durationMs);
      }

      if (progressBar && durationMs > 0) {
        var pct = (currentMs / durationMs) * 100;
        progressBar.style.width = Math.min(100, Math.max(0, pct)) + '%';
      }
    },

    // =========================================================================
    // Key Event Dispatcher
    // =========================================================================
    onKeyDown: function(keyCode, event) {
      var K = RemoteKeys;

      // Global Back / Return Key Handler
      if (keyCode === K.KEY_BACK || keyCode === K.KEY_ESCAPE) {
      if (this.currentView === VIEW_GRID && this.filterMenuOpen) {
          this.closeCatalogFilterMenu();
          return true;
        } else if (this.currentView === VIEW_ADDONS) {
          this.closeAddonsManager();
          return true;
        } else if (this.currentView === VIEW_PLAYER) {
          if (this.playerTrackPickerOpen) this.closePlayerTrackPicker();
          else if (this.subtitleDelayPanelOpen) this.closeSubtitleDelayPanel();
          else this.closePlayer();
          return true;
        } else if (this.currentView === VIEW_SOURCES) {
          this.closeSourcePicker();
          return true;
        } else if (this.currentView === VIEW_DETAILS) {
          this.closeDetails();
          return true;
        }
        return false;
      }

      // View-specific navigation
      if (this.currentView === VIEW_GRID) {
        return this._handleGridNavigation(keyCode);
      } else if (this.currentView === VIEW_DETAILS) {
        return this._handleDetailsNavigation(keyCode);
      } else if (this.currentView === VIEW_SOURCES) {
        return this._handleSourcesNavigation(keyCode);
      } else if (this.currentView === VIEW_PLAYER) {
        return this._handlePlayerNavigation(keyCode);
      } else if (this.currentView === VIEW_ADDONS) {
        return this._handleAddonsNavigation(keyCode);
      }

      return false;
    },

    _handleAddonsNavigation: function(keyCode) {
      var K = RemoteKeys;
      var input = document.getElementById('input-custom-addon');
      var controls = this._getAddonFocusableControls();
      if (keyCode === K.KEY_UP || keyCode === K.KEY_DOWN || keyCode === K.KEY_LEFT || keyCode === K.KEY_RIGHT) {
        if (input && document.activeElement === input &&
            (keyCode === K.KEY_LEFT || keyCode === K.KEY_RIGHT)) return false;
        if (keyCode === K.KEY_UP || keyCode === K.KEY_LEFT) {
          if (this.addonFocusIndex > 0) this.addonFocusIndex--;
        } else if (this.addonFocusIndex < controls.length - 1) {
          this.addonFocusIndex++;
        }
        this.updateFocus();
        return true;
      }
      if (keyCode === K.KEY_ENTER && controls[this.addonFocusIndex]) {
        if (controls[this.addonFocusIndex] === input) {
          input.focus();
          return false;
        }
        controls[this.addonFocusIndex].click();
        return true;
      }
      return false;
    },

    _handleGridNavigation: function(keyCode) {
      var K = RemoteKeys;

      if (this.filterMenuOpen) {
        if (keyCode === K.KEY_UP) {
          if (this.filterMenuIndex > 0) this.filterMenuIndex--;
          this.renderCatalogFilterMenu();
          return true;
        } else if (keyCode === K.KEY_DOWN) {
          if (this.filterMenuIndex < this.filterMenuOptions.length - 1) this.filterMenuIndex++;
          this.renderCatalogFilterMenu();
          return true;
        } else if (keyCode === K.KEY_ENTER) {
          this.selectCatalogFilterOption(this.filterMenuIndex);
          return true;
        } else if (keyCode === K.KEY_LEFT || keyCode === K.KEY_RIGHT) {
          this.closeCatalogFilterMenu();
          return true;
        }
      }

      if (this.currentZone === ZONE_TABS) {
        if (keyCode === K.KEY_RIGHT) {
          if (this.tabIndex < 3) this.tabIndex++;
          this.updateFocus();
          return true;
        } else if (keyCode === K.KEY_LEFT) {
          if (this.tabIndex > 0) this.tabIndex--;
          this.updateFocus();
          return true;
        } else if (keyCode === K.KEY_DOWN) {
          if (this.currentTab === 'search') {
            this.currentZone = ZONE_SEARCH;
          } else {
            this.currentZone = ZONE_FILTERS;
            this.filterFocusIndex = 0;
          }
          this.updateFocus();
          return true;
        } else if (keyCode === K.KEY_ENTER) {
          if (this.tabIndex === 0) this.onTabSelect('movie');
          else if (this.tabIndex === 1) this.onTabSelect('series');
          else if (this.tabIndex === 2) this.onTabSelect('search');
          else if (this.tabIndex === 3) this.openAddonsManager();
          return true;
        }
      } else if (this.currentZone === ZONE_SEARCH) {
        if (keyCode === K.KEY_UP) {
          this.currentZone = ZONE_TABS;
          this.tabIndex = 2;
          this.updateFocus();
          return true;
        } else if (keyCode === K.KEY_DOWN) {
          if (this.mediaList.length > 0) {
            this.currentZone = ZONE_GRID;
            this.gridIndex = 0;
            this.updateFocus();
          }
          return true;
        } else if (keyCode === K.KEY_ENTER) {
          var input = document.getElementById('search-input');
          if (input && input.value) {
            this.loadCatalog('movie', input.value.trim());
          }
          return true;
        }
      } else if (this.currentZone === ZONE_FILTERS) {
        if (keyCode === K.KEY_LEFT || keyCode === K.KEY_RIGHT) {
          this.filterFocusIndex = keyCode === K.KEY_LEFT ? Math.max(0, this.filterFocusIndex - 1) : Math.min(2, this.filterFocusIndex + 1);
          this.updateFocus();
          return true;
        } else if (keyCode === K.KEY_UP) {
          this.currentZone = ZONE_TABS;
          this.tabIndex = this.currentTab === 'series' ? 1 : 0;
          this.updateFocus();
          return true;
        } else if (keyCode === K.KEY_DOWN) {
          this.currentZone = ZONE_GRID;
          this.gridIndex = 0;
          this.updateFocus();
          return true;
        } else if (keyCode === K.KEY_ENTER) {
          var filterType = this.filterFocusIndex === 0 ? 'category' : this.filterFocusIndex === 1 ? 'year' : 'sort';
          this.openCatalogFilterMenu(filterType);
          return true;
        }
      } else if (this.currentZone === ZONE_GRID) {
        var total = this.mediaList.length;
        if (keyCode === K.KEY_RIGHT) {
          if (this.gridIndex < total - 1) this.gridIndex++;
          this.updateFocus();
          return true;
        } else if (keyCode === K.KEY_LEFT) {
          if (this.gridIndex > 0) this.gridIndex--;
          this.updateFocus();
          return true;
        } else if (keyCode === K.KEY_DOWN) {
          if (this.gridIndex + 5 < total) {
            this.gridIndex += 5;
            this.updateFocus();
          } else if (this.catalogSkip > 0 || this.catalogHasNext) {
            this.currentZone = ZONE_PAGINATION;
            this.paginationIndex = this.catalogHasNext ? 1 : 0;
            this.updateFocus();
          }
          return true;
        } else if (keyCode === K.KEY_UP) {
          if (this.gridIndex >= 5) {
            this.gridIndex -= 5;
            this.updateFocus();
          } else {
            // Return to top navigation
            this.currentZone = (this.currentTab === 'search') ? ZONE_SEARCH : ZONE_FILTERS;
            this.updateFocus();
          }
          return true;
        } else if (keyCode === K.KEY_ENTER) {
          if (this.mediaList[this.gridIndex]) this.openDetails(this.mediaList[this.gridIndex]);
          return true;
        }
      } else if (this.currentZone === ZONE_PAGINATION) {
        if (keyCode === K.KEY_LEFT || keyCode === K.KEY_RIGHT) {
          var candidatePageButton = this.paginationIndex === 0 ? 1 : 0;
          if (candidatePageButton === 0 && this.catalogSkip === 0) candidatePageButton = 1;
          if (candidatePageButton === 1 && !this.catalogHasNext) candidatePageButton = 0;
          this.paginationIndex = candidatePageButton;
          this.updateFocus();
          return true;
        } else if (keyCode === K.KEY_UP) {
          this.currentZone = ZONE_GRID;
          this.gridIndex = Math.max(0, this.mediaList.length - 1);
          this.updateFocus();
          return true;
        } else if (keyCode === K.KEY_DOWN) {
          this.currentZone = this.currentTab === 'search' ? ZONE_SEARCH : ZONE_FILTERS;
          this.tabIndex = this.currentTab === 'series' ? 1 : this.currentTab === 'search' ? 2 : 0;
          this.updateFocus();
          return true;
        } else if (keyCode === K.KEY_ENTER) {
          this.changeCatalogPage(this.paginationIndex === 0 ? -1 : 1);
          return true;
        }
      }

      return false;
    },

    _handleDetailsNavigation: function(keyCode) {
      var K = RemoteKeys;

      if (keyCode === K.KEY_RIGHT) {
        if (this.detailsBtnIndex === 0) {
          this.detailsBtnIndex = 1;
        } else if (this.detailsBtnIndex === 2 && this.currentEpisodes && this.episodeIndex < this.currentEpisodes.length - 1) {
          this.episodeIndex++;
        }
        this.updateFocus();
        return true;
      } else if (keyCode === K.KEY_LEFT) {
        if (this.detailsBtnIndex === 1) {
          this.detailsBtnIndex = 0;
        } else if (this.detailsBtnIndex === 2 && this.episodeIndex > 0) {
          this.episodeIndex--;
        }
        this.updateFocus();
        return true;
      } else if (keyCode === K.KEY_DOWN) {
        if (this.detailsBtnIndex < 2 && this.currentEpisodes && this.currentEpisodes.length > 0) {
          this.detailsBtnIndex = 2;
          this.updateFocus();
        }
        return true;
      } else if (keyCode === K.KEY_UP) {
        if (this.detailsBtnIndex === 2) {
          this.detailsBtnIndex = 0;
          this.updateFocus();
        }
        return true;
      } else if (keyCode === K.KEY_ENTER) {
        if (this.detailsBtnIndex === 0) {
          this.onPlayClicked();
        } else if (this.detailsBtnIndex === 1) {
          this.closeDetails();
        } else if (this.detailsBtnIndex === 2) {
          var ep = this.currentEpisodes[this.episodeIndex];
          if (ep) {
            var epId = ep.id || (this.currentMedia.id + ':' + ep.season + ':' + ep.episode);
            this.fetchAndPickStreams(epId, (this.currentMedia.name || '') + ' - ' + (ep.title || 'Episode'));
          }
        }
        return true;
      }

      return false;
    },

    _handleSourcesNavigation: function(keyCode) {
      var K = RemoteKeys;
      var total = this.streamList.length;

      if (keyCode === K.KEY_DOWN) {
        if (this.sourceIndex < total - 1) {
          this.sourceIndex++;
          this.updateFocus();
        }
        return true;
      } else if (keyCode === K.KEY_UP) {
        if (this.sourceIndex > 0) {
          this.sourceIndex--;
          this.updateFocus();
        }
        return true;
      } else if (keyCode === K.KEY_ENTER) {
        if (this.streamList[this.sourceIndex]) {
          var stream = this.streamList[this.sourceIndex];
          var title = (this.currentMedia && this.currentMedia.name) || 'Stream';
          this.launchPlayer(stream, title);
        }
        return true;
      }

      return false;
    },

    _handlePlayerNavigation: function(keyCode) {
      var K = RemoteKeys;
      this.showOsd();

      if (this.subtitleDelayPanelOpen) {
        if (keyCode === K.KEY_LEFT) {
          this.setSubtitleDelay(Player.subtitleDelayMs - 250);
        } else if (keyCode === K.KEY_RIGHT) {
          this.setSubtitleDelay(Player.subtitleDelayMs + 250);
        } else if (keyCode === K.KEY_DOWN) {
          this.setSubtitleDelay(Player.subtitleDelayMs - 1000);
        } else if (keyCode === K.KEY_UP) {
          this.setSubtitleDelay(Player.subtitleDelayMs + 1000);
        } else if (keyCode === K.KEY_ENTER) {
          this.closeSubtitleDelayPanel();
        }
        return true;
      }

      if (this.playerTrackPickerOpen) {
        if (keyCode === K.KEY_DOWN) {
          if (this.playerTrackIndex < this.playerTrackOptions.length - 1) this.playerTrackIndex++;
          this.renderPlayerTrackPicker();
          return true;
        } else if (keyCode === K.KEY_UP) {
          if (this.playerTrackIndex > 0) this.playerTrackIndex--;
          this.renderPlayerTrackPicker();
          return true;
        } else if (keyCode === K.KEY_ENTER) {
          this.selectPlayerTrackOption();
          return true;
        }
        return true;
      }

      // Hardware TV Media Keys
      if (keyCode === K.KEY_PLAY) {
        Player.resume();
        return true;
      } else if (keyCode === K.KEY_PAUSE) {
        Player.pause();
        return true;
      } else if (keyCode === K.KEY_PLAY_PAUSE) {
        Player.togglePlayPause();
        return true;
      } else if (keyCode === K.KEY_STOP) {
        this.closePlayer();
        return true;
      } else if (keyCode === K.KEY_FF) {
        Player.seek(10);
        return true;
      } else if (keyCode === K.KEY_RW) {
        Player.seek(-10);
        return true;
      }

      // D-Pad Navigation on OSD
      if (keyCode === K.KEY_RIGHT) {
        if (this.playerBtnIndex < 6) {
          this.playerBtnIndex++;
          this.updateFocus();
        } else {
          Player.seek(10);
        }
        return true;
      } else if (keyCode === K.KEY_LEFT) {
        if (this.playerBtnIndex > 0) {
          this.playerBtnIndex--;
          this.updateFocus();
        } else {
          Player.seek(-10);
        }
        return true;
      } else if (keyCode === K.KEY_ENTER) {
        if (this.playerBtnIndex === 0) Player.seek(-10);
        else if (this.playerBtnIndex === 1) Player.togglePlayPause();
        else if (this.playerBtnIndex === 2) Player.seek(10);
        else if (this.playerBtnIndex === 3) this.openPlayerTrackPicker('audio');
        else if (this.playerBtnIndex === 4) this.openPlayerTrackPicker('subtitle');
        else if (this.playerBtnIndex === 5) this.openSubtitleDelayPanel();
        else if (this.playerBtnIndex === 6) this.closePlayer();
        return true;
      }

      return false;
    }
  };

  window.App = App;

  // Boot on DOM ready
  document.addEventListener('DOMContentLoaded', function() {
    App.init();
  });
})(window);
