import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface Room {
  id: string;
  name: string;
  folder_path: string;
  pinned: boolean;
  sort_order: number;
}

export interface RoomAgentStatus {
  agent_kind: "claude" | "codex" | "grok";
  is_active: boolean;
  is_busy: boolean;
}

export interface Session {
  id: string;
  room_id: string;
  name: string;
}

export interface Attachment {
  kind: "image" | "file";
  name: string;
  mimeType: string | null;
  dataBase64: string | null;
  path: string | null;
}

export interface Message {
  id: number;
  session_id: string;
  author_kind: "user" | "claude" | "codex" | "grok" | "system" | "orchestrator";
  message_type: "chat" | "tool_call" | "tool_result" | "system_note";
  content: string;
  attachments: Attachment[];
  model: string | null;
}

export type AgentUpdate =
  | { kind: "message_chunk"; text: string }
  | { kind: "tool_call"; title: string; raw: unknown }
  | { kind: "tool_call_update"; raw: unknown }
  | { kind: "other"; update_type: string; raw: unknown };

export interface AgentUpdateEvent {
  session_id: string;
  message_id: number;
  agent_kind: "claude" | "codex" | "grok" | "orchestrator";
  update: AgentUpdate;
}

export interface ModelInfo {
  model_id: string;
  name: string | null;
}

export interface ModelSettings {
  claude_model: string | null;
  codex_model: string | null;
  grok_model: string | null;
  orchestrator_model: string | null;
}

export interface ContextUsage {
  used_tokens: number;
  budget_tokens: number;
}

export const api = {
  createRoom: (name: string, folderPath: string) =>
    invoke<Room>("create_room", { name, folderPath }),
  listRooms: () => invoke<Room[]>("list_rooms"),
  tagAgent: (roomId: string, agentKind: "claude" | "codex" | "grok") =>
    invoke<void>("tag_agent", { roomId, agentKind }),
  roomAgentStatuses: (roomId: string) =>
    invoke<RoomAgentStatus[]>("room_agent_statuses", { roomId }),
  setRoomPinned: (roomId: string, pinned: boolean) =>
    invoke<void>("set_room_pinned", { roomId, pinned }),
  reorderRooms: (roomIds: string[]) => invoke<void>("reorder_rooms", { roomIds }),
  deleteRoom: (roomId: string) => invoke<void>("delete_room", { roomId }),
  resolveApproval: (requestId: string, optionId: string) => invoke<void>("resolve_approval", { requestId, optionId }),

  listSessions: (roomId: string) => invoke<Session[]>("list_sessions", { roomId }),
  createSession: (roomId: string, name?: string) =>
    invoke<Session>("create_session", { roomId, name: name ?? null }),
  deleteSession: (sessionId: string) => invoke<void>("delete_session", { sessionId }),
  renameSession: (sessionId: string, name: string) => invoke<void>("rename_session", { sessionId, name }),
  ensureSessionAgents: (sessionId: string) => invoke<void>("ensure_session_agents", { sessionId }),
  stopSessionAgents: (sessionId: string) => invoke<void>("stop_session_agents", { sessionId }),
  cancelTurn: (sessionId: string) => invoke<void>("cancel_turn", { sessionId }),
  sessionAgentStatuses: (sessionId: string) =>
    invoke<RoomAgentStatus[]>("session_agent_statuses", { sessionId }),

  listMessages: (sessionId: string) => invoke<Message[]>("list_messages", { sessionId }),
  sendMessage: (sessionId: string, content: string, attachments: Attachment[] = []) =>
    invoke<Message>("send_message", { sessionId, content, attachments }),
  listRoomFiles: (roomId: string, query: string) =>
    invoke<string[]>("list_room_files", { roomId, query }),
  readFileAsBase64: (path: string) => invoke<string>("read_file_as_base64", { path }),

  checkCliStatus: (cli: "claude" | "codex" | "grok") => invoke<boolean>("check_cli_status", { cli }),
  getOrchestratorKind: () => invoke<"claude" | "codex">("get_orchestrator_kind"),
  setOrchestratorKind: (kind: "claude" | "codex") =>
    invoke<void>("set_orchestrator_kind", { kind }),

  listModels: (agentKind: "claude" | "codex" | "grok") => invoke<ModelInfo[]>("list_models", { agentKind }),
  getModelSettings: () => invoke<ModelSettings>("get_model_settings"),
  setModelSetting: (scope: "claude" | "codex" | "grok" | "orchestrator", model: string | null) =>
    invoke<void>("set_model_setting", { scope, model }),
  getRoomModel: (roomId: string, agentKind: "claude" | "codex" | "grok" | "orchestrator") =>
    invoke<string | null>("get_room_model", { roomId, agentKind }),
  setRoomModel: (roomId: string, agentKind: "claude" | "codex" | "grok" | "orchestrator", model: string | null) =>
    invoke<void>("set_room_model", { roomId, agentKind, model }),

  getContextBudget: () => invoke<number>("get_context_budget"),
  setContextBudget: (tokens: number) => invoke<void>("set_context_budget", { tokens }),
  getRoomContextUsage: (sessionId: string) => invoke<ContextUsage>("get_room_context_usage", { sessionId }),

  getChatFontSize: () => invoke<"sm" | "base" | "lg">("get_chat_font_size"),
  setChatFontSize: (size: "sm" | "base" | "lg") => invoke<void>("set_chat_font_size", { size }),
  openTerminal: (roomId: string) => invoke<void>("open_terminal", { roomId }),
};

export interface MessageUpdatedEvent {
  id: number;
  session_id: string;
  content: string;
  model?: string | null;
}

export function onMessageInserted(callback: (message: Message) => void) {
  return listen<Message>("message-inserted", (event) => callback(event.payload));
}

export function onMessageUpdated(callback: (payload: MessageUpdatedEvent) => void) {
  return listen<MessageUpdatedEvent>("message-updated", (event) => callback(event.payload));
}

export function onAgentUpdate(callback: (payload: AgentUpdateEvent) => void) {
  return listen<AgentUpdateEvent>("agent-update", (event) => callback(event.payload));
}

export interface SessionRenamedEvent {
  session_id: string;
  name: string;
}

export function onSessionRenamed(callback: (payload: SessionRenamedEvent) => void) {
  return listen<SessionRenamedEvent>("session-renamed", (event) => callback(event.payload));
}

export interface ApprovalRequest {
  request_id: string;
  session_id: string;
  agent_kind: "claude" | "codex" | "grok";
  title: string;
  options: Array<{ optionId: string; name?: string; description?: string }>;
}

export function onApprovalRequest(callback: (payload: ApprovalRequest) => void) {
  return listen<ApprovalRequest>("approval-request", (event) => callback(event.payload));
}
