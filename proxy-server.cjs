const http = require('http');
const https = require('https');

const APPS_URL = 'https://script.google.com/macros/s/AKfycby_sOH1E-FVyAlt7g5TY9iPMNNVR4DZAsu56V17WNaksNNv1cJOUhEeNDh7CTDkRQ0x/exec';

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  function follow(url) {
    https.get(url, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        follow(r.headers.location);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        r.pipe(res);
      }
    }).on('error', (e) => {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    });
  }

  follow(APPS_URL);
}).listen(3001, () => console.log('Proxy running on http://localhost:3001'));