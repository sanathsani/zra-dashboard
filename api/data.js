// Server-side proxy for the Skild AI dashboard feed.
//
// The browser calls /api/data with the session token /api/auth issued. This
// function checks that token, then calls Apps Script with FEED_KEY, so the key
// never reaches the browser and never enters git. Without a valid token the
// feed is not fetched at all.
//
//   FEED_KEY  required — the token from feedMakeKey() on the Apps Script side
//   FEED_URL  required — the /exec URL of the Feed.gs deployment.
import { verify } from './auth.js';

// FEED_URL is required. There is deliberately no default: the URL that used to
// be hard-coded here belonged to the old ZRA_WebApp deployment on "Report of
// all sheets", which serves every ticket to anyone who has the link and knows
// nothing about accounts. Falling back to it silently pointed the whole site at
// the wrong spreadsheet and made a misconfiguration look like a bad password.


export default async function handler(req, res) {
  const APPS_URL = process.env.FEED_URL;
  const KEY = process.env.FEED_KEY;

  if (!APPS_URL) {
    return res.status(500).json({ error: 'FEED_URL is not set in the environment.' });
  }

  if (!KEY) {
    return res.status(500).json({ error: 'FEED_KEY is not set in the environment.' });
  }

  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const session = verify(token, KEY);
  if (!session) {
    return res.status(401).json({ error: 'Sign in to view this data.' });
  }

  // Apps Script serves the payload from its own cache and is normally quick,
  // but a cold cache has to rebuild it from three sheets. Wait up to 45s and
  // answer with JSON either way: when this function is killed by the platform
  // instead, the browser receives Vercel's HTML error page and every client
  // chokes on "Unexpected token '<'".
  const stop = new AbortController();
  const bell = setTimeout(() => stop.abort(), 45000);

  try {
    const response = await fetch(`${APPS_URL}?key=${encodeURIComponent(KEY)}`, {
      redirect: 'follow',
      signal: stop.signal,
    });
    const text = await response.text();
    // Apps Script sometimes prefixes the payload with a /*O_o*/ comment.
    const data = JSON.parse(text.replace(/^\/\*[^*]*\*\/\s*/, ''));

    if (!data.ok) {
      return res.status(data.code || 502).json({ error: data.error || 'Feed error' });
    }

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).json(data);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({
        error: 'The ticket feed took longer than 45 seconds. It is rebuilding its cache — try again in a moment.',
      });
    }
    res.status(502).json({ error: err.message });
  } finally {
    clearTimeout(bell);
  }
}
