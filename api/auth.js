// Sign-in for the Skild AI dashboard.
//
// The browser posts an email and a password here. This function asks Apps
// Script for the Users tab, verifies the password against the stored salted
// hash, and returns a short-lived signed token. The password is never compared
// in the browser, and FEED_KEY never leaves the server.
//
//   FEED_KEY  required — the token from feedMakeKey() on the Apps Script side.
//             Doubles as the secret the session token is signed with.
//   FEED_URL  optional — only if you ever create a NEW deployment URL.
import crypto from 'node:crypto';

const DEFAULT_URL =
  'https://script.google.com/macros/s/AKfycby_sOH1E-FVyAlt7g5TY9iPMNNVR4DZAsu56V17WNaksNNv1cJOUhEeNDh7CTDkRQ0x/exec';

const SESSION_HOURS = 12;

export function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verify(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const want = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (mac.length !== want.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.exp > Date.now() ? payload : null;
  } catch { return null; }
}

const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }

  const KEY = process.env.FEED_KEY;
  if (!KEY) return res.status(500).json({ error: 'FEED_KEY is not set in the environment.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Enter both your email and your password.' });

  const APPS_URL = process.env.FEED_URL || DEFAULT_URL;

  let users;
  try {
    const r = await fetch(`${APPS_URL}?mode=users&key=${encodeURIComponent(KEY)}`, { redirect: 'follow' });
    const text = await r.text();
    const j = JSON.parse(text.replace(/^\/\*[^*]*\*\/\s*/, ''));
    if (!j.ok) return res.status(502).json({ error: j.error || 'The user list could not be read.' });
    users = j.users || [];
  } catch (err) {
    return res.status(502).json({ error: 'Could not reach the sign-in service: ' + err.message });
  }

  const user = users.find(u => String(u.email || '').trim().toLowerCase() === email);

  // Hash even when the account is unknown, so a missing account and a wrong
  // password take the same time and look the same from outside.
  const salt = (user && user.salt) || 'no-such-account';
  const given = sha256(salt + password);
  const stored = (user && user.hash) || sha256(salt + crypto.randomUUID());

  const ok = user &&
    given.length === stored.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(stored));

  if (!ok) return res.status(401).json({ error: 'That email and password did not match.' });

  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const token = sign({ email, exp }, KEY);

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(200).json({
    token, exp,
    user: { email, name: user.name || email, role: user.role || 'Agent' },
  });
}
