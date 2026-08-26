import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "./Icon";

interface Status {
  branch: string;
  files: { path: string; index: string; work: string }[];
  ahead: number;
  behind: number;
}

export function GitPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [commits, setCommits] = useState<
    { hash: string; author: string; date: string; subject: string }[]
  >([]);
  const [branches, setBranches] = useState<{ current: string; all: string[] }>({
    current: "",
    all: [],
  });
  const [commitMsg, setCommitMsg] = useState("");
  const [diff, setDiff] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, l, b] = await Promise.all([
        api.gitStatus(),
        api.gitLog(20),
        api.gitBranches(),
      ]);
      setStatus(s);
      setCommits(l.commits ?? []);
      setBranches(b.branches ?? { current: "", all: [] });
    } catch {
      /* not a repo, or no workspace */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(true);
    setLog("");
    try {
      const r = await fn();
      setLog(r.message || (r.ok ? "OK" : "Failed"));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const showDiff = async (file?: string) => {
    const r = await api.gitDiff(file);
    setDiff(r.diff || "(no changes)");
  };

  return (
    <div className="git">
      <div className="git-main">
        <div className="git-head">
          <Icon name="branch" size={15} className="muted" />
          <strong>{status?.branch || "—"}</strong>
          {status && (status.ahead > 0 || status.behind > 0) && (
            <span className="ahead-behind">
              {status.ahead > 0 && (
                <span className="ab"><Icon name="arrowUp" size={12} />{status.ahead}</span>
              )}
              {status.behind > 0 && (
                <span className="ab"><Icon name="arrowDown" size={12} />{status.behind}</span>
              )}
            </span>
          )}
          <div className="spacer" />
          <button className="ghost icon-btn" onClick={refresh} disabled={busy} title="Refresh">
            <Icon name="refresh" size={15} />
          </button>
        </div>

        <div className="git-actions">
          <button className="ghost icon-btn" onClick={() => run(() => api.gitPull())} disabled={busy}>
            <Icon name="pull" size={15} /> <span>Pull</span>
          </button>
          <button
            className="ghost icon-btn"
            onClick={() => run(() => api.gitPush(undefined, status?.ahead === 0))}
            disabled={busy}
          >
            <Icon name="push" size={15} /> <span>Push</span>
          </button>
          <button className="ghost icon-btn" onClick={() => run(() => api.gitAdd("."))} disabled={busy}>
            <Icon name="plus" size={15} /> <span>Stage all</span>
          </button>
          <button className="ghost icon-btn" onClick={() => showDiff()} disabled={busy}>
            <Icon name="eye" size={15} /> <span>View diff</span>
          </button>
        </div>

        <div className="commit-row">
          <input
            placeholder="Commit message"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
          />
          <button
            className="primary icon-btn"
            disabled={busy || !commitMsg.trim()}
            onClick={async () => {
              await run(() => api.gitCommit(commitMsg));
              setCommitMsg("");
            }}
          >
            <Icon name="commit" size={15} /> <span>Commit</span>
          </button>
        </div>

        <div className="branch-row">
          <select
            value={branches.current}
            onChange={(e) => run(() => api.gitCheckout(e.target.value))}
            disabled={busy}
          >
            {branches.all.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <button
            className="ghost icon-btn"
            disabled={busy}
            onClick={async () => {
              const name = prompt("New branch name:");
              if (name) await run(() => api.gitCreateBranch(name));
            }}
          >
            <Icon name="branch" size={15} /> <span>Branch</span>
          </button>
          <button
            className="ghost icon-btn"
            disabled={busy}
            onClick={async () => {
              const title = prompt("PR title:");
              if (!title) return;
              const body = prompt("PR body:") ?? "";
              await run(() => api.prCreate(title, body));
            }}
          >
            <Icon name="git" size={15} /> <span>Create PR</span>
          </button>
        </div>

        <h4>Changes</h4>
        <ul className="status-list">
          {status?.files.length ? (
            status.files.map((f) => (
              <li key={f.path} onClick={() => showDiff(f.path)}>
                <code className="code-flag">
                  {f.index}
                  {f.work}
                </code>{" "}
                {f.path}
              </li>
            ))
          ) : (
            <li className="muted">Working tree clean</li>
          )}
        </ul>

        <h4>Recent commits</h4>
        <ul className="commit-list">
          {commits.map((c) => (
            <li key={c.hash}>
              <code>{c.hash}</code> <span className="muted">{c.date}</span> {c.subject}
            </li>
          ))}
        </ul>

        {log && <pre className="git-log">{log}</pre>}
      </div>

      {diff && (
        <div className="git-diff">
          <div className="editor-head">
            <span className="crumb">diff</span>
            <div className="spacer" />
            <button className="ghost" onClick={() => setDiff("")}>
              Close
            </button>
          </div>
          <pre>{diff}</pre>
        </div>
      )}
    </div>
  );
}
