/* TizenBrew module service bootstrap. Keep syntax compatible with its Node VM. */
"use strict";

var fetch = require("node-fetch");
var repositoryBase = "https://cdn.jsdelivr.net/gh/gbman54/nuvio-lite@main/";
var files = [
  "tizen-app/services/tizen/enginefs-service.js",
  "tizen-app/services/tizen/plugin-service.js",
  "tizen-app/services/plugin-http.cjs",
  "tizen-app/services/custom-poster-config.cjs",
  "tizen-app/services/tizen/runtime/media-http.cjs",
  "tizen-app/services/tizen/runtime/playback-proxy-patch.cjs",
  "tizen-app/services/tizen/runtime/proxy-redirect-report-patch.cjs",
  "tizen-app/services/tizen/runtime/tx3g-subtitle-service.cjs",
  "tizen-app/services/tizen/runtime/tx3g-subtitle-parser.cjs",
  "tizen-app/services/tizen/runtime/embedded-text-subtitle-parser.cjs"
];
var sourceMap = {};
var runningServices = [];

function normalize(filename) {
  return String(filename).replace(/\\/g, "/").replace(/^\.\//, "");
}

function resolve(from, request) {
  var parts;
  var i;
  var stack = [];
  if (request.charAt(0) !== ".") return request;
  parts = normalize(from).split("/");
  parts.pop();
  parts = parts.concat(request.split("/"));
  for (i = 0; i < parts.length; i += 1) {
    if (!parts[i] || parts[i] === ".") continue;
    if (parts[i] === "..") stack.pop();
    else stack.push(parts[i]);
  }
  var result = stack.join("/");
  if (!/\.[a-z0-9]+$/i.test(result)) result += ".js";
  return result;
}

function load(filename) {
  filename = normalize(filename);
  if (!Object.prototype.hasOwnProperty.call(sourceMap, filename)) {
    throw new Error("TizenBrew service source not loaded: " + filename);
  }
  var module = { exports: {}, filename: filename, paths: [] };
  function localRequire(request) {
    if (request === "module") return FakeModule;
    if (request === "fs") return fakeFs;
    if (request.charAt(0) === ".") return load(resolve(filename, request));
    return require(request);
  }
  new Function("require", "module", "exports", "__dirname", "__filename", sourceMap[filename])(
    localRequire,
    module,
    module.exports,
    filename.substring(0, filename.lastIndexOf("/")),
    filename
  );
  return module.exports;
}

function FakeModule(filename, parent) {
  this.filename = filename;
  this.parent = parent;
  this.exports = {};
  this.paths = [];
}

FakeModule._nodeModulePaths = function() { return []; };
FakeModule.prototype._compile = function(source, filename) {
  var module = this;
  var normalized = normalize(filename);
  new Function("require", "module", "exports", "__dirname", "__filename", source)(
    function(request) {
      if (request === "module") return FakeModule;
      if (request === "fs") return fakeFs;
      if (request.charAt(0) === ".") return load(resolve(normalized, request));
      return require(request);
    },
    module,
    module.exports,
    normalized.substring(0, normalized.lastIndexOf("/")),
    normalized
  );
};

var fakeFs = {
  readFileSync: function(filename) {
    var key = normalize(filename);
    if (!Object.prototype.hasOwnProperty.call(sourceMap, key)) {
      throw new Error("TizenBrew service file unavailable: " + key);
    }
    return sourceMap[key];
  }
};

function start() {
  var downloads = files.map(function(path) {
    return fetch(repositoryBase + path).then(function(response) {
      if (!response.ok) throw new Error("HTTP " + response.status + " loading " + path);
      return response.text().then(function(source) {
        sourceMap[path] = source;
      });
    });
  });
  Promise.all(downloads).then(function() {
    var engine = load(files[0]);
    var plugin = load(files[1]);
    runningServices = [engine, plugin];
    engine.onStart();
    plugin.onStart();
    console.log("[Nuvio TizenBrew] EngineFS and plugin services started");
  }).catch(function(error) {
    console.error("[Nuvio TizenBrew] Service startup failed", error && error.stack ? error.stack : error);
  });
}

function stop() {
  var i;
  for (i = runningServices.length - 1; i >= 0; i -= 1) {
    try {
      if (runningServices[i].onStop) runningServices[i].onStop();
      else if (runningServices[i].onExit) runningServices[i].onExit();
    } catch (error) {
      console.warn("[Nuvio TizenBrew] Service shutdown warning", error);
    }
  }
  runningServices = [];
}

start();
module.exports.onStop = stop;
module.exports.onExit = stop;
