import { useState } from "react";

export function Login({ onLogin }: { onLogin: (pw: string) => Promise<boolean> }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const ok = await onLogin(pw);
      if (!ok) setErr("Wrong password");
    } catch {
      setErr("Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center">
      <form className="login" onSubmit={submit}>
        <h1>
          <span className="dot" /> Antigravity Remote Plus
        </h1>
        <p className="muted">Enter password to continue</p>
        <input
          type="password"
          value={pw}
          autoFocus
          placeholder="Password"
          onChange={(e) => setPw(e.target.value)}
        />
        {err && <div className="err">{err}</div>}
        <button type="submit" disabled={busy || !pw}>
          {busy ? "…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
