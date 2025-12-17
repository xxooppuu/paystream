const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const SHOPS_FILE = path.join(__dirname, 'shops.json');
const BUYERS_FILE = path.join(__dirname, 'buyers.json');
const ORDERS_FILE = path.join(__dirname, 'orders.json');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

const server = http.createServer((req, res) => {
  // 1. 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent');

  // 2. 处理预检请求 (OPTIONS)
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 3. 处理本地存储请求 /shops
  if (req.url === '/shops') {
    handleFileRequest(req, res, SHOPS_FILE);
    return;
  }

  // 4. 处理本地存储请求 /buyers
  if (req.url === '/buyers') {
    handleFileRequest(req, res, BUYERS_FILE);
    return;
  }

  // 5. 处理本地存储请求 /orders
  if (req.url === '/orders') {
    handleFileRequest(req, res, ORDERS_FILE);
    return;
  }

  // 6. 处理本地存储请求 /settings
  if (req.url === '/settings') {
    handleFileRequest(req, res, SETTINGS_FILE);
    return;
  }

  // 7. 处理代理请求 /proxy
  if (req.url === '/proxy' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { targetUrl, method = 'GET', headers = {}, body: reqBody, cookie, csrfToken } = JSON.parse(body);

        if (!targetUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing targetUrl' }));
          return;
        }

        console.log(`[Proxy] ${method} -> ${targetUrl}`);

        const parsedUrl = url.parse(targetUrl);

        const proxyOptions = {
          hostname: parsedUrl.hostname,
          path: parsedUrl.path,
          method: method,
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Host': parsedUrl.hostname,
            'Referer': 'https://m.zhuanzhuan.com/', // Default Referer
            ...headers // Allow overriding headers
          }
        };

        // Inject Cookie
        if (cookie) {
          proxyOptions.headers['Cookie'] = cookie;
        }

        // Inject CSRF Token
        if (csrfToken) {
          proxyOptions.headers['Csrf-Token'] = csrfToken;
        }

        const proxyReq = https.request(proxyOptions, (proxyRes) => {
          let proxyData = '';
          proxyRes.on('data', chunk => proxyData += chunk);
          proxyRes.on('end', () => {
            res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
            res.end(proxyData);
          });
        });

        proxyReq.on('error', (e) => {
          console.error(`[Proxy Error] ${e.message}`);
          res.writeHead(500, JSON.stringify({ error: e.message }));
          res.end();
        });

        // Write body if POST/PUT
        if (reqBody && (method === 'POST' || method === 'PUT')) {
          // Check if content-type is json or form
          if (typeof reqBody === 'string') {
            proxyReq.write(reqBody);
          } else {
            proxyReq.write(JSON.stringify(reqBody));
          }
        }

        proxyReq.end();

      } catch (error) {
        console.error(error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

function handleFileRequest(req, res, filePath) {
  if (req.method === 'GET') {
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data || '[]');
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      }
    } catch (error) {
      console.error('[Storage Error]', error);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to read storage' }));
    }
  } else if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        JSON.parse(body); // Validate JSON
        fs.writeFileSync(filePath, body);
        console.log(`[Storage] Saved to ${path.basename(filePath)}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        console.error('[Storage Error]', error);
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON or write failed' }));
      }
    });
  }
}

server.listen(PORT, () => {
  console.log(`\x1b[32m[Proxy Server] Running on http://localhost:${PORT}\x1b[0m`);
  console.log(`[Storage] Shops: ${SHOPS_FILE}`);
  console.log(`[Storage] Buyers: ${BUYERS_FILE}`);
  console.log(`[Storage] Orders: ${ORDERS_FILE}`);
  console.log(`[Storage] Settings: ${SETTINGS_FILE}`);
});