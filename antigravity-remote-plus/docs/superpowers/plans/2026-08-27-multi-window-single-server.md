# Single Shared Server & Multi-Window Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow multiple Antigravity IDE instances to share a single port 7377 server without port collision, coordinate via internal WebSocket RPC, and provide a multi-window switcher interface in the Web UI.

**Architecture:** Primary Hub-and-Spoke model where the first IDE window hosts the HTTP/SSE/WebSocket server on port 7377. Secondary IDE instances connect to the Primary Hub via internal WebSocket RPC (`/api/ide-ws`). The Web UI displays a live Window Tabs Switcher in the top bar to seamlessly interact with any open IDE instance.

**Tech Stack:** Node.js, TypeScript, VS Code Extension API, ws (WebSocket), React 18, Vite, Vanilla CSS.

## Global Constraints
- Single server port: 7377 (or configured port), no EADDRINUSE errors when opening multiple IDE windows.
- Zero external daemon: Self-contained within extension instances with automatic failover election.
- Web UI multi-window switching: 1-click switch between open IDE windows with live generating/idle indicators.

---

### Task 1: Window Types & RPC Protocol Definitions
**Files:**
- Create: `src/windowTypes.ts`

**Interfaces:**
- Produces: `IdeWindowInfo`, `WindowRpcRequest`, `WindowRpcResponse`, `WindowEventMessage`

- [ ] **Step 1: Write `src/windowTypes.ts`** with full type definitions for window metadata, RPC requests, responses, and events.
- [ ] **Step 2: Verify type check passes** via `pnpm run build:ext`.

---

### Task 2: Implement `WindowManager` (Primary Hub Registry & Router)
**Files:**
- Create: `src/windowManager.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `IdeWindowInfo`, `WindowRpcRequest`, `WindowRpcResponse`
- Produces: `WindowManager` class with methods `registerLocal()`, `registerRemote()`, `unregister()`, `listWindows()`, `routeRpc()`, `broadcastEvent()`

- [ ] **Step 1: Write `src/windowManager.ts`** implementing window tracking, WebSocket server handling on `/api/ide-ws`, RPC request dispatching, and event broadcasting.
- [ ] **Step 2: Update `src/server.ts`** to integrate `WindowManager`, add `/api/windows` and `/api/health`, and route API calls by `windowId`.
- [ ] **Step 3: Test compilation** via `pnpm run build:ext`.

---

### Task 3: Implement `WindowClient` (Secondary Node Client & Failover)
**Files:**
- Create: `src/windowClient.ts`
- Modify: `src/extension.ts`

**Interfaces:**
- Consumes: `WindowManager`, `ChatController`, `FileController`, `GitController`, `TerminalController`
- Produces: `WindowClient` class connecting to `ws://127.0.0.1:7377/api/ide-ws`, executing local controllers on RPC calls, and triggering failover when host disconnects.

- [ ] **Step 1: Write `src/windowClient.ts`** implementing WebSocket connection, message handling, local RPC execution, and reconnect/failover logic.
- [ ] **Step 2: Update `src/extension.ts`** to probe port 7377 on startup, start as Primary if free or connect as Secondary if busy, and update the VS Code status bar.
- [ ] **Step 3: Test compilation** via `pnpm run build:ext`.

---

### Task 4: Frontend API & Multi-Window Components
**Files:**
- Create: `web/src/components/WindowTabs.tsx`
- Modify: `web/src/api.ts`
- Modify: `web/src/useEvents.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: `/api/windows`, `api.setWindowId(id)`, `windows` SSE event
- Produces: `WindowTabs` component and multi-window state orchestration in `App.tsx`.

- [ ] **Step 1: Update `web/src/api.ts` and `web/src/useEvents.ts`** to support `windowId` and handle `windows` events.
- [ ] **Step 2: Create `web/src/components/WindowTabs.tsx`** with live status indicator and tab switching.
- [ ] **Step 3: Update `web/src/App.tsx`** to orchestrate active window switching, auto-selecting available windows, and updating status.
- [ ] **Step 4: Update `web/src/styles.css`** with modern styles and responsive micro-animations for WindowTabs.
- [ ] **Step 5: Test Web build** via `pnpm run build:web`.

---

### Task 5: End-to-End Build & Package Verification
**Files:**
- Modify: `package.json` (if needed)

- [ ] **Step 1: Run full build** (`pnpm run build`).
- [ ] **Step 2: Run packaging** (`pnpm run package`).
- [ ] **Step 3: Verify `.vsix` bundle integrity**.
