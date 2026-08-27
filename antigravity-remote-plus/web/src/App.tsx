import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  UnauthorizedError,
  type ChatState,
  type Trajectory,
  type ModelInfo,
  type IdeWindowInfo,
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
import { WindowTabs } from "./components/WindowTabs";
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

function getInitialWindow(list: IdeWindowInfo[]): IdeWindowInfo {
  const savedId = localStorage.getItem("arp_active_window_id");
  const savedPath = localStorage.getItem("arp_active_window_path");
  if (savedId) {
    const byId = list.find((w) => w.id === savedId);
    if (byId) return byId;
  }
  if (savedPath) {
    const byPath = list.find((w) => w.workspacePath === savedPath);
    if (byPath) return byPath;
  }
  return list.find((w) => w.isHost) || list[0];
}

export function App() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);

  // Multi-window state
  const [windows, setWindows] = useState<IdeWindowInfo[]>([]);
  const windowsRef = useRef<IdeWindowInfo[]>([]);
  windowsRef.current = windows;

  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const activeWindowIdRef = useRef<string | null>(null);
  activeWindowIdRef.current = activeWindowId;

  const [state, setState] = useState<ChatState>(EMPTY_STATE);
  const [trajectories, setTrajectories] = useState<Trajectory[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [wsFolders, setWsFolders] = useState<{ name: string; path: string }[]>([]);
  const [error, setError] = useState<string>("");
  const [stats, setStats] = useState<any>(null);
  const [activeWs, setActiveWs] = useState<string | null>(null);
  const [pendingChat, setPendingChat] = useState(false);
  const [currentWsPath, setCurrentWsPath] = useState<string | null>(null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const autoSelectedWs = useRef(false);

  // Probe auth on load
  useEffect(() => {
    (async () => {
      try {
        // Probe auth first with an unswallowed API call
        const sRes = await api.state();
        setAuthed(true);

        const winRes = await api.windows().catch(() => null);
        if (winRes?.windows && winRes.windows.length > 0) {
          setWindows(winRes.windows);
          const initialWin = getInitialWindow(winRes.windows);
          setActiveWindowId(initialWin.id);
          api.setWindowId(initialWin.id);
          if (initialWin.workspacePath) {
            setActiveWs("file://" + initialWin.workspacePath);
          }
        }
        const tRes = await api.trajectories().catch(() => ({ list: [] }));
        setTrajectories(tRes.list);
        if (sRes && sRes.cascadeId && sRes.messages && sRes.messages.length > 0) {
          setState(sRes);
        } else if (tRes.list && tRes.list.length > 0) {
          const topTraj = tRes.list[0];
          api.state(topTraj.id).then((s) => {
            if (s && s.cascadeId) setState(s);
          }).catch(() => {});
        }
      } catch (e) {
        setAuthed(false);
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  const refreshAux = useCallback(async () => {
    try {
      const [winRes, t, m, wf, s, liveState] = await Promise.all([
        api.windows().catch(() => null),
        api.trajectories().catch(() => ({ list: [] })),
        api.models().catch(() => ({ models: [] })),
        api.workspaceFolders().catch(() => ({ folders: [] })),
        api.stats().catch(() => null),
        api.state().catch(() => null),
      ]);
      if (winRes?.windows) {
        setWindows(winRes.windows);
      }
      setTrajectories(t.list);
      setModels(m.models);
      setWsFolders(wf.folders);
      if (s) setStats(s);
      if (liveState && liveState.cascadeId) {
        setState((prev) => {
          if (!prev.cascadeId || prev.cascadeId === liveState.cascadeId) {
            return liveState;
          }
          return prev;
        });
      }
    } catch {
      /* non-fatal */
    }
  }, []);

  // Fetch current workspace path from IDE to auto-select sidebar workspace
  useEffect(() => {
    let mounted = true;
    api
      .workspace()
      .then((res) => {
        if (!mounted || !res) return;
        const curPath = (res as any).path || res.current;
        if (curPath) setCurrentWsPath(curPath);
        if (switchingTo && curPath && curPath.endsWith(switchingTo)) {
          setSwitchingTo(null);
        }
        if (!autoSelectedWs.current && curPath) {
          autoSelectedWs.current = true;
          setActiveWs("file://" + curPath);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [activeWindowId]);

  useEffect(() => {
    if (authed) refreshAux();
  }, [authed, refreshAux]);

  // Switch active IDE window
  const handleSelectWindow = async (windowId: string) => {
    setActiveWindowId(windowId);
    activeWindowIdRef.current = windowId;
    api.setWindowId(windowId);
    localStorage.setItem("arp_active_window_id", windowId);
    
    // Find window to update workspace selection
    const targetWin = windowsRef.current.find((w) => w.id === windowId);
    if (targetWin?.workspacePath) {
      localStorage.setItem("arp_active_window_path", targetWin.workspacePath);
      setActiveWs("file://" + targetWin.workspacePath);
    }

    // Immediately fetch active chat for this newly selected window
    try {
      const [sRes, tRes] = await Promise.all([
        api.state().catch(() => EMPTY_STATE),
        api.trajectories().catch(() => ({ list: [] })),
      ]);
      setTrajectories(tRes.list);
      if (sRes && sRes.cascadeId && sRes.messages && sRes.messages.length > 0) {
        setState(sRes);
      } else if (tRes.list && tRes.list.length > 0) {
        const topTraj = tRes.list[0];
        const s = await api.state(topTraj.id).catch(() => EMPTY_STATE);
        setState(s);
      } else {
        setState(EMPTY_STATE);
      }
    } catch {
      setState(EMPTY_STATE);
    }

    setTimeout(() => {
      refreshAux().catch(() => {});
    }, 50);
  };

  useEffect(() => {
    if (!switchingTo) return;
    const iv = setInterval(() => {
      refreshAux().catch(() => {});
    }, 1500);
    return () => clearInterval(iv);
  }, [switchingTo, refreshAux]);

  const onEvent = useCallback((e: ServerEvent) => {
    console.log("SSE EVENT:", e.type, e);
    const curActiveId = activeWindowIdRef.current;
    const curWindows = windowsRef.current;

    if (e.type === "windows") {
      setWindows(e.windows);
      windowsRef.current = e.windows;
      if (
        (!curActiveId || !e.windows.some((w) => w.id === curActiveId)) &&
        e.windows.length > 0
      ) {
        const nextWin = getInitialWindow(e.windows);
        setActiveWindowId(nextWin.id);
        activeWindowIdRef.current = nextWin.id;
        api.setWindowId(nextWin.id);
        if (nextWin.workspacePath) {
          setActiveWs("file://" + nextWin.workspacePath);
        }
      }
      return;
    }

    // Update generating state in windows array if windowId provided
    if (e.windowId) {
      setWindows((prev) =>
        prev.map((win) => {
          if (win.id !== e.windowId) return win;
          if (e.type === "state") {
            return {
              ...win,
              isGenerating: !!e.state.generating,
              statusText: e.state.statusText || "Idle",
              activeCascadeId: e.state.cascadeId,
            };
          }
          if (e.type === "state_update" || e.type === "status") {
            return {
              ...win,
              isGenerating: !!e.generating,
              statusText: e.statusText || "Idle",
              activeCascadeId: e.cascadeId,
            };
          }
          return win;
        })
      );
    }

    // If event belongs to another window when multiple windows exist, don't overwrite current view
    if (e.windowId && curActiveId && e.windowId !== curActiveId && curWindows.length > 1) {
      return;
    }

    if (e.type === "state") {
      setState(e.state);
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
      if (!e.generating) {
        api.models().then((r) => setModels(r.models)).catch(() => {});
      }
    } else if (e.type === "models") {
      setModels(e.models);
    } else if (e.type === "trajectories") {
      setTrajectories(e.list);
    } else if (
      e.type === "term-data" ||
      e.type === "term-exit" ||
      e.type === "term-list"
    ) {
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
      const winRes = await api.windows().catch(() => null);
      if (winRes?.windows && winRes.windows.length > 0) {
        setWindows(winRes.windows);
        const initialWin = getInitialWindow(winRes.windows);
        setActiveWindowId(initialWin.id);
        api.setWindowId(initialWin.id);
        if (initialWin.workspacePath) {
          setActiveWs("file://" + initialWin.workspacePath);
        }
      }
      const s = await api.state();
      setState(s);
    }
    return ok;
  };

  const send = async (text: string, images?: string[]) => {
    setError("");
    setPendingChat(false);
    setState((prev) => ({
      ...prev,
      generating: true,
      statusText: "Đang xử lý...",
    }));
    try {
      await api.send(text, images);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setState((prev) => ({ ...prev, generating: false, statusText: "Idle" }));
    }
  };

  const newChat = async () => {
    setTab("chat");
    const targetPath = uriToPath(activeWs);
    if (targetPath && currentWsPath && targetPath !== currentWsPath) {
      setSwitchingTo(targetPath.split("/").pop() || targetPath);
      await api.openWorkspace(targetPath);
      return;
    }
    setState(EMPTY_STATE);
    setPendingChat(true);
    await api.newChat();
    await refreshAux();
  };

  const switchCascade = async (id: string, wsUri?: string, wsName?: string) => {
    setTab("chat");
    const targetPath = uriToPath(wsUri ?? null);
    if (targetPath && currentWsPath && targetPath !== currentWsPath) {
      setSwitchingTo(wsName || targetPath.split("/").pop() || targetPath);
      await api.openWorkspace(targetPath);
      return;
    }
    const s = await api.state(id);
    setState(s);
    await api.switchCascade(id);
  };

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

  const pickPrompt = (
    <div className="chat">
      <div className="empty-chat">
        <Icon name="folder" size={40} className="empty-icon" />
        <p>Chọn một workspace ở menu bên trái hoặc chuyển đổi cửa sổ IDE ở thanh trên.</p>
        <button
          className="ghost icon-btn menu-open-btn"
          onClick={() => setSidebarOpen(true)}
        >
          <Icon name="menu" size={16} /> <span>Mở danh sách workspace</span>
        </button>
      </div>
    </div>
  );

  const renderWsContent = () => {
    return (
      <>
        <div style={{ display: tab === "chat" ? "contents" : "none" }}>
          <ChatPanel
            state={state}
            models={models}
            onSend={send}
            onCancel={async () => {
              setState((prev) => ({ ...prev, generating: false, statusText: "Idle" }));
              try {
                await api.cancel();
              } catch {}
            }}
            onRevert={async (stepIndex: number) => {
              await api.revert(stepIndex);
              const s = await api.state().catch(() => null);
              if (s && s.cascadeId) setState(s);
            }}
            onSelectModel={selectModel}
            onSlashCommand={(name, modelFacingText, text) => {
              setPendingChat(false);
              setState((prev) => ({
                ...prev,
                generating: true,
                statusText: "Đang xử lý...",
              }));
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
        <div className="topbar-left">
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
        </div>

        {windows.length > 0 && (
          <WindowTabs
            windows={windows}
            activeWindowId={activeWindowId}
            onSelectWindow={handleSelectWindow}
            onRefresh={refreshAux}
          />
        )}

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
              windows={windows}
              activeWindowId={activeWindowId}
              activeId={state.cascadeId}
              activeWs={activeWs}
              pendingChat={pendingChat}
              onSelectWs={(ws) => selectWorkspace(ws)}
              onSelectWindow={handleSelectWindow}
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
