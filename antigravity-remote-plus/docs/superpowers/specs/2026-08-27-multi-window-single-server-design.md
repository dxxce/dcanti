# Thiết kế: Single Shared Server & Multi-Window Web UI cho Antigravity Remote Plus

## 1. Mục tiêu
1. **Dùng chung 1 Server duy nhất trên port 7377**:
   - Khi mở bao nhiêu cửa sổ Antigravity IDE (VS Code instances), chỉ có 1 HTTP/SSE server duy nhất chạy trên port cấu hình (mặc định 7377).
   - Không bị lỗi port đã được chạy (`EADDRINUSE`) khi mở nhiều cửa sổ.
   - Các cửa sổ IDE tiếp theo tự động kết nối vào server chính thông qua giao thức WebSocket nội bộ (Internal WebSocket RPC).
   - Hỗ trợ tự động chuyển giao quyền chủ (Failover/Leader Election) nếu cửa sổ IDE đang host server bị đóng.

2. **Giao diện Web UI hỗ trợ Nhiều Window IDE (Multi-Window Switcher)**:
   - Web UI hiển thị danh sách tất cả các Antigravity IDE Windows đang chạy dưới dạng các tab/thanh chọn cửa sổ (Window Tabs Switcher) ở thanh đầu trang.
   - Hiển thị trạng thái thời gian thực của từng cửa sổ (Idle, Generating, Running Tool/Terminal).
   - Nhấp vào bất kỳ cửa sổ nào sẽ đồng bộ ngay lập tức toàn bộ ngữ cảnh (Chat, Files, Git, Terminal, Models, Quota) của cửa sổ đó.
   - Danh sách cửa sổ tự động cập nhật khi có IDE mới mở hoặc đóng.

---

## 2. Kiến trúc Kỹ thuật

```
┌─────────────────────────────────────────────────────────────┐
│                       Trình duyệt Web                       │
│  [ Tab: Project-A (Active) ]  [ Tab: Project-B (Thinking) ] │
└──────────────▲──────────────────────────────▲───────────────┘
               │ HTTP API / SSE Events        │
               ▼                              │
┌──────────────────────────────┐              │
│    Primary IDE Window        │              │
│  (Host Server Port 7377)     │              │
│  - WindowManager             │              │
│  - HTTP/SSE/WebSocket Server │              │
│  - Local Controllers (A)     │              │
└──────────────▲───────────────┘              │
               │ Internal WS RPC (/api/ide-ws)│
               ▼                              ▼
┌──────────────────────────────┐ ┌───────────────────────────┐
│   Secondary IDE Window B     │ │  Secondary IDE Window C   │
│  - Client WS Connection      │ │  - Client WS Connection   │
│  - Local Controllers (B)     │ │  - Local Controllers (C)  │
└──────────────────────────────┘ └───────────────────────────┘
```

### 2.1. Cấu trúc Module mới & Cải tiến

1. **`src/windowManager.ts` (Mới)**:
   - Chạy trên Primary Server.
   - Quản lý danh sách các `IdeWindowSession` (cả cửa sổ cục bộ và các cửa sổ kết nối qua WebSocket).
   - Điều phối và chuyển tiếp các RPC request (`chat`, `files`, `git`, `terminals`, `models`, `quota`, `revert`, `answerQuestion`, v.v.) tới đúng cửa sổ theo `windowId`.
   - Thu thập và phát tán (broadcast) sự kiện từ mọi cửa sổ tới Web UI qua SSE (`/api/events`).

2. **`src/windowClient.ts` (Mới)**:
   - Chạy trên Secondary Window.
   - Kết nối tới `ws://127.0.0.1:7377/api/ide-ws`.
   - Lắng nghe RPC request từ server và gọi controller cục bộ trong cửa sổ của nó (`ChatController`, `FileController`, `GitController`, `TerminalController`), sau đó trả response về.
   - Bắn các sự kiện cục bộ (state updates, terminal frames) về Primary server.
   - Tự động phát hiện mất kết nối (khi Primary đóng) để thử khởi động server và nâng cấp thành Primary mới.

3. **`src/server.ts` (Cập nhật)**:
   - Tích hợp `ws.WebSocketServer` trên endpoint `/api/ide-ws` để nhận kết nối từ các Secondary windows.
   - API endpoints hỗ trợ `windowId` (từ query `?windowId=...`, header `x-window-id`, hoặc body).
   - Thêm endpoint `/api/windows` để lấy danh sách cửa sổ đang mở.
   - Route `/api/events` bắn thêm sự kiện `windows` cập nhật danh sách cửa sổ.

4. **`src/extension.ts` (Cập nhật)**:
   - Khởi tạo `windowId` duy nhất (dựa trên workspace name + hash/timestamp).
   - Kiểm tra port 7377 bằng health check probe:
     - Nếu port chưa chạy: Khởi động `RemoteServer` (Primary Hub) và đăng ký Local Window.
     - Nếu port đang chạy: Khởi tạo `WindowClient` (Secondary Node) và kết nối vào server.
   - Cập nhật Status Bar hiển thị đúng vai trò (Host vs Connected) và số lượng IDE đang kết nối.

---

## 3. Web UI: Multi-Window Experience

1. **Thanh Window Tabs (`web/src/components/WindowTabs.tsx`)**:
   - Nằm ngay thanh trên cùng (Top Bar / Sub-header).
   - Hiển thị danh sách các IDE Window đang mở:
     - Biểu tượng IDE / Folder.
     - Tên Workspace (ví dụ: `dcanti`, `my-web-app`).
     - Live Badge / Status Dot:
       - 🟢 Xanh lá: Idle (Sẵn sàng)
       - 🟡 Vàng nhấp nháy: Generating / Thinking (AI đang viết code)
       - 🔵 Xanh dương: Executing Tool / Running Command
     - Nút làm mới / chuyển đổi nhanh.
2. **Quản lý Context theo `activeWindowId`**:
   - `web/src/App.tsx`:
     - Lưu state `windows: IdeWindowInfo[]` và `activeWindowId: string`.
     - Tự động chọn window đầu tiên khi mở hoặc nhớ window đang active.
     - Mọi API call (`api.state`, `api.send`, `api.files`, `api.terminals`, `api.gitStatus`, v.v.) sẽ tự động truyền `windowId` tương ứng.
     - Sự kiện từ SSE sẽ lọc và cập nhật đúng cho cửa sổ đang xem hoặc cập nhật badge cho các cửa sổ nền.
3. **Cải tiến giao diện & phong cách hiện đại**:
   - Thiết kế glassmorphism sang trọng, các tab bo góc tinh tế, chuyển đổi mượt mà với hiệu ứng micro-animations.
   - Thân thiện trên cả máy tính và thiết bị di động (responsive dropdown khi màn hình nhỏ).

---

## 4. Kế hoạch Kiểm thử & Xác minh (Verification Plan)

1. **Khởi động cửa sổ IDE thứ 1**:
   - Kiểm tra server bind thành công port 7377, Web UI hiển thị Window 1.
2. **Khởi động thêm cửa sổ IDE thứ 2 (Workspace khác)**:
   - Kiểm tra cửa sổ 2 KHÔNG bị lỗi `EADDRINUSE`, kết nối thành công tới server.
   - Web UI tự động xuất hiện Tab thứ 2.
3. **Thao tác độc lập trên 2 cửa sổ từ Web UI**:
   - Chat trên Window 1 -> chỉ Window 1 nhận và sinh câu trả lời.
   - Mở file / terminal trên Window 2 -> chỉ Window 2 thực thi.
4. **Đóng cửa sổ Primary (Failover)**:
   - Cửa sổ Secondary tự động tiếp quản port 7377 và trở thành Primary.
   - Web UI tự động kết nối lại và duy trì hoạt động bình thường.
