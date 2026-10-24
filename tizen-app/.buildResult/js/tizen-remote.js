/* global window, document */
/**
 * Nuvio TV Lite - Tizen Remote & Spatial Keypad System
 * Registers Samsung TV media keys and coordinates D-pad navigation
 * Strict ES5 for Tizen 3.0 (Chromium 47)
 */
(function(window) {
  'use strict';

  var RemoteKeys = {
    KEY_ENTER: 13,
    KEY_LEFT: 37,
    KEY_UP: 38,
    KEY_RIGHT: 39,
    KEY_DOWN: 40,
    KEY_BACK: 10009, // Tizen Return Key
    KEY_ESCAPE: 27,  // PC browser fallback
    KEY_PLAY: 415,
    KEY_PAUSE: 19,
    KEY_PLAY_PAUSE: 10252,
    KEY_STOP: 413,
    KEY_FF: 417,
    KEY_RW: 412
  };

  var KeyHandler = {
    activeDelegate: null,

    init: function() {
      this._registerTizenKeys();
      this._bindGlobalEvents();
    },

    _registerTizenKeys: function() {
      var tvInput = window.tizen && window.tizen.tvinputdevice;
      if (tvInput && typeof tvInput.registerKey === 'function') {
        var keysToRegister = [
          'MediaPlay',
          'MediaPause',
          'MediaPlayPause',
          'MediaStop',
          'MediaFastForward',
          'MediaRewind',
          'Return',
          'Back'
        ];

        for (var i = 0; i < keysToRegister.length; i++) {
          try {
            tvInput.registerKey(keysToRegister[i]);
          } catch (e) {}
        }
      }
    },

    setDelegate: function(delegate) {
      this.activeDelegate = delegate;
    },

    _bindGlobalEvents: function() {
      var self = this;
      window.addEventListener('keydown', function(event) {
        var keyCode = event.keyCode || event.which;
        var handled = false;

        if (self.activeDelegate && typeof self.activeDelegate.onKeyDown === 'function') {
          handled = self.activeDelegate.onKeyDown(keyCode, event);
        }

        if (handled) {
          event.preventDefault();
          event.stopPropagation();
        }
      });
    }
  };

  window.RemoteKeys = RemoteKeys;
  window.KeyHandler = KeyHandler;
})(window);
