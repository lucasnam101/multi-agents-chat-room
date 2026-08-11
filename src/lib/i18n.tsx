import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "vi";
const STORAGE_KEY = "agentchat-lang";

// App-chrome strings only — never applied to agent replies, session names,
// or any other user/agent-generated content, which stay whatever language
// they were written in.
const en = {
  "app.header.noRoomSelected": "No room selected",
  "app.header.room": "Room",
  "app.header.roomSettingsTitle": "Room settings",
  "app.header.general": "General",
  "app.header.generalSettingsTitle": "General settings",
  "app.empty.noSessions": "No conversations yet. Click + to create one.",
  "app.empty.noRoom": "Create or select a room to start chatting.",
  "app.confirm.deleteSession": "Delete this conversation? All chat history will be lost.",
  "app.confirm.deleteRoom": "Delete this room? All its conversations and history will be lost.",

  "room.new": "New room",
  "room.emptyLine1": "No rooms yet.",
  "room.emptyLine2": "Create a room to get started.",
  "room.pin": "Pin room",
  "room.unpin": "Unpin room",
  "room.moveUp": "Move room up",
  "room.moveDown": "Move room down",
  "room.delete": "Delete room",

  "approval.subtitle": "The agent is waiting for your choice before continuing.",

  "dialog.createRoom.title": "Create new room",
  "dialog.createRoom.subtitle": "A room is tied to one project folder on disk",
  "dialog.createRoom.submit": "Create room",
  "dialog.createRoom.nameLabel": "Room name",
  "dialog.createRoom.namePlaceholder": "e.g. Project ABC",
  "dialog.createRoom.folderLabel": "Project folder",
  "dialog.createRoom.folderPlaceholder": "No folder selected",
  "dialog.createRoom.choose": "Choose...",
  "common.cancel": "Cancel",
  "common.close": "Close",

  "session.selectPlaceholder": "Select a conversation",
  "session.new": "New conversation",
  "session.empty": "No conversations yet.",
  "session.rename": "Rename",
  "session.delete": "Delete conversation",

  "settings.tabs.general": "General",
  "settings.tabs.models": "Models",
  "settings.title": "General settings",
  "settings.subtitle": "Applies app-wide, can be overridden per room",
  "settings.section.appearance": "Appearance",
  "settings.themeLabel": "Light/dark mode",
  "settings.themeDark": "Dark — switch to light",
  "settings.themeLight": "Light — switch to dark",
  "settings.fontSizeLabel": "Message font size",
  "settings.fontSize.sm": "Small",
  "settings.fontSize.base": "Medium",
  "settings.fontSize.lg": "Large",
  "settings.section.language": "Language",
  "settings.languageLabel": "App language",
  "settings.section.contextBudget": "Context budget",
  "settings.contextBudgetLabel": "Trigger summarization above this",
  "settings.section.cliStatus": "CLI status",
  "settings.section.defaultModels": "Default model per agent",
  "settings.roomOverrideNote": "Can be overridden per room in \"Room settings\".",
  "settings.section.orchestrator": "Orchestrator agent (conversation summarizer)",
  "settings.orchestratorAgentLabel": "Agent",
  "settings.orchestratorModelLabel": "Model",

  "roomSettings.title": "Room settings",
  "roomSettings.subtitle": "Override the model for this room — leave blank to use the general setting",
  "roomSettings.claudeModelLabel": "Claude model for this room",
  "roomSettings.codexModelLabel": "Codex model for this room",
  "roomSettings.orchestratorModelLabel": "Orchestrator model for this room",
  "roomSettings.orchestratorNote": "Currently using the general orchestrator CLI: {kind} (change it in General settings).",

  "model.error": "Couldn't fetch model list (CLI not logged in?)",
  "model.loading": "Loading model list…",
  "model.adapterDefault": "(adapter default)",
  "status.checking": "checking…",
  "status.loggedIn": "logged in",
  "status.notLoggedIn": "not logged in",

  "chat.emptyLine1": "No messages yet. Mention",
  "chat.emptyOr": "or",
  "chat.emptySuffix": "to assign work, or just type to get a reply from the assistant.",
  "agents.running": "Agents running",
  "agents.paused": "Agents paused",
  "agents.stopTooltip": "Stop agents for this conversation",
  "agents.startTooltip": "Start agents for this conversation",
  "context.label": "Context",
  "context.tokens": "tokens",
  "composer.attachTooltip": "Attach image/file",
  "composer.placeholder": "Message... use @claude or @codex to assign work",
  "composer.send": "Send",
  "composer.stopTooltip": "Stop the agent's reply",

  "author.you": "You",
  "author.system": "System",
  "author.orchestrator": "Assistant",
  "badge.running": "running",
  "toolActivity.label": "tool activity",
  "tool.usingTool": "using a tool…",
  "tool.viewDetails": "{n} activities — view details",
  "tool.defaultName": "tool",

  "activity.titlePrefix": "Activity for",
  "activity.running": "running",
  "activity.done": "done",
  "activity.subtitle": "Observation only — not sent into the shared context",
  "activity.empty": "No activity recorded yet.",
  "activity.thinking": "thinking…",
  "activity.runningTool": "still running a tool…",
  "activity.replying": "replying…",

  "browser.openExternal": "Open in external browser",
  "browser.blockedMessage": "This page doesn't allow embedding inside the app.",

  "theme.toggleAria": "Toggle light/dark theme",
};

const vi: typeof en = {
  "app.header.noRoomSelected": "Chưa chọn phòng",
  "app.header.room": "Phòng",
  "app.header.roomSettingsTitle": "Cài đặt phòng",
  "app.header.general": "Chung",
  "app.header.generalSettingsTitle": "Cài đặt chung",
  "app.empty.noSessions": "Chưa có cuộc trò chuyện nào. Bấm + để tạo mới.",
  "app.empty.noRoom": "Tạo hoặc chọn một phòng để bắt đầu chat.",
  "app.confirm.deleteSession": "Xóa cuộc trò chuyện này? Toàn bộ lịch sử chat sẽ mất.",
  "app.confirm.deleteRoom": "Xóa phòng này? Toàn bộ cuộc trò chuyện và lịch sử trong phòng sẽ mất.",

  "room.new": "Phòng mới",
  "room.emptyLine1": "Chưa có phòng nào.",
  "room.emptyLine2": "Tạo phòng để bắt đầu.",
  "room.pin": "Ghim phòng",
  "room.unpin": "Bỏ ghim phòng",
  "room.moveUp": "Di chuyển phòng lên",
  "room.moveDown": "Di chuyển phòng xuống",
  "room.delete": "Xóa phòng",

  "approval.subtitle": "Agent đang chờ bạn lựa chọn để tiếp tục.",

  "dialog.createRoom.title": "Tạo phòng mới",
  "dialog.createRoom.subtitle": "Một phòng gắn với một thư mục dự án trên máy",
  "dialog.createRoom.submit": "Tạo phòng",
  "dialog.createRoom.nameLabel": "Tên phòng",
  "dialog.createRoom.namePlaceholder": "Ví dụ: Dự án ABC",
  "dialog.createRoom.folderLabel": "Thư mục dự án",
  "dialog.createRoom.folderPlaceholder": "Chưa chọn thư mục",
  "dialog.createRoom.choose": "Chọn...",
  "common.cancel": "Hủy",
  "common.close": "Đóng",

  "session.selectPlaceholder": "Chọn cuộc trò chuyện",
  "session.new": "Tạo cuộc trò chuyện mới",
  "session.empty": "Chưa có cuộc trò chuyện nào.",
  "session.rename": "Đổi tên",
  "session.delete": "Xóa cuộc trò chuyện",

  "settings.tabs.general": "Chung",
  "settings.tabs.models": "Model",
  "settings.title": "Cài đặt chung",
  "settings.subtitle": "Áp dụng cho toàn bộ ứng dụng, có thể ghi đè theo từng phòng",
  "settings.section.appearance": "Giao diện",
  "settings.themeLabel": "Chế độ sáng/tối",
  "settings.themeDark": "Đang tối — chuyển sang sáng",
  "settings.themeLight": "Đang sáng — chuyển sang tối",
  "settings.fontSizeLabel": "Cỡ chữ tin nhắn",
  "settings.fontSize.sm": "Nhỏ",
  "settings.fontSize.base": "Vừa",
  "settings.fontSize.lg": "Lớn",
  "settings.section.language": "Ngôn ngữ",
  "settings.languageLabel": "Ngôn ngữ ứng dụng",
  "settings.section.contextBudget": "Ngân sách ngữ cảnh",
  "settings.contextBudgetLabel": "Kích hoạt tóm tắt khi vượt ngưỡng",
  "settings.section.cliStatus": "Trạng thái CLI",
  "settings.section.defaultModels": "Model mặc định cho từng agent",
  "settings.roomOverrideNote": "Có thể ghi đè riêng cho từng phòng ở \"Cài đặt phòng\".",
  "settings.section.orchestrator": "Agent điều phối (tóm tắt hội thoại)",
  "settings.orchestratorAgentLabel": "Agent",
  "settings.orchestratorModelLabel": "Model",

  "roomSettings.title": "Cài đặt phòng",
  "roomSettings.subtitle": "Ghi đè model riêng cho phòng này — để trống để dùng cài đặt chung",
  "roomSettings.claudeModelLabel": "Model Claude cho phòng này",
  "roomSettings.codexModelLabel": "Model Codex cho phòng này",
  "roomSettings.orchestratorModelLabel": "Model điều phối (orchestrator) cho phòng này",
  "roomSettings.orchestratorNote": "Đang dùng CLI điều phối chung: {kind} (đổi ở Cài đặt chung).",

  "model.error": "Không lấy được danh sách model (CLI chưa đăng nhập?)",
  "model.loading": "Đang tải danh sách model…",
  "model.adapterDefault": "(mặc định của adapter)",
  "status.checking": "đang kiểm tra…",
  "status.loggedIn": "đã đăng nhập",
  "status.notLoggedIn": "chưa đăng nhập",

  "chat.emptyLine1": "Chưa có tin nhắn nào. Nhắn",
  "chat.emptyOr": "hoặc",
  "chat.emptySuffix": "để giao việc, hoặc nhắn trực tiếp để trợ lý trả lời.",
  "agents.running": "Agent đang chạy",
  "agents.paused": "Agent đang tạm dừng",
  "agents.stopTooltip": "Dừng agent của cuộc trò chuyện này",
  "agents.startTooltip": "Khởi động agent cho cuộc trò chuyện này",
  "context.label": "Ngữ cảnh",
  "context.tokens": "token",
  "composer.attachTooltip": "Đính kèm ảnh/file",
  "composer.placeholder": "Nhắn tin... dùng @claude hoặc @codex để giao việc",
  "composer.send": "Gửi",
  "composer.stopTooltip": "Dừng câu trả lời của agent",

  "author.you": "Bạn",
  "author.system": "Hệ thống",
  "author.orchestrator": "Trợ lý",
  "badge.running": "đang chạy",
  "toolActivity.label": "hoạt động công cụ",
  "tool.usingTool": "đang dùng công cụ…",
  "tool.viewDetails": "{n} hoạt động — xem chi tiết",
  "tool.defaultName": "công cụ",

  "activity.titlePrefix": "Hoạt động của",
  "activity.running": "đang chạy",
  "activity.done": "hoàn tất",
  "activity.subtitle": "Chỉ để quan sát — không gửi vào ngữ cảnh chung",
  "activity.empty": "Chưa có hoạt động nào được ghi nhận.",
  "activity.thinking": "đang suy nghĩ…",
  "activity.runningTool": "vẫn đang chạy công cụ…",
  "activity.replying": "đang trả lời…",

  "browser.openExternal": "Mở bằng trình duyệt ngoài",
  "browser.blockedMessage": "Trang này không cho phép hiển thị nhúng trong ứng dụng.",

  "theme.toggleAria": "Đổi giao diện sáng/tối",
};

const dict: Record<Lang, typeof en> = { en, vi };
export type TranslationKey = keyof typeof en;

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TranslationKey, vars?: Record<string, string>) => string;
}

const LangContext = createContext<LangContextValue>({
  lang: "en",
  setLang: () => {},
  t: (key) => dict.en[key] ?? key,
});

function getInitialLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "vi" ? "vi" : "en"; // default en
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(getInitialLang);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
  }, [lang]);

  function t(key: TranslationKey, vars?: Record<string, string>): string {
    let text = dict[lang][key] ?? dict.en[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replace(`{${name}}`, value);
      }
    }
    return text;
  }

  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}
