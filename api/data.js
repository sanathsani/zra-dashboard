export default async function handler(req, res) {
  const APPS_URL = 'https://script.google.com/macros/s/AKfycby_sOH1E-FVyAlt7g5TY9iPMNNVR4DZAsu56V17WNaksNNv1cJOUhEeNDh7CTDkRQ0x/exec';
  
  try {
    const response = await fetch(APPS_URL, { redirect: 'follow' });
    const text = await response.text();
    const clean = text.replace(/^\/\*[^*]*\*\/\s*/, '');
    const data = JSON.parse(clean);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}