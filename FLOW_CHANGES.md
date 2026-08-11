# Quy trình build & chạy lại app (Windows, máy này)

**Quan trọng — thứ tự bắt buộc:**

1. **Type-check trước khi build thật** (nhanh, phát hiện lỗi sớm):
   ```bash
   cd "D:\My projects\multi-agent-tool-v2" && npx tsc --noEmit
   cd "D:\My projects\multi-agent-tool-v2\src-tauri" && cargo check
   ```

2. **Kill app cũ trước khi build release** — nếu không, `cargo build --release` sẽ lỗi `Access is denied (os error 5)` vì Windows giữ lock file `.exe` đang chạy:
   ```bash
   tasklist | grep -i agentchat        # tìm PID
   taskkill //F //PID <pid>            # kill đúng PID — KHÔNG dùng `taskkill //F //IM agentchat.exe` (kill theo tên có thể kill nhầm process khác trùng tên)
   ```

3. **Build frontend rồi backend**:
   ```bash
   cd "D:\My projects\multi-agent-tool-v2" && npm run build
   cd "D:\My projects\multi-agent-tool-v2\src-tauri" && cargo build --release --features custom-protocol
   ```
   ⚠️ **Bắt buộc phải có `--features custom-protocol`**. Thiếu flag này, binary release sẽ cố load UI từ `127.0.0.1:1420` (Vite dev URL) thay vì asset đã build sẵn, và app sẽ crash/trắng màn hình ngay khi mở vì không có Vite server nào chạy.

4. **Chạy lại**:
   ```bash
   cd "D:\My projects\multi-agent-tool-v2\src-tauri" && ./target/release/agentchat.exe &
   sleep 2 && tasklist | grep -i agentchat   # xác nhận PID mới sống, không bị crash ngay
   ```

## Checklist kiểm tra sau khi build

- [ ] `cargo check` và `tsc --noEmit` sạch, không warning mới liên quan đến file đã sửa.
- [ ] Gửi 1 tin nhắn `@claude` hoặc `@codex`, quan sát nút Send đổi thành icon Pause (nền xám) trong lúc agent đang trả lời.
- [ ] Bấm nút Pause giữa lúc agent đang trả lời → bubble kết thúc ngay (nội dung dừng/lỗi), nhưng agent vẫn còn active (chỉ turn bị hủy, không phải cả session).
- [ ] Ở sidebar trái, bấm icon thùng rác trên 1 room → có confirm dialog → xác nhận thì room biến mất, và nếu room đó đang active thì UI chuyển sang room khác.
- [ ] Xóa room có session đang chạy agent xong, kiểm tra không có process ACP nào bị treo (không có `claude-agent-acp.cmd`/`codex-acp.cmd` mồ côi trong Task Manager).
