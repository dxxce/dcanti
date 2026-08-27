import { useCallback, useEffect, useState } from "react";
import {
  api,
  type RemoteSettings,
  type AccountInfo,
  type BrowseResult,
  type QuotaInfo,
  type TodayStats,
  type WorkspaceFolders,
} from "../api";
import { Icon } from "./Icon";

function fmtDuration(ms: number): string {
  if (!ms || ms <= 0) return "0s";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${min}m ${s}s`;
}

export function SettingsPanel({ externalStats }: { externalStats?: any }) {
  const [settings, setSettings] = useState<RemoteSettings | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [stats, setStats] = useState<TodayStats | null>(null);
  const [wsFolders, setWsFolders] = useState<WorkspaceFolders | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [switchingTarget, setSwitchingTarget] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (externalStats) setStats(externalStats);
  }, [externalStats]);

  const load = useCallback(async () => {
    try {
      const [s, a, st] = await Promise.all([
        api.getSettings().catch(() => null),
        api.account().catch(() => null),
        api.stats().catch(() => null),
      ]);
      if (s) setSettings(s);
      if (a) setAccount(a);
      if (st) setStats(st);
    } catch {}

    api.quota().then((q) => { if (q) setQuota(q); }).catch(() => {});
    api.workspaceFolders().then((wf) => { if (wf) setWsFolders(wf); }).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = <K extends keyof RemoteSettings>(key: K, value: RemoteSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const save = async () => {
    if (!settings) return;
    setBusy(true);
    setMsg("");
    try {
      const updated = await api.saveSettings(settings);
      setSettings(updated);
      setMsg(
        "Saved. Server settings (port/password/host/telegram) apply on the next server restart — the extension restarts it automatically."
      );
    } catch {
      setMsg("Failed to save.");
    } finally {
      setBusy(false);
    }
  };

  const switchAccount = async (email: string) => {
    setBusy(true);
    setSwitchingTarget(email);
    setSuccessMsg(null);
    setErrorMsg(null);
    setMsg("");

    try {
      const r = await api.switchAccount(email);
      if (!r.ok) {
        throw new Error(r.error || "Không thể chuyển tài khoản");
      }

      // Verification loop: poll until the account is active or timeout
      for (let i = 0; i < 8; i++) {
        await new Promise((res) => setTimeout(res, 600));
        try {
          const [acc, q] = await Promise.all([
            api.account().catch(() => null),
            api.quota().catch(() => null),
          ]);
          if (acc) setAccount(acc);
          if (q) setQuota(q);
          if (acc?.currentEmail === email || q?.account?.email === email) {
            break;
          }
        } catch {}
      }

      await load();
      setSuccessMsg(`Đã chuyển sang tài khoản ${email} thành công! Antigravity IDE đã sẵn sàng.`);
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi chuyển tài khoản");
    } finally {
      setBusy(false);
      setSwitchingTarget(null);
    }
  };

  if (!settings) return <div className="center muted">Loading settings…</div>;

  return (
    <div className="settings">
      {/* Account Switching Loading Overlay */}
      {switchingTarget && (
        <div className="account-switch-overlay">
          <div className="account-switch-modal">
            <Icon name="spinner" size={32} className="spin accent-spin" />
            <div className="account-switch-title">
              Đang chuyển sang <strong>{switchingTarget}</strong>…
            </div>
            <div className="account-switch-desc">
              Đang đồng bộ Token và cập nhật Antigravity IDE Language Server…
            </div>
          </div>
        </div>
      )}

      {/* Success Notification Banner */}
      {successMsg && (
        <div className="account-feedback-banner success">
          <div className="feedback-content">
            <Icon name="check" size={16} />
            <span>{successMsg}</span>
          </div>
          <button className="ghost icon-btn sm" onClick={() => setSuccessMsg(null)} title="Đóng">
            <Icon name="close" size={13} />
          </button>
        </div>
      )}

      {/* Error Notification Banner */}
      {errorMsg && (
        <div className="account-feedback-banner error">
          <div className="feedback-content">
            <Icon name="close" size={16} />
            <span>{errorMsg}</span>
          </div>
          <button className="ghost icon-btn sm" onClick={() => setErrorMsg(null)} title="Đóng">
            <Icon name="close" size={13} />
          </button>
        </div>
      )}
      {stats != null && (
        <section className="card stats-section-card">
          <div className="stats-header">
            <h3><Icon name="cpu" size={16} /> Thống kê hôm nay</h3>
            <button
              className="ghost sm reset-stats-btn"
              title="Đặt lại thống kê hôm nay về 0"
              onClick={async () => {
                if (confirm("Bạn có chắc chắn muốn reset thống kê ngày hôm nay về 0?")) {
                  const s = await api.resetStats();
                  setStats(s);
                }
              }}
            >
              <Icon name="refresh" size={12} />
              <span>Reset</span>
            </button>
          </div>
          <div className="stats-layout">
            <div className="stats-row-top">
              <div className="stat-card stat-chats">
                <div className="stat-icon-wrapper"><Icon name="message" size={18} /></div>
                <div className="stat-info">
                  <span className="stat-value">{stats.totalChats}</span>
                  <span className="stat-label">Số tin</span>
                </div>
              </div>
              <div className="stat-card stat-duration">
                <div className="stat-icon-wrapper"><Icon name="clock" size={18} /></div>
                <div className="stat-info">
                  <span className="stat-value">{fmtDuration(stats.totalDurationMs)}</span>
                  <span className="stat-label">Tổng thời gian Agent xử lý</span>
                </div>
              </div>
            </div>
            <div className="stats-row-bottom">
              <div className="stat-card stat-tokens stat-card-hero">
                <div className="stat-icon-wrapper"><Icon name="zap" size={22} /></div>
                <div className="stat-info">
                  <span className="stat-value stat-value-hero">
                    {stats.totalTokens.toLocaleString()}
                  </span>
                  <span className="stat-label">Tổng Tokens tiêu tốn</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <h3><Icon name="user" size={16} /> Tài khoản</h3>
        <AccountView account={account} busy={busy} onSwitch={switchAccount} />
      </section>

      {quota && (
        <section className="card">
          <h3><Icon name="gauge" size={16} /> Quota</h3>
          <QuotaView quota={quota} />
        </section>
      )}

      <section className="card">
        <h3><Icon name="folder" size={16} /> Workspace</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Chọn thư mục <strong>chứa các workspace</strong> (mỗi thư mục con là một
          workspace), hoặc chọn thẳng một thư mục workspace — hệ thống tự hiểu.
        </p>

        <div className="form-grid">
          <label>Thư mục workspace root</label>
          <div className="ws-root-row">
            <input
              type="text"
              placeholder="vd: /Users/deece/Documents"
              value={settings.workspaceRoot}
              onChange={(e) => set("workspaceRoot", e.target.value)}
            />
            <button
              className="ghost icon-btn"
              onClick={() => setShowPicker((v) => !v)}
              title="Chọn thư mục"
            >
              <Icon name="folder" size={15} /> <span>Chọn…</span>
            </button>
          </div>
        </div>

        {showPicker && (
          <FolderPicker
            onPick={(dir) => {
              // Save the chosen folder as the workspace root (do NOT reload the
              // IDE) — the sidebar will list its sub-folders as workspaces.
              set("workspaceRoot", dir);
              setShowPicker(false);
              setMsg('Đã chọn. Bấm "Lưu cài đặt" để áp dụng.');
            }}
          />
        )}

        {wsFolders && wsFolders.folders.length > 0 && (
          <>
            <div className="quota-section-title">
              Workspace tìm thấy ({wsFolders.folders.length})
            </div>
            <ul className="quick-ws">
              {wsFolders.folders.map((f) => (
                <li key={f.path}>
                  <Icon name="folder" size={14} className="entry-icon dir" />
                  <span className="quick-ws-name">{f.name}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <h3>Server</h3>
        <div className="form-grid">
          <label>Port</label>
          <input
            type="number"
            value={settings.port}
            onChange={(e) => set("port", Number(e.target.value))}
          />

          <label>Bind host</label>
          <select
            value={settings.bindHost}
            onChange={(e) => set("bindHost", e.target.value)}
          >
            <option value="127.0.0.1">127.0.0.1 (localhost only)</option>
            <option value="0.0.0.0">0.0.0.0 (LAN / internet)</option>
          </select>

          <label>Password</label>
          <input
            type="text"
            value={settings.password}
            onChange={(e) => set("password", e.target.value)}
          />

          <label>Auto-start</label>
          <input
            type="checkbox"
            checked={settings.autoStart}
            onChange={(e) => set("autoStart", e.target.checked)}
          />

          <label>Remote-debug port</label>
          <input
            type="number"
            value={settings.remoteDebugPort}
            onChange={(e) => set("remoteDebugPort", Number(e.target.value))}
          />
        </div>
        {settings.bindHost === "0.0.0.0" && !settings.password && (
          <div className="warn-text">
            Binding to 0.0.0.0 without a password is unsafe. Set a password.
          </div>
        )}
      </section>

      <section className="card">
        <h3>Telegram</h3>
        <div className="form-grid">
          <label>Enabled</label>
          <input
            type="checkbox"
            checked={settings.telegramEnabled}
            onChange={(e) => set("telegramEnabled", e.target.checked)}
          />

          <label>Bot token</label>
          <input
            type="text"
            placeholder="123456:ABC-DEF…"
            value={settings.telegramToken}
            onChange={(e) => set("telegramToken", e.target.value)}
          />

          <label>Chat / user ID</label>
          <input
            type="text"
            placeholder="e.g. 8247614754"
            value={settings.telegramChatId}
            onChange={(e) => set("telegramChatId", e.target.value)}
          />
        </div>
        <p className="muted small">
          Get the token from @BotFather. The chat ID restricts control to a single
          Telegram chat — send your bot a message and check @userinfobot for your ID.
        </p>
      </section>

      <div className="settings-actions">
        <button className="primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>
        <button className="ghost" onClick={load} disabled={busy}>
          Reload
        </button>
      </div>
      {msg && <div className="editor-msg">{msg}</div>}
    </div>
  );
}

interface GroupedModelQuota {
  label: string;
  remainingFraction: number;
  resetTime?: string;
}

function groupModelQuotas(
  quotas?: Array<{ label: string; remainingFraction?: number; resetTime?: string }>
): GroupedModelQuota[] {
  if (!quotas || quotas.length === 0) return [];

  const geminiList: Array<{ label: string; remainingFraction?: number; resetTime?: string }> = [];
  const claudeGptList: Array<{ label: string; remainingFraction?: number; resetTime?: string }> = [];

  for (const m of quotas) {
    const l = (m.label || "").toLowerCase();
    if (
      l.includes("claude") ||
      l.includes("gpt") ||
      l.includes("opus") ||
      l.includes("sonnet") ||
      l.includes("openai")
    ) {
      claudeGptList.push(m);
    } else if (l.includes("gemini")) {
      geminiList.push(m);
    }
  }

  const result: GroupedModelQuota[] = [];

  if (geminiList.length > 0) {
    const lowestGem = geminiList.reduce(
      (min, cur) =>
        (cur.remainingFraction ?? 1) < (min.remainingFraction ?? 1) ? cur : min,
      geminiList[0]
    );
    result.push({
      label: "Gemini",
      remainingFraction: lowestGem.remainingFraction ?? 1,
      resetTime: lowestGem.resetTime || geminiList.find((g) => g.resetTime)?.resetTime,
    });
  }

  if (claudeGptList.length > 0) {
    const lowestC = claudeGptList.reduce(
      (min, cur) =>
        (cur.remainingFraction ?? 1) < (min.remainingFraction ?? 1) ? cur : min,
      claudeGptList[0]
    );
    result.push({
      label: "Claude & GPT",
      remainingFraction: lowestC.remainingFraction ?? 1,
      resetTime: lowestC.resetTime || claudeGptList.find((c) => c.resetTime)?.resetTime,
    });
  }

  return result.length > 0
    ? result
    : quotas.slice(0, 2).map((q) => ({
        label: q.label,
        remainingFraction: q.remainingFraction ?? 1,
        resetTime: q.resetTime,
      }));
}

interface GroupedAccountQuota {
  name: string;
  displayName: string;
  percentage: number;
  resetTime?: string;
}

function groupAccountQuotas(
  quotas?: Array<{ name: string; displayName?: string; percentage: number; resetTime?: string }>
): GroupedAccountQuota[] {
  if (!quotas || quotas.length === 0) return [];

  const geminiList: Array<{ name: string; displayName: string; percentage: number; resetTime?: string }> = [];
  const claudeGptList: Array<{ name: string; displayName: string; percentage: number; resetTime?: string }> = [];

  for (const m of quotas) {
    const dn = m.displayName || m.name || "Model";
    const l = `${m.name} ${dn}`.toLowerCase();
    if (
      l.includes("claude") ||
      l.includes("gpt") ||
      l.includes("opus") ||
      l.includes("sonnet")
    ) {
      claudeGptList.push({ name: m.name, displayName: dn, percentage: m.percentage, resetTime: m.resetTime });
    } else if (l.includes("gemini")) {
      geminiList.push({ name: m.name, displayName: dn, percentage: m.percentage, resetTime: m.resetTime });
    }
  }

  const result: GroupedAccountQuota[] = [];

  if (geminiList.length > 0) {
    const lowestGem = geminiList.reduce(
      (min, cur) => (cur.percentage < min.percentage ? cur : min),
      geminiList[0]
    );
    result.push({
      name: "gemini",
      displayName: "Gemini",
      percentage: lowestGem.percentage,
      resetTime: lowestGem.resetTime,
    });
  }

  if (claudeGptList.length > 0) {
    const lowestC = claudeGptList.reduce(
      (min, cur) => (cur.percentage < min.percentage ? cur : min),
      claudeGptList[0]
    );
    result.push({
      name: "claude-gpt",
      displayName: "Claude & GPT",
      percentage: lowestC.percentage,
      resetTime: lowestC.resetTime,
    });
  }

  return result.length > 0
    ? result
    : quotas.slice(0, 2).map((q) => ({
        name: q.name,
        displayName: q.displayName || q.name,
        percentage: q.percentage,
        resetTime: q.resetTime,
      }));
}

function QuotaView({ quota }: { quota: QuotaInfo }) {
  const pc = quota.credits?.promptCredits;
  const fc = quota.credits?.flowCredits;
  const meter = (label: string, avail?: number, monthly?: number) => {
    if (avail == null && monthly == null) return null;
    const pct =
      monthly && monthly > 0 ? Math.min(100, Math.round(((avail ?? 0) / monthly) * 100)) : 0;
    return (
      <div className="meter-row">
        <div className="meter-label">
          <span>{label}</span>
          <span className="dim">
            {avail ?? 0}
            {monthly ? ` / ${monthly}` : ""}
          </span>
        </div>
        <div className="meter">
          <div className="meter-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  };

  const groupedModels = groupModelQuotas(quota.modelQuota);

  return (
    <div className="quota-view">
      <div className="quota-plan">
        <span className="badge">{quota.plan || "—"}</span>
        {quota.account?.email && (
          <span className="dim small">{quota.account.email}</span>
        )}
      </div>
      {meter("Prompt credits", pc?.available, pc?.monthly)}
      {meter("Flow credits", fc?.available, fc?.monthly)}
      {groupedModels.length > 0 && (
        <>
          <div className="quota-section-title">Model quota</div>
          {groupedModels.map((m) => {
            const pct = Math.round((m.remainingFraction ?? 0) * 100);
            return (
              <div key={m.label} className="model-quota-row">
                <div className="model-quota-head">
                  <span className="name">{m.label}</span>
                  <span className="pct">{pct}%</span>
                </div>
                <div className="meter">
                  <div className="meter-fill" style={{ width: `${pct}%` }} />
                </div>
                {m.resetTime && (
                  <span className="reset-time">
                    reset {new Date(m.resetTime).toLocaleString()}
                  </span>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function AccountView({
  account,
  onSwitch,
  busy,
}: {
  account: AccountInfo | null;
  onSwitch: (email: string) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [switchingEmail, setSwitchingEmail] = useState<string | null>(null);

  if (!account) return <div className="muted pad">Đang tải danh sách tài khoản…</div>;
  const accounts = account.accounts ?? [];
  if (accounts.length === 0)
    return <div className="muted pad">Không tìm thấy tài khoản Cockpit nào trên máy.</div>;

  const handleSwitch = async (email: string) => {
    setSwitchingEmail(email);
    try {
      await onSwitch(email);
    } finally {
      setSwitchingEmail(null);
    }
  };

  // Current account first, then sort by name
  const sorted = [...accounts].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return (a.name || a.email).localeCompare(b.name || b.email);
  });

  const initials = (s: string) =>
    s.trim().slice(0, 2).toUpperCase() || "?";

  return (
    <div className="account-list">
      {sorted.map((a) => {
        const open = expanded === a.id;
        const isSwitching = switchingEmail === a.email;
        const groupedQuota = groupAccountQuotas(a.quota);
        const lowest = [...groupedQuota].sort(
          (x, y) => x.percentage - y.percentage
        )[0];
        return (
          <div
            key={a.id || a.email}
            className={"account-card" + (a.current ? " current" : "")}
          >
            <div className="account-main">
              <div className={"account-avatar" + (a.current ? " on" : "")}>
                {initials(a.name || a.email)}
              </div>
              <div className="account-meta">
                <div className="account-name-row">
                  <span className="account-name-text">{a.name || a.email}</span>
                  {a.current ? (
                    <span className="account-badge active">
                      <Icon name="check" size={11} /> <span>Đang dùng</span>
                    </span>
                  ) : (
                    a.disabled && <span className="account-badge off">Khóa</span>
                  )}
                </div>
                <div className="account-email">{a.email}</div>
                {a.tier && <div className="account-tier">{a.tier}</div>}
              </div>
              <div className="account-actions">
                {lowest && (
                  <span
                    className={"account-quota-mini " + (lowest.percentage < 20 ? "low" : lowest.percentage < 50 ? "warn" : "")}
                    title={`${lowest.displayName}: ${lowest.percentage}% còn lại`}
                  >
                    {lowest.percentage}%
                  </span>
                )}
                {!a.current && (
                  <button
                    className="primary sm btn-switch-acc"
                    disabled={busy || isSwitching}
                    onClick={() => handleSwitch(a.email)}
                  >
                    <Icon
                      name={isSwitching ? "spinner" : "refresh"}
                      size={13}
                      className={isSwitching ? "spin" : ""}
                    />
                    <span>{isSwitching ? "Đang chuyển…" : "Chuyển"}</span>
                  </button>
                )}
                {groupedQuota.length > 0 && (
                  <button
                    className="ghost icon-btn sm"
                    onClick={() => setExpanded(open ? null : a.id)}
                    title="Xem chi tiết quota"
                  >
                    <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
                  </button>
                )}
              </div>
            </div>
            {open && groupedQuota.length > 0 && (
              <div className="account-quota-dropdown">
                {groupedQuota.map((m) => {
                  const pctClass = m.percentage < 20 ? "err" : m.percentage < 50 ? "warn" : "";
                  return (
                    <div key={m.name} className="mini-meter-row">
                      <div className="mini-meter-label">
                        <span>{m.displayName || m.name}</span>
                        <span className={"dim " + pctClass}>{m.percentage}%</span>
                      </div>
                      <div className="meter sm">
                        <div
                          className={"meter-fill " + pctClass}
                          style={{ width: `${m.percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FolderPicker({ onPick }: { onPick: (dir: string) => void }) {
  const [browse, setBrowse] = useState<BrowseResult | null>(null);

  const go = useCallback(async (dir?: string) => {
    const r = await api.browse(dir);
    setBrowse(r);
  }, []);

  useEffect(() => {
    go();
  }, [go]);

  if (!browse) return <div className="muted pad">Loading…</div>;

  return (
    <div className="folder-picker">
      <div className="picker-head">
        <button
          className="ghost icon-btn"
          onClick={() => browse.parent && go(browse.parent)}
          disabled={!browse.parent}
        >
          <Icon name="arrowUp" size={15} /> <span>Up</span>
        </button>
        <code className="crumb">{browse.cwd}</code>
        <button className="ghost icon-btn" onClick={() => go(browse.home)}>
          <Icon name="home" size={15} /> <span>Home</span>
        </button>
      </div>
      <ul className="picker-list">
        {browse.dirs.length === 0 && (
          <li className="muted pad">No subfolders.</li>
        )}
        {browse.dirs.map((d) => (
          <li key={d}>
            <span
              className="picker-name icon-btn"
              onClick={() => go(joinPath(browse.cwd, d))}
            >
              <Icon name="folder" size={15} className="entry-icon dir" /> <span>{d}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="picker-actions">
        <button className="primary" onClick={() => onPick(browse.cwd)}>
          Open this folder
        </button>
      </div>
    </div>
  );
}

function joinPath(base: string, name: string): string {
  const sep = base.includes("\\") ? "\\" : "/";
  return base.endsWith(sep) ? base + name : base + sep + name;
}
