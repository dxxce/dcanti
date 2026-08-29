import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api, type Trajectory, type IdeWindowInfo } from "../api";
import { Icon } from "./Icon";

export interface WsFolder {
  name: string;
  path: string;
}

interface Props {
  trajectories: Trajectory[];
  wsFolders: WsFolder[];
  windows?: IdeWindowInfo[];
  activeWindowId?: string | null;
  currentWsPath?: string | null;
  activeId: string;
  activeWs: string | null;
  pendingChat?: boolean;
  onSelectWs: (ws: string | null) => void;
  onSelectWindow?: (windowId: string) => void;
  onSwitch: (id: string, wsUri?: string, wsName?: string) => void | Promise<void>;
  onNewChat: () => void | Promise<void>;
  onOpenWorkspace: (path: string) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}

interface WsEntry {
  key: string;
  name: string;
  path: string | null;
  items: Trajectory[];
}

function pathToUri(p: string): string {
  return p.startsWith("file://") ? p : "file://" + p;
}

function normalizeKey(k?: string | null): string {
  if (!k || k === "__none__") return "__none__";
  try {
    return decodeURIComponent(k.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return k.replace(/\/+$/, "").toLowerCase();
  }
}

function buildWorkspaces(
  folders: WsFolder[],
  trajectories: Trajectory[]
): WsEntry[] {
  const map = new Map<string, WsEntry>();

  for (const f of folders) {
    const rawKey = pathToUri(f.path);
    const norm = normalizeKey(rawKey);
    map.set(norm, { key: rawKey, name: f.name, path: f.path, items: [] });
  }

  for (const t of trajectories) {
    const rawKey = t.workspaceUri || "__none__";
    const norm = normalizeKey(rawKey);
    let e = map.get(norm);
    if (!e) {
      const name =
        t.workspaceName ||
        (rawKey === "__none__"
          ? "Khác"
          : decodeURIComponent(rawKey.replace(/^file:\/\//, "").split("/").pop() || "Khác"));
      e = {
        key: rawKey,
        name,
        path: rawKey === "__none__" ? null : rawKey.replace(/^file:\/\//, ""),
        items: [],
      };
      map.set(norm, e);
    }
    if (!e.items.some((i) => i.id === t.id)) {
      e.items.push(t);
    }
  }

  return [...map.values()].sort((a, b) => {
    if (a.key === "__none__") return 1;
    if (b.key === "__none__") return -1;
    return a.name.localeCompare(b.name);
  });
}

function groupTrajectoriesByDate(items: Trajectory[]) {
  const groups: { [key: string]: Trajectory[] } = {
    "Hôm nay": [],
    "Hôm qua": [],
    "7 ngày trước": [],
    "Cũ hơn": [],
  };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const lastWeek = today - 7 * 86400000;

  for (const item of items) {
    if (!item.updatedAt) {
      groups["Cũ hơn"].push(item);
      continue;
    }
    const itemDate = new Date(item.updatedAt).getTime();
    if (isNaN(itemDate)) {
      groups["Cũ hơn"].push(item);
    } else if (itemDate >= today) {
      groups["Hôm nay"].push(item);
    } else if (itemDate >= yesterday) {
      groups["Hôm qua"].push(item);
    } else if (itemDate >= lastWeek) {
      groups["7 ngày trước"].push(item);
    } else {
      groups["Cũ hơn"].push(item);
    }
  }

  return Object.entries(groups).filter(([_, list]) => list.length > 0);
}

export function Sidebar({
  trajectories,
  wsFolders,
  windows = [],
  activeWindowId,
  currentWsPath,
  activeId,
  activeWs,
  pendingChat,
  onSelectWs,
  onSelectWindow,
  onSwitch,
  onNewChat,
  onOpenWorkspace,
  onRefresh,
}: Props) {
  const [wsSearch, setWsSearch] = useState("");
  const [chatSearch, setChatSearch] = useState("");

  const workspaces = useMemo(
    () => buildWorkspaces(wsFolders, trajectories),
    [wsFolders, trajectories]
  );
  const normActiveWs = normalizeKey(activeWs);
  const current = activeWs
    ? workspaces.find(
        (w) =>
          normalizeKey(w.key) === normActiveWs ||
          (w.path && normalizeKey("file://" + w.path) === normActiveWs)
      )
    : null;

  const isWorkspaceActive = (w: WsEntry) => {
    if (!currentWsPath) return false;
    const normCurrentPath = normalizeKey(currentWsPath);
    return (
      normalizeKey(w.key) === normalizeKey("file://" + currentWsPath) ||
      (w.path && normalizeKey(w.path) === normCurrentPath)
    );
  };

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    const name = newWsName.trim();
    if (!name) return;
    setIsCreating(true);
    const res = await api.createWorkspaceFolder(name).catch((e) => ({ ok: false, error: e.message }));
    setIsCreating(false);
    if (res.ok) {
      setShowCreateModal(false);
      setNewWsName("");
      onRefresh();
    } else {
      alert("Lỗi tạo thư mục: " + (res.error || "Không xác định"));
    }
  };

  const filteredWorkspaces = useMemo(() => {
    if (!wsSearch.trim()) return workspaces;
    const q = wsSearch.toLowerCase();
    return workspaces.filter(
      (w) => w.name.toLowerCase().includes(q) || (w.path && w.path.toLowerCase().includes(q))
    );
  }, [workspaces, wsSearch]);

  const filteredChats = useMemo(() => {
    if (!current) return [];
    if (!chatSearch.trim()) return current.items;
    const q = chatSearch.toLowerCase();
    return current.items.filter(
      (t) =>
        (t.title && t.title.toLowerCase().includes(q)) ||
        t.id.toLowerCase().includes(q)
    );
  }, [current, chatSearch]);

  const groupedChats = useMemo(
    () => groupTrajectoriesByDate(filteredChats),
    [filteredChats]
  );

  // ---- Workspace list view ----
  if (!current) {
    return (
      <aside className="sidebar">
        <div className="side-actions">
          <div className="side-title">
            <Icon name="folder" size={16} /> <span>Workspaces</span>
          </div>
          <button
            className="ghost icon-btn"
            onClick={() => setShowCreateModal(true)}
            title="Tạo workspace mới"
          >
            <Icon name="plus" size={15} />
          </button>
          <button className="ghost icon-btn" onClick={() => onRefresh()} title="Làm mới">
            <Icon name="refresh" size={15} />
          </button>
        </div>

        <div className="side-search-box">
          <Icon name="search" size={13} className="side-search-icon" />
          <input
            type="text"
            placeholder="Tìm kiếm workspace..."
            value={wsSearch}
            onChange={(e) => setWsSearch(e.target.value)}
          />
          {wsSearch && (
            <button className="ghost icon-btn sm" onClick={() => setWsSearch("")}>
              <Icon name="close" size={11} />
            </button>
          )}
        </div>

        <div className="side-body">
          {/* Live Open IDE Windows */}
          {windows.length > 1 && (
            <div className="sidebar-windows-section">
              <div className="side-section-header">
                <Icon name="server" size={13} />
                <span>Cửa sổ IDE đang mở ({windows.length})</span>
              </div>
              <ul className="ws-list live-win-list">
                {windows.map((win) => {
                  const isAct = win.id === activeWindowId;
                  const winGen = win.isGenerating;
                  const statusClass = winGen
                    ? "status-generating"
                    : win.statusText && win.statusText !== "Idle"
                    ? "status-busy"
                    : "status-idle";

                  return (
                    <li key={win.id}>
                      <button
                        className={`ws-pick live-win-pick ${isAct ? "active" : ""}`}
                        onClick={() => {
                          onSelectWindow?.(win.id);
                          if (win.workspacePath) {
                            onSelectWs("file://" + win.workspacePath);
                          }
                        }}
                      >
                        <span className={`window-status-dot ${statusClass}`} />
                        <span className="ws-name">{win.workspaceName || win.title}</span>
                        {win.isHost && <span className="window-host-tag">Host</span>}
                        {isAct && <span className="window-active-tag">Active</span>}
                        <Icon name="chevronRight" size={14} className="chev" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="side-divider" />
            </div>
          )}

          {filteredWorkspaces.length === 0 && (
            <div className="side-empty">
              {wsSearch ? "Không tìm thấy workspace nào phù hợp." : "Chưa có workspace. Đặt thư mục root trong Cài đặt."}
            </div>
          )}

          <ul className="ws-list">
            {filteredWorkspaces.map((w) => {
              const active = isWorkspaceActive(w);
              return (
                <li key={w.key}>
                  <button
                    className={`ws-pick ${active ? "ws-item-active" : ""}`}
                    onClick={() => onSelectWs(w.key)}
                    title={w.path || w.key}
                  >
                    <div className="ws-icon-wrap">
                      <Icon name="folder" size={16} className={active ? "accent-color" : "folder"} />
                    </div>
                    <div className="ws-info">
                      <span className="ws-name">{w.name}</span>
                      {w.path && <span className="ws-path-hint">{w.path.split("/").slice(-2).join("/")}</span>}
                    </div>
                    {active && <span className="ws-active-badge">Đang mở</span>}
                    {w.items.length > 0 && (
                      <span className="ws-count" title={`${w.items.length} phiên trò chuyện`}>
                        {w.items.length}
                      </span>
                    )}
                    <Icon name="chevronRight" size={13} className="chev" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {showCreateModal && createPortal(
          <div className="modal-overlay">
            <div className="modal-content">
              <h3>Tạo Workspace Mới</h3>
              <input
                type="text"
                autoFocus
                placeholder="Nhập tên thư mục dự án..."
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") setShowCreateModal(false);
                }}
                disabled={isCreating}
              />
              <div className="modal-actions">
                <button
                  className="ghost"
                  onClick={() => setShowCreateModal(false)}
                  disabled={isCreating}
                >
                  Hủy
                </button>
                <button
                  className="primary"
                  onClick={handleCreate}
                  disabled={!newWsName.trim() || isCreating}
                >
                  {isCreating ? "Đang tạo..." : "Tạo"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </aside>
    );
  }

  // ---- Conversation list for the selected workspace ----
  const currentIsActiveInIde = isWorkspaceActive(current);

  return (
    <aside className="sidebar">
      <div className="side-actions">
        <button
          className="ghost icon-btn back-btn"
          onClick={() => onSelectWs(null)}
          title="Quay lại danh sách workspace"
        >
          <Icon name="chevronLeft" size={16} />
        </button>
        <div className="side-title" title={current.path || current.key}>
          <span className="ws-name">{current.name}</span>
          {currentIsActiveInIde && <span className="ws-active-badge-sm">Đang mở</span>}
        </div>
        <button className="ghost icon-btn" onClick={() => onRefresh()} title="Làm mới">
          <Icon name="refresh" size={15} />
        </button>
      </div>

      <div className="side-actions no-top">
        <button
          className="primary icon-btn full new-chat-btn"
          onClick={() => {
            if (current.path) onOpenWorkspace(current.path);
            onNewChat();
          }}
        >
          <Icon name="plus" size={15} /> <span>Hội thoại mới</span>
        </button>
      </div>

      <div className="side-search-box">
        <Icon name="search" size={13} className="side-search-icon" />
        <input
          type="text"
          placeholder="Tìm lịch sử chat..."
          value={chatSearch}
          onChange={(e) => setChatSearch(e.target.value)}
        />
        {chatSearch && (
          <button className="ghost icon-btn sm" onClick={() => setChatSearch("")}>
            <Icon name="close" size={11} />
          </button>
        )}
      </div>

      <div className="side-body">
        {filteredChats.length === 0 && !pendingChat && (
          <div className="side-empty">
            {chatSearch ? "Không tìm thấy cuộc trò chuyện nào." : "Chưa có hội thoại nào trong workspace này."}
          </div>
        )}

        <div className="conv-grouped-container">
          {pendingChat && (
            <div className="conv-group">
              <div className="conv-group-title">Đang tạo</div>
              <ul className="conv-list flush">
                <li className="conv-item active pending">
                  <span className="dot-status run" />
                  <div className="conv-main">
                    <div className="conv-title">Hội thoại mới</div>
                    <div className="conv-sub">Sẵn sàng nhận câu hỏi...</div>
                  </div>
                </li>
              </ul>
            </div>
          )}

          {groupedChats.map(([groupName, items]) => (
            <div key={groupName} className="conv-group">
              <div className="conv-group-title">{groupName}</div>
              <ul className="conv-list flush">
                {items.map((t) => {
                  const running = String(t.status ?? "")
                    .toUpperCase()
                    .includes("RUNNING");
                  const isCur = t.id === activeId;
                  return (
                    <li
                      key={t.id}
                      className={`conv-item ${isCur ? "active" : ""}`}
                      onClick={() => onSwitch(t.id, current.key, current.name)}
                      title={t.title || t.id}
                    >
                      <span className={`dot-status ${running ? "run" : ""}`} />
                      <div className="conv-main">
                        <div className="conv-title">
                          {t.title || "Cuộc trò chuyện mới"}
                        </div>
                        {t.updatedAt && (
                          <div className="conv-sub">
                            {new Date(t.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

