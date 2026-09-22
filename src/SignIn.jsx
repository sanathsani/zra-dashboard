/* The sign-in gate. Nothing in the dashboard renders until this passes, and
   the password is never compared here — api/auth.js checks it against the
   Users tab and hands back a signed token that /api/data then demands. */
import { useState } from "react";

export const SESSION_KEY = "skild.session.v1";

export function getSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    return s && s.token && s.exp > Date.now() ? s : null;
  } catch { return null; }
}

export function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
}

const CSS = `
.gate{min-height:100vh;display:grid;place-items:center;padding:24px;
  background:#eef1f6;background-image:linear-gradient(180deg,#f5f7fb,#e9edf3 60%)}
.gate__card{width:100%;max-width:400px;background:#fff;border:1px solid #dbe2ec;
  border-radius:16px;padding:30px 28px;box-shadow:0 2px 4px rgba(16,24,41,.05),0 12px 32px rgba(16,24,41,.08);
  font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#101829}
.gate__mark{width:44px;height:44px;border-radius:12px;background:#2a78d6;color:#fff;
  display:grid;place-items:center;font-weight:700;font-size:15px;letter-spacing:.02em}
.gate__card h1{margin:18px 0 4px;font-size:25px;font-weight:650;letter-spacing:-.02em}
.gate__card p{margin:0;color:#78849a;font-size:13px}
.gate__err{margin:16px 0 0;padding:10px 12px;border-radius:9px;background:#fdeceb;
  border:1px solid #f6cfcb;color:#a52620;font-size:12.5px;line-height:1.6;text-align:left}
.gate__f{margin-top:16px}
.gate__f label{display:block;font-size:11px;font-weight:650;letter-spacing:.04em;
  text-transform:uppercase;color:#46536b;margin-bottom:6px}
.gate__f input{width:100%;padding:10px 12px;font-size:14px;font-family:inherit;color:#101829;
  background:#f7f9fc;border:1px solid #dbe2ec;border-radius:9px;outline:none}
.gate__f input:focus{border-color:#2a78d6;background:#fff;box-shadow:0 0 0 3px rgba(42,120,214,.13)}
.gate__go{width:100%;margin-top:18px;padding:11px;font-size:14px;font-weight:600;font-family:inherit;
  color:#fff;background:#2a78d6;border:0;border-radius:9px;cursor:pointer}
.gate__go:disabled{opacity:.6;cursor:default}
.gate__foot{margin-top:20px;padding-top:16px;border-top:1px solid #e9edf3;
  font-size:11.5px;color:#78849a;line-height:1.65}
`;

export default function SignIn({ onDone }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!email.trim() || !password) return setErr("Enter both your email and your password.");
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.token) { setErr(j.error || "That email and password did not match."); return; }
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(j)); } catch { /* private mode */ }
      onDone(j);
    } catch (e2) {
      setErr("Could not reach the sign-in service: " + (e2?.message || String(e2)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="gate">
        <form className="gate__card" onSubmit={submit} autoComplete="off">
          <div className="gate__mark">SA</div>
          <h1>Skild AI</h1>
          <p>Customer Excellence Center · support operations</p>
          {err && <div className="gate__err">{err}</div>}
          <div className="gate__f">
            <label htmlFor="em">Work email</label>
            <input id="em" type="email" autoComplete="username" placeholder="you@awign.com"
                   value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="gate__f">
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" autoComplete="current-password" placeholder="••••••••"
                   value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <button className="gate__go" type="submit" disabled={busy}>
            {busy ? "Checking…" : "Sign in"}
          </button>
          <div className="gate__foot">
            Accounts live on the <b>Users</b> tab of the Shift Data Tracking sheet.
            Your password is checked on the server — it is never compared in this page,
            and the ticket feed stays closed until it passes.
          </div>
        </form>
      </div>
    </>
  );
}
