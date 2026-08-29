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

export function SettingsPanel({
  externalStats,
  pingMs,
}: {
  externalStats?: any;
  pingMs?: number | null;
}) {
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
  const [theme, setTheme] = useState(() => localStorage.getItem("agy_theme") || "obsidian");
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("agy_sound") !== "false");
  const [notifyComplete, setNotifyComplete] = useState(() => localStorage.getItem("agy_notify_complete") !== "false");

  const applyTheme = (t: string) => {
    setTheme(t);
    localStorage.setItem("agy_theme", t);
    document.documentElement.setAttribute("data-theme", t);
  };

  const toggleSound = (enabled: boolean) => {
    setSoundEnabled(enabled);
    localStorage.setItem("agy_sound", enabled ? "true" : "false");
  };

  const [notifyPermission, setNotifyPermission] = useState<string>(() =>
    "Notification" in window ? Notification.permission : "unsupported"
  );

  const toggleNotifyComplete = (targetEnabled: boolean) => {
    if (targetEnabled) {
      if ("Notification" in window) {
        if (Notification.permission === "default") {
          // Direct invocation on user gesture (required by Apple iOS Safari)
          Notification.requestPermission()
            .then((perm) => {
              setNotifyPermission(perm);
              if (perm === "granted") {
                setNotifyComplete(true);
                localStorage.setItem("agy_notify_complete", "true");
                try {
                  new Notification("Antigravity Remote", {
                    body: "Đã cấp quyền thông báo thành công!",
                    icon: "icon.png",
                  });
                } catch {}
              } else {
                setNotifyComplete(false);
                localStorage.setItem("agy_notify_complete", "false");
                alert("Bạn đã từ chối cấp quyền thông báo.");
              }
            })
            .catch((err) => {
              console.error("[Notification Error]", err);
            });
          return;
        } else if (Notification.permission === "denied") {
          alert("Thông báo đã bị chặn trong Cài đặt trình duyệt/iOS. Vui lòng vào Cài đặt -> Thông báo để cho phép.");
          setNotifyComplete(false);
          localStorage.setItem("agy_notify_complete", "false");
          return;
        }
      }
      setNotifyComplete(true);
      localStorage.setItem("agy_notify_complete", "true");
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("Antigravity Remote", {
            body: "Đã bật thông báo khi Agent hoàn thành!",
            icon: "icon.png",
          });
        } catch {}
      }
    } else {
      setNotifyComplete(false);
      localStorage.setItem("agy_notify_complete", "false");
    }
  };

  const sendTestNotification = () => {
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification("Antigravity Remote", {
          body: "🎉 Thông báo thử nghiệm hoạt động tốt!",
          icon: "icon.png",
        });
      } catch (e: any) {
        alert("Lỗi gửi thông báo: " + e?.message);
      }
    } else {
      toggleNotifyComplete(true);
    }
  };

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
        "Đã lưu cài đặt thành công! Cài đặt server sẽ tự động áp dụng sau khi restart."
      );
      setTimeout(() => setMsg(""), 4000);
    } catch {
      setMsg("Không thể lưu cài đặt.");
    } finally {
      setBusy(false);
    }
  };

  const refreshQuota = async () => {
    try {
      const [acc, q] = await Promise.all([
        api.account().catch(() => null),
        api.quota().catch(() => null),
      ]);
      if (acc) setAccount(acc);
      if (q) setQuota(q);
    } catch {}
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

      // Poll periodically to wait for Language Server to populate new account's quota
      for (let i = 0; i < 6; i++) {
        await new Promise((res) => setTimeout(res, 800));
        try {
          const [acc, q] = await Promise.all([
            api.account().catch(() => null),
            api.quota().catch(() => null),
          ]);
          if (acc) setAccount(acc);
          if (q) setQuota(q);
        } catch {}
      }

      // Final refresh
      await Promise.all([
        api.account().then((a) => a && setAccount(a)).catch(() => {}),
        api.quota().then((q) => q && setQuota(q)).catch(() => {}),
        load().catch(() => {}),
      ]);

      const m = await api.models().catch(() => null);
      if (Array.isArray(m?.models)) {
        window.dispatchEvent(new CustomEvent("refresh-models", { detail: m.models }));
      }

      setSuccessMsg(`Đã chuyển sang tài khoản ${email} thành công! Đã làm mới Quota và hạn mức Model.`);
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi chuyển tài khoản");
    } finally {
      setBusy(false);
      setSwitchingTarget(null);
    }
  };

  if (!settings) return <div className="center muted">Đang tải cài đặt…</div>;

  // Calculate dynamic tokens and latency stats
  const totalToks = stats?.totalTokens || 0;
  const promptToksEstimate = Math.round(totalToks * 0.65);
  const completionToksEstimate = totalToks - promptToksEstimate;
  const avgDurationPerChat =
    stats && stats.totalChats > 0
      ? Math.round(stats.totalDurationMs / stats.totalChats / 1000)
      : 0;

  const pingStatusClass =
    pingMs == null ? "" : pingMs < 60 ? "ping-fast" : pingMs < 150 ? "ping-ok" : "ping-slow";
  const pingStatusLabel =
    pingMs == null
      ? "Đang đo..."
      : pingMs < 60
      ? "Cực nhanh (<60ms)"
      : pingMs < 150
      ? "Ổn định (60-150ms)"
      : "Chậm (>150ms)";

  return (
    <div className="settings">
      {/* Header section */}
      <div className="settings-top-header">
        <div className="settings-title-group">
          <h2>Cài đặt</h2>
          <span className="settings-ver-badge">Antigravity Remote</span>
        </div>
      </div>

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

      {/* Dynamic Statistics & Quota Forecasting Dashboard */}
      {stats != null && (
        <section className="card stats-section-card">
          <div className="stats-header">
            <h3><Icon name="cpu" size={16} /> Thống kê hoạt động hôm nay</h3>
            <button
              className="ghost sm reset-stats-btn"
              title="Đặt lại thống kê ngày hôm nay về 0"
              onClick={async () => {
                if (confirm("Bạn có chắc chắn muốn reset thống kê ngày hôm nay về 0?")) {
                  const s = await api.resetStats();
                  setStats(s);
                }
              }}
            >
              <Icon name="refresh" size={12} />
              <span>Đặt lại</span>
            </button>
          </div>

          <div className="stats-grid-dashboard">
            <div className="stat-card stat-chats">
              <div className="stat-icon-wrapper"><Icon name="message" size={18} /></div>
              <div className="stat-info">
                <span className="stat-value">{stats.totalChats}</span>
                <span className="stat-label">Lượt trò chuyện</span>
              </div>
            </div>

            <div className="stat-card stat-duration">
              <div className="stat-icon-wrapper"><Icon name="clock" size={18} /></div>
              <div className="stat-info">
                <span className="stat-value">{fmtDuration(stats.totalDurationMs)}</span>
                <span className="stat-label">Thời gian Agent xử lý</span>
              </div>
            </div>

            <div className="stat-card stat-avg-speed">
              <div className="stat-icon-wrapper"><Icon name="zap" size={18} /></div>
              <div className="stat-info">
                <span className="stat-value">{avgDurationPerChat}s</span>
                <span className="stat-label">Thời gian trung bình</span>
              </div>
            </div>

            <div className="stat-card stat-tokens">
              <div className="stat-icon-wrapper"><Icon name="sparkles" size={18} /></div>
              <div className="stat-info">
                <span className="stat-value">{stats.totalTokens.toLocaleString()}</span>
                <span className="stat-label">Tokens tiêu thụ</span>
                {totalToks > 0 && (
                  <div className="stat-token-pill-row">
                    <span className="stat-mini-pill prompt-pill">In: {promptToksEstimate.toLocaleString()}</span>
                    <span className="stat-mini-pill comp-pill">Out: {completionToksEstimate.toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Theme Selector & Experience */}
      <section className="card theme-section-card">
        <h3><Icon name="sparkles" size={16} /> Giao diện & Trải nghiệm</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Tùy chỉnh chủ đề màu sắc, âm thanh thông báo và rung phản hồi của Antigravity Remote Plus.
        </p>

        <div className="theme-grid">
          <div
            className={"theme-card" + (theme === "obsidian" ? " active" : "")}
            onClick={() => applyTheme("obsidian")}
          >
            <div className="theme-preview obsidian" />
            <div className="theme-card-info">
              <span className="theme-card-name">🌌 Obsidian Studio</span>
              <span className="theme-card-desc">Tối sâu thẳm, viền tím Indigo & Cyan</span>
            </div>
            {theme === "obsidian" && <span className="theme-check"><Icon name="check" size={14} /></span>}
          </div>

          <div
            className={"theme-card" + (theme === "oled" ? " active" : "")}
            onClick={() => applyTheme("oled")}
          >
            <div className="theme-preview oled" />
            <div className="theme-card-info">
              <span className="theme-card-name">🌑 Midnight OLED</span>
              <span className="theme-card-desc">Đen thuần 100%, tiết kiệm pin màn OLED</span>
            </div>
            {theme === "oled" && <span className="theme-check"><Icon name="check" size={14} /></span>}
          </div>

          <div
            className={"theme-card" + (theme === "tokyo" ? " active" : "")}
            onClick={() => applyTheme("tokyo")}
          >
            <div className="theme-preview tokyo" />
            <div className="theme-card-info">
              <span className="theme-card-name">🌆 Tokyo Night</span>
              <span className="theme-card-desc">Xanh tím trầm ấm chuẩn coder</span>
            </div>
            {theme === "tokyo" && <span className="theme-check"><Icon name="check" size={14} /></span>}
          </div>

          <div
            className={"theme-card" + (theme === "cyberpunk" ? " active" : "")}
            onClick={() => applyTheme("cyberpunk")}
          >
            <div className="theme-preview cyberpunk" />
            <div className="theme-card-info">
              <span className="theme-card-name">⚡ Cyberpunk Neon</span>
              <span className="theme-card-desc">Điểm nhấn Neon Cyan & Amber rực rỡ</span>
            </div>
            {theme === "cyberpunk" && <span className="theme-check"><Icon name="check" size={14} /></span>}
          </div>
        </div>

        <div className="sound-toggle-row">
          <div className="sound-toggle-info">
            <Icon name={soundEnabled ? "volume" : "volumeX"} size={16} />
            <div>
              <strong>Âm thanh thông báo &amp; Rung haptic</strong>
              <div className="muted small">Phát chuông nhẹ và rung khi AI hoàn thành hoặc có câu hỏi</div>
            </div>
          </div>
          <button
            type="button"
            className={"sound-switch-btn" + (soundEnabled ? " active" : "")}
            onClick={() => toggleSound(!soundEnabled)}
          >
            <span>{soundEnabled ? "Bật" : "Tắt"}</span>
          </button>
        </div>

        <div className="sound-toggle-row" style={{ marginTop: 10 }}>
          <div className="sound-toggle-info">
            <Icon name="bell" size={16} />
            <div>
              <strong>Thông báo đẩy khi Agent trả lời xong</strong>
              <div className="muted small">
                Nhận thông báo hệ thống khi AI hoàn thành tác vụ ngay cả khi đang chuyển ứng dụng
                {notifyPermission !== "unsupported" && (
                  <span style={{ marginLeft: 6, opacity: 0.8 }}>
                    ({notifyPermission === "granted" ? "🟢 Đã cấp quyền" : notifyPermission === "denied" ? "🔴 Bị từ chối quyền" : "🟡 Chưa cấp quyền"})
                  </span>
                )}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="ghost sm"
              style={{ fontSize: 11, padding: "4px 8px" }}
              onClick={sendTestNotification}
              title="Bấm để thử nghiệm gửi thông báo hoặc cấp quyền"
            >
              {notifyPermission === "granted" ? "Gửi thử" : "Cấp quyền"}
            </button>
            <button
              type="button"
              className={"sound-switch-btn" + (notifyComplete ? " active" : "")}
              onClick={() => toggleNotifyComplete(!notifyComplete)}
            >
              <span>{notifyComplete ? "Bật" : "Tắt"}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Account Switcher */}
      <section className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}><Icon name="user" size={16} /> Quản lý Tài khoản</h3>
          <button className="ghost sm" onClick={refreshQuota} title="Làm mới danh sách và quota">
            <Icon name="refresh" size={12} /> <span>Làm mới</span>
          </button>
        </div>
        <AccountView account={account} busy={busy} onSwitch={switchAccount} />
      </section>

      {/* Quota Section */}
      {quota && (
        <section className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}><Icon name="gauge" size={16} /> Hạn mức Model & Quota</h3>
            <button className="ghost sm" onClick={refreshQuota} title="Làm mới hạn mức Quota">
              <Icon name="refresh" size={12} /> <span>Làm mới</span>
            </button>
          </div>
          <QuotaView quota={quota} />
        </section>
      )}

      {/* Workspace Root Section */}
      <section className="card">
        <h3><Icon name="folder" size={16} /> Cấu hình Thư mục Workspace Root</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Chọn thư mục chứa các dự án (mỗi thư mục con là một workspace độc lập) để Antigravity Remote tự động phát hiện.
        </p>

        <div className="form-grid">
          <label>Đường dẫn thư mục Root</label>
          <div className="ws-root-row">
            <input
              type="text"
              placeholder="vd: /Users/deece/Projects"
              value={settings.workspaceRoot}
              onChange={(e) => set("workspaceRoot", e.target.value)}
            />
            <button
              className="ghost icon-btn"
              onClick={() => setShowPicker((v) => !v)}
              title="Chọn thư mục"
            >
              <Icon name="folder" size={15} /> <span>Duyệt…</span>
            </button>
          </div>
        </div>

        {showPicker && (
          <FolderPicker
            onPick={(dir) => {
              set("workspaceRoot", dir);
              setShowPicker(false);
              setMsg('Đã chọn thư mục. Bấm "Lưu cài đặt" để áp dụng.');
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

      {/* Server Configuration */}
      <section className="card">
        <h3><Icon name="server" size={16} /> Cấu hình Máy chủ (Remote Server)</h3>
        <div className="form-grid">
          <label>Cổng kết nối (Port)</label>
          <input
            type="number"
            value={settings.port}
            onChange={(e) => set("port", Number(e.target.value))}
          />

          <label>Địa chỉ lắng nghe (Bind Host)</label>
          <select
            value={settings.bindHost}
            onChange={(e) => set("bindHost", e.target.value)}
          >
            <option value="127.0.0.1">127.0.0.1 (Chỉ máy cục bộ)</option>
            <option value="0.0.0.0">0.0.0.0 (Mở mạng LAN / Internet)</option>
          </select>

          <label>Mật khẩu truy cập</label>
          <input
            type="text"
            placeholder="Để trống nếu không đặt mật khẩu"
            value={settings.password}
            onChange={(e) => set("password", e.target.value)}
          />

          <label>Tự động khởi động cùng IDE</label>
          <input
            type="checkbox"
            checked={settings.autoStart}
            onChange={(e) => set("autoStart", e.target.checked)}
          />

          <label>Cổng Remote-Debug</label>
          <input
            type="number"
            value={settings.remoteDebugPort}
            onChange={(e) => set("remoteDebugPort", Number(e.target.value))}
          />
        </div>
        {settings.bindHost === "0.0.0.0" && !settings.password && (
          <div className="warn-text">
            ⚠️ Đang mở lắng nghe 0.0.0.0 mà không đặt mật khẩu có thể không an toàn. Bạn nên đặt mật khẩu.
          </div>
        )}
      </section>

      {/* Telegram Bot */}
      <section className="card">
        <h3><Icon name="message" size={16} /> Thông báo Telegram Bot</h3>
        <div className="form-grid">
          <label>Kích hoạt Telegram</label>
          <input
            type="checkbox"
            checked={settings.telegramEnabled}
            onChange={(e) => set("telegramEnabled", e.target.checked)}
          />

          <label>Thông báo khi Agent trả lời xong</label>
          <input
            type="checkbox"
            checked={settings.telegramNotifyOnComplete !== false}
            onChange={(e) => set("telegramNotifyOnComplete", e.target.checked)}
          />

          <label>Bot Token</label>
          <input
            type="text"
            placeholder="123456:ABC-DEF…"
            value={settings.telegramToken}
            onChange={(e) => set("telegramToken", e.target.value)}
          />

          <label>Chat ID / User ID</label>
          <input
            type="text"
            placeholder="vd: 8247614754"
            value={settings.telegramChatId}
            onChange={(e) => set("telegramChatId", e.target.value)}
          />
        </div>
        <p className="muted small">
          Lấy Bot Token từ @BotFather. Chat ID có thể lấy bằng cách nhắn tin cho bot và kiểm tra qua @userinfobot. Khi bật thông báo, Bot sẽ tự động gửi tin nhắn đến Telegram khi Agent trả lời xong (kể cả khi bạn gửi tin nhắn từ Web UI hoặc IDE).
        </p>
      </section>

      <div className="settings-actions">
        <button className="primary" onClick={save} disabled={busy}>
          {busy ? "Đang lưu…" : "Lưu cài đặt"}
        </button>
        <button className="ghost" onClick={load} disabled={busy}>
          Làm mới
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

function formatTier(tier?: string): string {
  if (!tier) return "FREE";
  const t = tier.toUpperCase();
  if (t.includes("PRO") || t.includes("PLUS") || t.includes("ULTRA") || t.includes("PREMIUM") || t.includes("PAID") || t.includes("ENTERPRISE")) {
    return "PRO";
  }
  return "FREE";
}

function QuotaView({ quota }: { quota: QuotaInfo }) {
  const pc = quota.credits?.promptCredits;
  const fc = quota.credits?.flowCredits;

  const renderCreditCard = (label: string, iconName: any, avail?: number, monthly?: number) => {
    if (avail == null && monthly == null) return null;
    const pct =
      monthly && monthly > 0 ? Math.min(100, Math.round(((avail ?? 0) / monthly) * 100)) : 0;
    return (
      <div className="credit-meter-card">
        <div className="credit-card-head">
          <div className="credit-card-title">
            <Icon name={iconName} size={15} />
            <span>{label}</span>
          </div>
          <span className="credit-card-val">
            <strong>{avail ?? 0}</strong>
            {monthly ? ` / ${monthly}` : ""}
          </span>
        </div>
        <div className="meter-track-premium">
          <div className="meter-fill-premium" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  };

  const groupedModels = groupModelQuotas(quota.modelQuota);

  return (
    <div className="quota-view-premium">
      <div className="quota-header-card">
        <div className="quota-plan-badge">
          <Icon name="sparkles" size={13} />
          <span>Gói: {formatTier(quota.plan)}</span>
        </div>
        {quota.account?.email && (
          <span className="quota-email-tag">{quota.account.email}</span>
        )}
      </div>

      <div className="credits-grid">
        {renderCreditCard("Prompt Credits", "zap", pc?.available, pc?.monthly)}
        {renderCreditCard("Flow Credits", "cpu", fc?.available, fc?.monthly)}
      </div>

      {groupedModels.length > 0 && (
        <div className="model-quota-container">
          <div className="quota-section-title">
            <Icon name="gauge" size={14} /> <span>Hạn mức theo từng Model</span>
          </div>
          <div className="model-quota-grid">
            {groupedModels.map((m) => {
              const pct = Math.round((m.remainingFraction ?? 0) * 100);
              const isLow = pct < 20;
              const isWarn = pct >= 20 && pct < 50;
              const statusClass = isLow ? "meter-low" : isWarn ? "meter-warn" : "meter-good";
              const isClaude = m.label.toLowerCase().includes("claude") || m.label.toLowerCase().includes("gpt");

              return (
                <div key={m.label} className={`model-quota-card ${statusClass}`}>
                  <div className="model-quota-card-head">
                    <div className="model-name-group">
                      <span className="model-icon-dot" />
                      <strong>{m.label}</strong>
                    </div>
                    <span className={`model-pct-badge ${statusClass}`}>{pct}%</span>
                  </div>

                  <div className="meter-track-premium sm">
                    <div className={`meter-fill-premium ${statusClass}`} style={{ width: `${pct}%` }} />
                  </div>

                  {m.resetTime && (
                    <div className="model-reset-row">
                      <Icon name="clock" size={11} />
                      <span>Hồi lại: {new Date(m.resetTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
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

  const isPro = (tier?: string) => formatTier(tier) === "PRO";

  const sorted = [...accounts].sort((a, b) => {
    const aPro = isPro(a.tier);
    const bPro = isPro(b.tier);
    if (aPro !== bPro) return aPro ? -1 : 1;
    if (a.current !== b.current) return a.current ? -1 : 1;
    return (a.name || a.email).localeCompare(b.name || b.email);
  });

  const initials = (s: string) =>
    s.trim().slice(0, 2).toUpperCase() || "?";

  return (
    <div className="account-list-premium">
      {sorted.map((a) => {
        const open = expanded === a.id;
        const isSwitching = switchingEmail === a.email;
        const groupedQuota = groupAccountQuotas(a.quota);
        const lowest = [...groupedQuota].sort(
          (x, y) => x.percentage - y.percentage
        )[0];

        const tierLabel = formatTier(a.tier);

        return (
          <div
            key={a.id || a.email}
            className={"account-card-premium" + (a.current ? " current-active" : "")}
          >
            <div className="account-card-top">
              <div className={"account-avatar-circle" + (a.current ? " glow" : "")}>
                {initials(a.name || a.email)}
              </div>

              <div className="account-details">
                <div className="account-details-name-row">
                  <span className="account-user-name">{a.name || a.email}</span>
                  {a.current ? (
                    <span className="account-status-badge active">
                      <Icon name="check" size={10} /> <span>Đang dùng</span>
                    </span>
                  ) : (
                    a.disabled && <span className="account-status-badge off">Bị khóa</span>
                  )}
                  <span className={`account-tier-badge ${tierLabel.toLowerCase()}`}>{tierLabel}</span>
                </div>
                <div className="account-user-email">{a.email}</div>
              </div>

              <div className="account-card-actions">
                {!a.current ? (
                  <button
                    className="primary sm btn-switch-premium"
                    disabled={busy || isSwitching}
                    onClick={() => handleSwitch(a.email)}
                  >
                    <Icon
                      name={isSwitching ? "spinner" : "refresh"}
                      size={12}
                      className={isSwitching ? "spin" : ""}
                    />
                    <span>{isSwitching ? "Đang đổi…" : "Chuyển"}</span>
                  </button>
                ) : (
                  <span className="account-active-indicator">
                    <span className="active-green-dot" /> Sẵn sàng
                  </span>
                )}

                {groupedQuota.length > 0 && (
                  <button
                    className="ghost icon-btn sm btn-toggle-quota"
                    onClick={() => setExpanded(open ? null : a.id)}
                    title="Chi tiết quota"
                  >
                    <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Mini Quota Summary Bar */}
            {groupedQuota.length > 0 && (
              <div className="account-quota-summary-pills">
                {groupedQuota.map((m) => {
                  const isLow = m.percentage < 20;
                  const isWarn = m.percentage >= 20 && m.percentage < 50;
                  const pillClass = isLow ? "pill-low" : isWarn ? "pill-warn" : "pill-good";
                  return (
                    <div key={m.name} className={`quota-mini-pill ${pillClass}`}>
                      <span className="pill-name">{m.displayName}:</span>
                      <strong>{m.percentage}%</strong>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Dropdown Full Quota Detail */}
            {open && groupedQuota.length > 0 && (
              <div className="account-quota-dropdown-premium">
                {groupedQuota.map((m) => {
                  const pctClass = m.percentage < 20 ? "err" : m.percentage < 50 ? "warn" : "good";
                  return (
                    <div key={m.name} className="account-meter-row">
                      <div className="account-meter-label">
                        <span>{m.displayName || m.name}</span>
                        <span className={`pct-value ${pctClass}`}>{m.percentage}%</span>
                      </div>
                      <div className="meter-track-premium sm">
                        <div
                          className={`meter-fill-premium ${pctClass}`}
                          style={{ width: `${m.percentage}%` }}
                        />
                      </div>
                      {m.resetTime && (
                        <div className="account-meter-reset">
                          <Icon name="clock" size={10} />
                          <span>Hồi lại: {new Date(m.resetTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                      )}
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
