import { useEffect, useState } from "react";
import { api } from "../lib/tauriApi";
import { Modal } from "./Modal";
import { ModelSelect } from "./SettingsPanel";

export function RoomSettingsPanel({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const [claudeModel, setClaudeModel] = useState<string | null>(null);
  const [codexModel, setCodexModel] = useState<string | null>(null);
  const [orchestratorModel, setOrchestratorModel] = useState<string | null>(null);
  const [orchestratorKind, setOrchestratorKind] = useState<"claude" | "codex">("codex");

  useEffect(() => {
    api.getRoomModel(roomId, "claude").then(setClaudeModel);
    api.getRoomModel(roomId, "codex").then(setCodexModel);
    api.getRoomModel(roomId, "orchestrator").then(setOrchestratorModel);
    api.getOrchestratorKind().then(setOrchestratorKind);
  }, [roomId]);

  async function change(kind: "claude" | "codex" | "orchestrator", model: string | null) {
    if (kind === "claude") setClaudeModel(model);
    else if (kind === "codex") setCodexModel(model);
    else setOrchestratorModel(model);
    await api.setRoomModel(roomId, kind, model);
  }

  return (
    <Modal
      title="Cài đặt phòng"
      subtitle="Ghi đè model riêng cho phòng này — để trống để dùng cài đặt chung"
      onClose={onClose}
      footer={
        <button
          className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700"
          onClick={onClose}
        >
          Đóng
        </button>
      }
    >
      <label className="mb-1.5 block text-sm font-medium text-neutral-600 dark:text-neutral-400">
        Model Claude cho phòng này
      </label>
      <div className="mb-4">
        <ModelSelect agentKind="claude" value={claudeModel} onChange={(m) => change("claude", m)} />
      </div>

      <label className="mb-1.5 block text-sm font-medium text-neutral-600 dark:text-neutral-400">
        Model Codex cho phòng này
      </label>
      <div className="mb-4">
        <ModelSelect agentKind="codex" value={codexModel} onChange={(m) => change("codex", m)} />
      </div>

      <label className="mb-1.5 block text-sm font-medium text-neutral-600 dark:text-neutral-400">
        Model điều phối (orchestrator) cho phòng này
      </label>
      <div>
        <ModelSelect agentKind={orchestratorKind} value={orchestratorModel} onChange={(m) => change("orchestrator", m)} />
      </div>
      <p className="mt-1.5 text-xs text-neutral-400">
        Đang dùng CLI điều phối chung: {orchestratorKind === "claude" ? "Claude" : "Codex"} (đổi ở Cài đặt chung).
      </p>
    </Modal>
  );
}
