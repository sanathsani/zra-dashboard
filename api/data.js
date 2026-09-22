// Server-side proxy for the Skild AI dashboard feed.
//
// The browser calls /api/data with the session token /api/auth issued. This
// function checks that token, then calls Apps Script with FEED_KEY, so the key
// never reaches the browser and never enters git. Without a valid token the
// feed is not fetched at all.
//
//   FEED_KEY  required — the token from feedMakeKey() on the Apps Script side
//   FEED_URL  optional — only if you ever create a NEW deployment URL
import { verify } from './auth.js';

const DEFAULT_URL =
  'https://script.google.com/macros/s/AKfycby_sOH1E-FVyAlt7g5TY9iPMNNVR4DZAsu56V17WNaksNNv1cJOUhEeNDh7CTDkRQ0x/exec';

export default async function handler(req, res) {
  const APPS_URL = process.env.FEED_URL || DEFAULT_URL;
  const KEY = process.env.FEED_KEY;

  if (!KEY) {
    return res.status(500).json({ error: 'FEED_KEY is not set in the environment.' });
  }

  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const session = verify(token, KEY);
  if (!session) {
    return res.status(401).json({ error: 'Sign in to view this data.' });
  }

  try {
    const response = await fetch(`${APPS_URL}?key=${encodeURIComponent(KEY)}`, {
      redirect: 'follow',
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
    res.status(502).json({ error: err.message });
  }
}
