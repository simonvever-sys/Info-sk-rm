const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.resolve(__dirname, '..');

const state = {
  videoUrl: '',
  tickerText: 'Velkommen til Plushusen',
  tickerBg: '#d90429',
  tickerColor: '#ffffff',
  updatedAt: new Date().toISOString()
};
const sseClients = new Set();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, code, payload) {
  setCors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function isHexColor(value) {
  return typeof value === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

function sanitizeStatePatch(patch = {}) {
  const next = {};

  if (typeof patch.videoUrl === 'string') {
    next.videoUrl = patch.videoUrl.trim();
  }

  if (typeof patch.tickerText === 'string') {
    next.tickerText = patch.tickerText.trim();
  }

  if (typeof patch.tickerBg === 'string' && isHexColor(patch.tickerBg)) {
    next.tickerBg = patch.tickerBg.trim();
  }

  if (typeof patch.tickerColor === 'string' && isHexColor(patch.tickerColor)) {
    next.tickerColor = patch.tickerColor.trim();
  }

  return next;
}

function broadcastState() {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

function isDrUrl(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.replace(/^www\./, '');
    return host.endsWith('dr.dk') || host.endsWith('drtv.dk');
  } catch (err) {
    return false;
  }
}

function firstStreamUrlFromText(text) {
  if (!text || typeof text !== 'string') return null;

  const normalized = text.replace(/\\\//g, '/');
  const matches = normalized.match(/https?:\/\/[^"'<>\s]+/gi);
  if (!matches || matches.length === 0) return null;

  const filtered = matches.filter((candidate) => {
    const lower = candidate.toLowerCase();
    return (
      lower.includes('.m3u8') ||
      lower.includes('.mp4') ||
      lower.includes('manifest') ||
      lower.includes('master') ||
      lower.includes('hls')
    );
  });
  if (filtered.length === 0) return null;

  const preferred =
    filtered.find((m) => m.toLowerCase().includes('.m3u8')) ||
    filtered.find((m) => m.toLowerCase().includes('master')) ||
    filtered[0];
  return preferred || null;
}

function resolveWithYtDlp(inputUrl) {
  return new Promise((resolve) => {
    execFile(
      'yt-dlp',
      ['--no-warnings', '--get-url', inputUrl],
      { timeout: 12000 },
      (error, stdout) => {
        if (error || !stdout) {
          resolve(null);
          return;
        }

        const lines = stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length === 0) {
          resolve(null);
          return;
        }

        const preferred =
          lines.find((line) => line.toLowerCase().includes('.m3u8')) ||
          lines.find((line) => line.toLowerCase().includes('.mp4')) ||
          lines[0];
        resolve(preferred || null);
      }
    );
  });
}

async function resolveDrVideoUrl(inputUrl) {
  if (!isDrUrl(inputUrl)) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(inputUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari',
        Accept: 'text/html,application/xhtml+xml'
      }
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const found = firstStreamUrlFromText(html);
    if (found) {
      return found;
    }

    const ytdlpResolved = await resolveWithYtDlp(inputUrl);
    if (ytdlpResolved) {
      return ytdlpResolved;
    }

    return null;
  } catch (err) {
    const ytdlpResolved = await resolveWithYtDlp(inputUrl);
    return ytdlpResolved || null;
  } finally {
    clearTimeout(timeout);
  }
}

function getStaticFilePath(urlPathname) {
  if (urlPathname === '/tv' || urlPathname === '/tv/') {
    return path.join(ROOT, 'tv', 'index.html');
  }

  if (urlPathname === '/controller' || urlPathname === '/controller/') {
    return path.join(ROOT, 'controller', 'index.html');
  }

  const normalized = path.normalize(urlPathname).replace(/^\/+/, '');
  const staticPath = path.join(ROOT, normalized);

  if (!staticPath.startsWith(ROOT)) {
    return null;
  }

  return staticPath;
}

function serveStatic(req, res, urlPathname) {
  const filePath = getStaticFilePath(urlPathname);
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    setCors(res);
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(302, { Location: '/tv/' });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/control') {
    res.writeHead(302, { Location: '/controller/' });
    res.end();
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/state' || url.pathname === '/api/state')) {
    return sendJson(res, 200, state);
  }

  if (req.method === 'GET' && url.pathname === '/resolve-video') {
    const inputUrl = url.searchParams.get('url') || '';
    if (!inputUrl) {
      return sendJson(res, 400, { ok: false, error: 'Missing url query parameter' });
    }

    const resolvedUrl = await resolveDrVideoUrl(inputUrl);
    if (resolvedUrl) {
      return sendJson(res, 200, { ok: true, resolvedUrl, source: 'dr-resolver' });
    }

    return sendJson(res, 200, { ok: false, resolvedUrl: null, error: 'Could not resolve direct stream' });
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    setCors(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/update') {
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const patch = sanitizeStatePatch(body);

      Object.assign(state, patch, { updatedAt: new Date().toISOString() });
      broadcastState();

      return sendJson(res, 200, { ok: true, state });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
    }
  }

  if (req.method === 'GET') {
    return serveStatic(req, res, url.pathname);
  }

  res.writeHead(405);
  res.end('Method not allowed');
});

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`TV app: http://localhost:${PORT}/`);
  console.log(`Controller: http://localhost:${PORT}/control`);
});

setInterval(() => {
  for (const client of sseClients) {
    client.write(': ping\n\n');
  }
}, 20000);
