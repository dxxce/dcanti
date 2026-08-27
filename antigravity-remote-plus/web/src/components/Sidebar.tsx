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
  key: string; // workspace URI (file://…) or "__none__"
  name: string;
  path: string | null; // absolute fs path if known (from root scan)
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

export function Sidebar({
  trajectories,
  wsFolders,
  windows = [],
  activeWindowId,
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

  // ---- Workspace list view ----
  if (!current) {
    return (
      <aside className="sidebar">
        <div className="side-actions">
          <div className="side-title">
            <Icon name="folder" size={15} /> <span>Workspaces</span>
          </div>
          <button
            className="ghost icon-btn"
            onClick={() => setShowCreateModal(true)}
            title="Tạo workspace mới"
          >
            <Icon name="plus" size={16} />
          </button>
          <button className="ghost icon-btn" onClick={() => onRefresh()} title="Làm mới">
            <Icon name="refresh" size={16} />
          </button>
        </div>

        <div className="side-body">
          {/* Live Open IDE Windows */}
          {windows.length > 1 && (
            <div className="sidebar-windows-section">
              <div className="side-section-header">
                <Icon name="server" size={13} />
                <span>IDE đang mở ({windows.length})</span>
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

          {workspaces.length === 0 && (
            <div className="side-empty">
              Chưa có workspace. Đặt "Thư mục chứa workspace" trong Cài đặt.
            </div>
          )}
          <ul className="ws-list">
            {workspaces.map((w) => (
              <li key={w.key}>
                <button className="ws-pick" onClick={() => onSelectWs(w.key)}>
                  <Icon name="folder" size={16} className="folder" />
                  <span className="ws-name">{w.name}</span>
                  {w.items.length > 0 && (
                    <span className="ws-count">{w.items.length}</span>
                  )}
                  <Icon name="chevronRight" size={14} className="chev" />
                </button>
              </li>
            ))}
          </ul>
        </div>
        {showCreateModal && createPortal(
          <div className="modal-overlay">
            <div className="modal-content">
              <h3>Tạo Workspace Mới</h3>
              <input
                type="text"
                autoFocus
                placeholder="Nhập tên thư mục..."
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
        <div className="side-title" title={current.key}>
          <span className="ws-name">{current.name}</span>
        </div>
        <button className="ghost icon-btn" onClick={() => onRefresh()} title="Làm mới">
          <Icon name="refresh" size={16} />
        </button>
      </div>

      <div className="side-actions no-top">
        <button
          className="primary icon-btn full"
          onClick={() => {
            if (current.path) onOpenWorkspace(current.path);
            onNewChat();
          }}
        >
          <Icon name="plus" size={16} /> <span>Hội thoại mới</span>
        </button>
      </div>

      <div className="side-body">
        {current.items.length === 0 && !pendingChat && (
          <div className="side-empty">Chưa có hội thoại. Tạo mới ở trên.</div>
        )}
        <ul className="conv-list flush">
          {pendingChat && (
            <li className="conv-item active pending">
              <span className="dot-status" />
              <div className="conv-main">
                <div className="conv-title">Hội thoại mới</div>
                <div className="conv-sub">Chưa có tin nhắn</div>
              </div>
            </li>
          )}
          {current.items.map((t) => {
            const running = String(t.status ?? "")
              .toUpperCase()
              .includes("RUNNING");
            return (
              <li
                key={t.id}
                className={"conv-item" + (t.id === activeId ? " active" : "")}
                onClick={() => onSwitch(t.id, current.key, current.name)}
                title={t.title || t.id}
              >
                <span className={"dot-status" + (running ? " run" : "")} />
                <div className="conv-main">
                  <div className="conv-title">
                    {t.title || "Cuộc trò chuyện mới"}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
