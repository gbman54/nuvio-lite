/**
 * Nuvio TV Lite - Local Development & Testing Server
 * 
 * Runs the EngineFS media proxy (port 2710) and static web server (port 8080)
 * so community streaming sources and HLS scrapers (ha.vixolity.com, Vidmody, etc.)
 * can be tested on PC browsers without CORS or header restrictions.
 */

var http = require('http');
var fs = require('fs');
var path = require('path');

var WEB_PORT = 8080;
var APP_DIR = path.join(__dirname, 'tizen-app');

// 1. Start EngineFS Media Streaming Proxy (Port 2710)
try {
  var engineFsSvc = require('./tizen-app/services/tizen/enginefs-service.js');
  if (engineFsSvc && typeof engineFsSvc.onStart === 'function') {
    engineFsSvc.onStart();
    console.log('[Dev Server] EngineFS Media Proxy initialized on port 2710');
  }
} catch (err) {
  console.warn('[Dev Server] Warning: Could not start EngineFS proxy:', err.message);
}

// 2. Start Plugin Network Service (Port 2711)
try {
  var pluginSvc = require('./tizen-app/services/tizen/plugin-service.js');
  if (pluginSvc && typeof pluginSvc.onStart === 'function') {
    pluginSvc.onStart();
    console.log('[Dev Server] Plugin Network Service initialized on port 2711');
  }
} catch (err) {
  console.warn('[Dev Server] Warning: Could not start Plugin service:', err.message);
}

// 3. Static File Server for tizen-app/
var MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8'
};

var server = http.createServer(function(req, res) {
  // Add CORS and no-cache headers to all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  var reqUrl = req.url.split('?')[0];
  if (reqUrl === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (reqUrl === '/') reqUrl = '/index.html';

  var safePath = path.normalize(reqUrl).replace(/^(\.\.[\/\\])+/, '');
  var filePath = path.join(APP_DIR, safePath);

  fs.stat(filePath, function(err, stats) {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + reqUrl);
      return;
    }

    var ext = path.extname(filePath).toLowerCase();
    var mime = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(WEB_PORT, '127.0.0.1', function() {
  console.log('====================================================');
  console.log('  Nuvio TV Lite - Local Dev Environment Active');
  console.log('  Web App URL:  http://127.0.0.1:' + WEB_PORT);
  console.log('  Media Proxy:  http://127.0.0.1:2710/proxy/');
  console.log('  Plugin Proxy: http://127.0.0.1:2711');
  console.log('====================================================');
  console.log('Tip: Open http://127.0.0.1:' + WEB_PORT + ' in your browser.');
});
