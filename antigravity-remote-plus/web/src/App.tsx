import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  UnauthorizedError,
  type ChatState,
  type Trajectory,
  type ModelInfo,
} from "./api";
import { useEvents, type ServerEvent } from "./useEvents";
import { termBus } from "./termBus";
import { Login } from "./components/Login";
import { ChatPanel } from "./components/ChatPanel";
import { Sidebar } from "./components/Sidebar";
import { FilesPanel } from "./components/FilesPanel";
import { GitPanel } from "./components/GitPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { TerminalPanel } from "./components/TerminalPanel";
import { Icon, type IconName } from "./components/Icon";

type Tab = "chat" | "files" | "git" | "terminal" | "settings";

const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "files", label: "Files", icon: "files" },
  { id: "git", label: "Git", icon: "git" },
  { id: "terminal", label: "Terminal", icon: "terminal" },
  { id: "settings", label: "Settings", icon: "settings" },
];

// Workspace-scoped tabs share the workspace sidebar; Settings does not.
const WS_TABS: Tab[] = ["chat", "files", "git", "terminal"];

// Turn a workspace URI ("file:///Users/x/proj") into a filesystem path.
function uriToPath(uri: string | null): string | null {
  if (!uri) return null;
  if (uri === "__none__") return null;
  try {
    return decodeURIComponent(uri.replace(/^file:\/\//, ""));
  } catch {
    return uri.replace(/^file:\/\//, "");
  }
}

const EMPTY_STATE: ChatState = {
  cascadeId: "",
  generating: false,
  statusText: "Idle",
  messages: [],
};

export function App() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // When a chat file-link is clicked, jump to the Files tab and open this path.
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);

  const [state, setState] = useState<ChatState>(EMPTY_STATE);
  const [trajectories, setTrajectories] = useState<Trajectory[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [wsFolders, setWsFolders] = useState<{ name: string; path: string }[]>([]);
  const [error, setError] = useState<string>("");
  const [stats, setStats] = useState<any>(null);
  // Workspace-first: no conversation is shown until the user picks a workspace.
  const [activeWs, setActiveWs] = useState<string | null>(null);
  // True right after "New chat" until the real trajectory appears — used to
  // show a placeholder entry in the conversation list.
  const [pendingChat, setPendingChat] = useState(false);
  // The workspace the IDE currently has open (file path), from the backend.
  const [currentWsPath, setCurrentWsPath] = useState<string | null>(null);
  // When switching the IDE to another workspace, show a blocking popup until the
  // IDE reloads and reconnects. Holds the target workspace name (null = hidden).
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  // Only auto-select the IDE's open workspace once (on first load).
  const autoSelectedWs = useRef(false);

  // Probe auth on load without loading any conversation — the user must pick a
  // workspace first (workspace-first UX).
  useEffect(() => {
    (async () => {
      try {
        await api.trajectories();
        setAuthed(true);
      } catch (e) {
        if (e instanceof UnauthorizedError) setAuthed(false);
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  const refreshAux = useCallback(async () => {
    try {
      const [t, m, wf] = await Promise.all([
        api.trajectories(),
        api.models(),
        api.workspaceFolders().catch(() => null),
      ]);
      setTrajectories(t.list ?? []);
      setModels(m.models ?? []);
      setWsFolders(wf?.folders ?? []);
      setCurrentWsPath(wf?.current ?? null);
      // On first load, auto-select the workspace the IDE currently has open so
      // the user lands in the right project without a manual pick.
      if (wf?.current && !autoSelectedWs.current) {
        autoSelectedWs.current = true;
        setActiveWs((cur) => cur ?? "file://" + wf.current);
      }
      // If we were waiting for the IDE to switch workspaces and it now reports
      // the target (or simply reconnected with a workspace), close the popup.
      if (wf?.current) {
        setSwitchingTo((cur) => (cur ? null : cur));
      }
    } catch (e) {
      if (e instanceof UnauthorizedError) setAuthed(false);
    }
  }, []);

  useEffect(() => {
    if (authed) refreshAux();
  }, [authed, refreshAux]);

  // While switching the IDE to another workspace, the window reloads and drops
  // the SSE stream — poll workspaceFolders until it comes back, then close the
  // popup (refreshAux clears `switchingTo` once a workspace is reported).
  useEffect(() => {
    if (!switchingTo) return;
    const iv = setInterval(() => {
      refreshAux().catch(() => {});
    }, 1500);
    return () => clearInterval(iv);
  }, [switchingTo, refreshAux]);

  const onEvent = useCallback((e: ServerEvent) => {
    if (e.type === "state") {
      setState(e.state);
      // Once a real cascade id shows up, the pending placeholder is no longer
      // needed (the trajectory now exists and will appear in the list).
      if (e.state.cascadeId) setPendingChat(false);
    } else if (e.type === "state_update") {
      setState((prev) => {
        if (!prev || prev.cascadeId !== e.cascadeId || prev.messages.length === 0) return prev;
        const newMsgs = [...prev.messages];
        newMsgs[newMsgs.length - 1] = e.lastMessage;
        return { ...prev, messages: newMsgs, generating: e.generating, statusText: e.statusText };
      });
    } else if (e.type === "status") {
      setState((prev) => ({
        ...prev,
        cascadeId: e.cascadeId,
        generating: e.generating,
        statusText: e.statusText,
      }));
    } else if (e.type === "trajectories") {
      setTrajectories(e.list);
    } else if (
      e.type === "term-data" ||
      e.type === "term-exit" ||
      e.type === "term-list"
    ) {
      // Terminal frames are forwarded to the TerminalPanel via a small bus.
      termBus.emit(e);
    } else if (e.type === "stats_update" && (e as any).stats) {
      setStats((e as any).stats);
    }
  }, []);

  useEvents(onEvent, authed);

  const handleLogin = async (password: string): Promise<boolean> => {
    const ok = await api.login(password);
    if (ok) {
      setAuthed(true);
      const s = await api.state();
      setState(s);
    }
    return ok;
  };

  const send = async (text: string, images?: string[]) => {
    setError("");
    try {
      await api.send(text, images);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  const newChat = async () => {
    // Jump to an empty chat view immediately and show a placeholder in the list
    // (Antigravity doesn't create the trajectory until the first message is
    // sent, so we display a pending entry until it appears).
    setTab("chat");
    // If the selected workspace isn't the one the IDE has open, switch first
    // (reloads the window) — show the blocking popup until it reconnects.
    const targetPath = uriToPath(activeWs);
    if (targetPath && currentWsPath && targetPath !== currentWsPath) {
      setSwitchingTo(targetPath.split("/").pop() || targetPath);
      await api.openWorkspace(targetPath);
      return; // window reloads; refreshAux closes the popup on reconnect
    }
    setState(EMPTY_STATE);
    setPendingChat(true);
    await api.newChat();
    await refreshAux();
  };

  const switchCascade = async (id: string, wsUri?: string, wsName?: string) => {
    // Clicking a conversation always jumps to the chat view.
    setTab("chat");
    // If the conversation belongs to a workspace the IDE doesn't currently have
    // open, switch the IDE to it first — this reloads the window, so we show a
    // blocking loading popup that auto-closes when the IDE reconnects.
    const targetPath = uriToPath(wsUri ?? null);
    if (targetPath && currentWsPath && targetPath !== currentWsPath) {
      setSwitchingTo(wsName || targetPath.split("/").pop() || targetPath);
      await api.openWorkspace(targetPath);
      return; // window reloads; refreshAux will close the popup on reconnect
    }
    const s = await api.state(id);
    setState(s);
    await api.switchCascade(id);
  };

  // Selecting a workspace loads its conversations; deselecting clears the view.
  const selectWorkspace = (uri: string | null) => {
    setActiveWs(uri);
    setState(EMPTY_STATE);
  };

  const selectModel = async (id: string) => {
    setModels((prev) =>
      prev.map((m) => ({ ...m, selected: m.id === id }))
    );
    try {
      await api.selectModel(id);
      await refreshAux();
    } catch {
      /* ignore */
    }
  };

  // Open a file (from a chat file-link or plan reference) in the Files tab.
  // We pass the absolute path down; FilesPanel resolves + loads it.
  const openFileInFiles = (path: string) => {
    setOpenFilePath(path);
    setTab("files");
  };

  if (checking) {
    return <div className="center muted">Loading…</div>;
  }
  if (!authed) {
    return <Login onLogin={handleLogin} />;
  }

  const wsTab = WS_TABS.includes(tab);
  const cwd = uriToPath(activeWs);

  // Prompt shown by workspace-scoped tabs when no workspace is picked yet.
  const pickPrompt = (
    <div className="chat">
      <div className="empty-chat">
        <Icon name="folder" size={40} className="empty-icon" />
        <p>Chọn một workspace ở menu bên trái để bắt đầu.</p>
        <button
          className="ghost icon-btn menu-open-btn"
          onClick={() => setSidebarOpen(true)}
        >
          <Icon name="menu" size={16} /> <span>Mở danh sách workspace</span>
        </button>
      </div>
    </div>
  );

  // The content of the currently-active workspace-scoped tab.
  const renderWsContent = () => {
    if (!activeWs) return pickPrompt;
    return (
      <>
        <div style={{ display: tab === "chat" ? "contents" : "none" }}>
          <ChatPanel
            state={state}
            models={models}
            onSend={send}
            onCancel={() => {
              api.cancel();
            }}
            onRevert={(stepIndex: number) => {
              api.revert(stepIndex);
            }}
            onSelectModel={selectModel}
            onSlashCommand={(name, modelFacingText, text) => {
              setPendingChat(false);
              api.slashCommand(name, modelFacingText, text);
            }}
            onApprovePlan={(artifactUri, approved) => {
              api.approvePlan(artifactUri, approved);
            }}
            onAnswerQuestion={(stepIndex, answers) => {
              api.answerQuestion(stepIndex, answers);
            }}
            onSkipQuestion={(stepIndex) => {
              api.skipQuestion(stepIndex);
            }}
            onOpenFile={(path) => openFileInFiles(path)}
          />
        </div>
        <div style={{ display: tab === "files" ? "contents" : "none" }}>
          <FilesPanel
            openPath={openFilePath}
            onConsumeOpenPath={() => setOpenFilePath(null)}
          />
        </div>
        <div style={{ display: tab === "git" ? "contents" : "none" }}>
          <GitPanel />
        </div>
        <div style={{ display: tab === "terminal" ? "contents" : "none" }}>
          <TerminalPanel cwd={cwd} />
        </div>
      </>
    );
  };

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="ghost icon-btn menu-btn"
          aria-label="Workspaces"
          onClick={() => setSidebarOpen((v) => !v)}
          disabled={!wsTab}
        >
          <Icon name="menu" size={18} />
        </button>
        <div className="brand">
          <Icon name="bot" size={18} className="brand-icon" />
          <span className="brand-text">Remote Plus</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
              title={t.label}
            >
              <Icon name={t.icon} size={15} />
              <span className="tab-label">{t.label}</span>
            </button>
          ))}
        </nav>
      </header>

      {error && <div className="errbar">{error}</div>}

      <div className="body">
        <div style={{ display: wsTab ? "contents" : "none" }}>
          {sidebarOpen && (
            <div
              className="sidebar-overlay"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <div className={"sidebar-wrap" + (sidebarOpen ? " open" : "")}>
            <Sidebar
              trajectories={trajectories}
              wsFolders={wsFolders}
              activeId={state.cascadeId}
              activeWs={activeWs}
              pendingChat={pendingChat}
              onSelectWs={(ws) => selectWorkspace(ws)}
              onSwitch={(id, wsUri, wsName) => {
                switchCascade(id, wsUri, wsName);
                setSidebarOpen(false);
              }}
              onNewChat={() => {
                newChat();
                setSidebarOpen(false);
              }}
              onOpenWorkspace={(path) => {
                api.openWorkspace(path);
              }}
              onRefresh={refreshAux}
            />
          </div>
          {renderWsContent()}
        </div>
        <div style={{ display: !wsTab ? "contents" : "none" }}>
          <SettingsPanel externalStats={stats} />
        </div>
      </div>

      {switchingTo && (
        <div className="switch-overlay">
          <div className="switch-modal">
            <Icon name="spinner" size={26} className="spin" />
            <div className="switch-text">
              Đang chuyển sang workspace <strong>{switchingTo}</strong>…
            </div>
            <div className="switch-hint">
              IDE đang tải lại. Cửa sổ sẽ tự đóng khi kết nối lại.
            </div>
            <button className="ghost sm" onClick={() => setSwitchingTo(null)}>
              <Icon name="close" size={14} /> <span>Đóng</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
