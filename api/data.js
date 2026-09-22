// Server-side proxy for the Skild AI dashboard feed.
//
// The browser calls /api/data. This function calls Apps Script and adds the
// key, so FEED_KEY never reaches the browser and never enters git. Set both
// values in Vercel → Settings → Environment Variables.
//
//   FEED_KEY  required — the token from feedMakeKey() on the Apps Script side
//   FEED_URL  optional — only if you ever create a NEW deployment URL
export default async function handler(req, res) {
  const APPS_URL =
    process.env.FEED_URL ||
    'https://script.google.com/macros/s/AKfycby_sOH1E-FVyAlt7g5TY9iPMNNVR4DZAsu56V17WNaksNNv1cJOUhEeNDh7CTDkRQ0x/exec';
  const KEY = process.env.FEED_KEY;

  if (!KEY) {
    return res.status(500).json({ error: 'FEED_KEY is not set in the environment.' });
  }

  try {
    const response = await fetch(`${APPS_URL}?key=${encodeURIComponent(KEY)}`, {
      redirect: 'follow',
    });
    const text = await response.text();
    // Apps Script sometimes prefixes the payload with a /*O_o*/ comment.
    const data = JSON.parse(text.replace(/^\/\*[^*]*\*\/\s*/, ''));

    if (!data.ok) {
      return res.status(data.code || 500).json({ error: data.error || 'Feed error' });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
