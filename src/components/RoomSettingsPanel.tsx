import { useEffect, useState } from "react";
import { api } from "../lib/tauriApi";
import { Modal } from "./Modal";
import { ModelSelect } from "./SettingsPanel";
import { useLang } from "../lib/i18n";

export function RoomSettingsPanel({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const { t } = useLang();
  const [claudeModel, setClaudeModel] = useState<string | null>(null);
  const [codexModel, setCodexModel] = useState<string | null>(null);
  const [grokModel, setGrokModel] = useState<string | null>(null);
  const [orchestratorModel, setOrchestratorModel] = useState<string | null>(null);
  const [orchestratorKind, setOrchestratorKind] = useState<"claude" | "codex">("codex");

  useEffect(() => {
    api.getRoomModel(roomId, "claude").then(setClaudeModel);
    api.getRoomModel(roomId, "codex").then(setCodexModel);
    api.getRoomModel(roomId, "grok").then(setGrokModel);
    api.getRoomModel(roomId, "orchestrator").then(setOrchestratorModel);
    api.getOrchestratorKind().then(setOrchestratorKind);
  }, [roomId]);

  async function change(kind: "claude" | "codex" | "grok" | "orchestrator", model: string | null) {
    if (kind === "claude") setClaudeModel(model);
    else if (kind === "codex") setCodexModel(model);
    else if (kind === "grok") setGrokModel(model);
    else setOrchestratorModel(model);
    await api.setRoomModel(roomId, kind, model);
  }

  return (
    <Modal
      title={t("roomSettings.title")}
      subtitle={t("roomSettings.subtitle")}
      onClose={onClose}
      footer={
        <button
          className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700"
          onClick={onClose}
        >
          {t("common.close")}
        </button>
      }
    >
      <label className="mb-1.5 block text-sm font-medium text-neutral-600 dark:text-neutral-400">
        {t("roomSettings.claudeModelLabel")}
      </label>
      <div className="mb-4">
        <ModelSelect agentKind="claude" value={claudeModel} onChange={(m) => change("claude", m)} />
      </div>

      <label className="mb-1.5 block text-sm font-medium text-neutral-600 dark:text-neutral-400">
        {t("roomSettings.codexModelLabel")}
      </label>
      <div className="mb-4">
        <ModelSelect agentKind="codex" value={codexModel} onChange={(m) => change("codex", m)} />
      </div>

      <label className="mb-1.5 block text-sm font-medium text-neutral-600 dark:text-neutral-400">
        {t("roomSettings.grokModelLabel")}
      </label>
      <div className="mb-4">
        <ModelSelect agentKind="grok" value={grokModel} onChange={(m) => change("grok", m)} />
      </div>

      <label className="mb-1.5 block text-sm font-medium text-neutral-600 dark:text-neutral-400">
        {t("roomSettings.orchestratorModelLabel")}
      </label>
      <div>
        <ModelSelect agentKind={orchestratorKind} value={orchestratorModel} onChange={(m) => change("orchestrator", m)} />
      </div>
      <p className="mt-1.5 text-xs text-neutral-400">
        {t("roomSettings.orchestratorNote", { kind: orchestratorKind === "claude" ? "Claude" : "Codex" })}
      </p>
    </Modal>
  );
}
