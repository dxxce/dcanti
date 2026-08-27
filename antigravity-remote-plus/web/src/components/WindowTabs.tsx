import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import type { IdeWindowInfo } from "../api";

interface Props {
  windows: IdeWindowInfo[];
  activeWindowId: string | null;
  onSelectWindow: (windowId: string) => void;
  onRefresh: () => void;
}

export function WindowTabs({
  windows,
  activeWindowId,
  onSelectWindow,
  onRefresh,
}: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const activeWin = windows.find((w) => w.id === activeWindowId) || windows[0];

  // Close dropdown on click outside or Escape
  useEffect(() => {
    if (!dropdownOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dropdownOpen]);

  if (windows.length === 0) return null;

  const isGen = activeWin?.isGenerating;
  const activeStatusClass = isGen
    ? "status-generating"
    : activeWin?.statusText && activeWin.statusText !== "Idle"
    ? "status-busy"
    : "status-idle";

  return (
    <div className="window-manager-container">
      {/* Active Window Capsule Button (Compact on Mobile, expandable on Desktop) */}
      <button
        ref={triggerRef}
        className={`active-window-capsule ${isGen ? "pulse-border" : ""} ${
          dropdownOpen ? "open" : ""
        }`}
        onClick={() => setDropdownOpen((v) => !v)}
        title={`Cửa sổ IDE hiện tại: ${activeWin?.workspaceName || activeWin?.title || "Window"}\nBấm để chọn cửa sổ khác (${windows.length} cửa sổ online)`}
        aria-label="Chọn cửa sổ Antigravity IDE"
        aria-haspopup="dialog"
        aria-expanded={dropdownOpen}
      >
        <span className={`window-status-dot ${activeStatusClass}`} />
        <span className="capsule-title">
          {activeWin?.workspaceName || activeWin?.title || "IDE Window"}
        </span>
        {windows.length > 1 && (
          <span className="window-badge-count">{windows.length}</span>
        )}
        <Icon
          name="chevronDown"
          size={13}
          className={`capsule-chev ${dropdownOpen ? "rotated" : ""}`}
        />
      </button>

      {/* Desktop Quick Tabs (Hidden on Mobile, shown on Desktop when multiple windows exist) */}
      {windows.length > 1 && (
        <div className="desktop-window-pills" role="tablist">
          {windows.map((win) => {
            const isActive = win.id === activeWindowId;
            const winGen = win.isGenerating;
            const statusClass = winGen
              ? "status-generating"
              : win.statusText && win.statusText !== "Idle"
              ? "status-busy"
              : "status-idle";

            return (
              <button
                key={win.id}
                role="tab"
                aria-selected={isActive}
                className={`desktop-pill-tab ${isActive ? "active" : ""} ${
                  winGen ? "pulse-border" : ""
                }`}
                onClick={() => onSelectWindow(win.id)}
                title={`${win.title} (${win.workspacePath || "No path"})\n${
                  winGen ? "AI đang sinh mã..." : win.statusText || "Idle"
                }`}
              >
                <span className={`window-status-dot ${statusClass}`} />
                <span className="pill-title">{win.workspaceName || win.title}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Window Switcher Modal / Dropdown Dialog */}
      {dropdownOpen &&
        createPortal(
          <div
            className="window-dropdown-backdrop"
            onClick={() => setDropdownOpen(false)}
          >
            <div
              className="window-dropdown-card"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="window-dropdown-header">
                <div className="window-dropdown-title">
                  <Icon name="server" size={16} />
                  <span>Danh sách Cửa sổ IDE ({windows.length})</span>
                </div>
                <div className="window-dropdown-header-actions">
                  <button
                    className="ghost icon-btn sm"
                    onClick={() => {
                      onRefresh();
                    }}
                    title="Làm mới danh sách"
                  >
                    <Icon name="refresh" size={14} />
                  </button>
                  <button
                    className="ghost icon-btn sm"
                    onClick={() => setDropdownOpen(false)}
                    title="Đóng"
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              </div>

              <div className="window-dropdown-list">
                {windows.map((win) => {
                  const isSelected = win.id === activeWindowId;
                  const winGen = win.isGenerating;
                  const statusClass = winGen
                    ? "status-generating"
                    : win.statusText && win.statusText !== "Idle"
                    ? "status-busy"
                    : "status-idle";

                  const statusLabel = winGen
                    ? "AI đang sinh mã (Thinking/Generating)"
                    : win.statusText && win.statusText !== "Idle"
                    ? win.statusText
                    : "Sẵn sàng (Idle)";

                  return (
                    <div
                      key={win.id}
                      className={`window-dropdown-item ${
                        isSelected ? "active" : ""
                      }`}
                      onClick={() => {
                        onSelectWindow(win.id);
                        setDropdownOpen(false);
                      }}
                    >
                      <div className="window-item-left">
                        <span className={`window-status-dot ${statusClass}`} />
                      </div>
                      <div className="window-item-main">
                        <div className="window-item-top">
                          <span className="window-item-name">
                            {win.workspaceName || win.title || "Window"}
                          </span>
                          {isSelected && (
                            <span className="window-active-tag">Đang mở</span>
                          )}
                        </div>
                        <div className="window-item-sub">
                          <span className="window-item-path" title={win.workspacePath || ""}>
                            {win.workspacePath || "Không có thư mục"}
                          </span>
                        </div>
                        <div className="window-item-status">
                          <span className="status-text">{statusLabel}</span>
                          {win.pid && <span className="pid-text">PID: {win.pid}</span>}
                        </div>
                      </div>
                      <div className="window-item-action">
                        {isSelected ? (
                          <span className="check-icon">
                            <Icon name="check" size={16} />
                          </span>
                        ) : (
                          <button className="ghost sm">Chọn</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="window-dropdown-footer">
                <span className="footer-hint">
                  Mọi cửa sổ Antigravity IDE mở trên máy sẽ tự động xuất hiện ở đây và dùng chung 1 server.
                </span>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
