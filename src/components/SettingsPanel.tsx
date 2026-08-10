import { useEffect, useState, type ReactNode } from "react";
import type { ModelInfo } from "../lib/tauriApi";
import { api } from "../lib/tauriApi";
import { Modal } from "./Modal";
import { useTheme } from "../lib/useTheme";
import { IconMoon, IconSun } from "./icons";

const BUDGET_PRESETS = [100_000, 200_000, 300_000, 500_000, 1_000_000];
const FONT_SIZE_OPTIONS: { value: "sm" | "base" | "lg"; label: string }[] = [
  { value: "sm", label: "Nhỏ" },
  { value: "base", label: "Vừa" },
  { value: "lg", label: "Lớn" },
];

export function formatTokens(n: number) {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

// Maps the stored setting to the Tailwind Typography modifier that controls
// markdown font-size/line-height/spacing together, rather than just
// bumping text-size (which would leave prose spacing inconsistent). Only
// ever applied to message-bubble content (see ChatView/MessageBubble) —
// never to the room list or session dropdown.
export function fontSizeToProseClass(size: "sm" | "base" | "lg" | undefined) {
  switch (size) {
    case "sm":
      return "prose-sm";
    case "lg":
      return "prose-lg";
    default:
      return "prose-base";
  }
}

const selectClass =
  "w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-indigo-400 focus:bg-white dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:bg-neutral-900";

export function ModelSelect({
  agentKind,
  value,
  onChange,
}: {
  agentKind: "claude" | "codex";
  value: string | null;
  onChange: (model: string | null) => void;
}) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setModels(null);
    setError(false);
    api
      .listModels(agentKind)
      .then((list) => {
        if (!cancelled) setModels(list);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [agentKind]);

  if (error) {
    return <div className="text-xs text-red-500">Không lấy được danh sách model (CLI chưa đăng nhập?)</div>;
  }
  if (!models) {
    return <div className="text-xs text-neutral-400">Đang tải danh sách model…</div>;
  }

  return (
    <select className={selectClass} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">(mặc định của adapter)</option>
      {models.map((m) => (
        <option key={m.model_id} value={m.model_id}>
          {m.name ?? m.model_id}
        </option>
      ))}
    </select>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">{title}</h3>
      <div className="space-y-3 rounded-xl border border-neutral-100 bg-neutral-50/60 p-3 dark:border-neutral-800 dark:bg-neutral-800/30">
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-neutral-600 dark:text-neutral-400">{label}</label>
      {children}
    </div>
  );
}

function StatusPill({ ok }: { ok: boolean | null }) {
  if (ok === null) {
    return <span className="text-xs text-neutral-400">đang kiểm tra…</span>;
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
        ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-red-400"}`} />
      {ok ? "đã đăng nhập" : "chưa đăng nhập"}
    </span>
  );
}

const TABS = [
  { id: "general" as const, label: "Chung" },
  { id: "models" as const, label: "Model" },
];

interface SettingsPanelProps {
  onClose: () => void;
  onFontSizeChange?: (size: "sm" | "base" | "lg") => void;
}

export function SettingsPanel({ onClose, onFontSizeChange }: SettingsPanelProps) {
  const [tab, setTab] = useState<"general" | "models">("general");
  const { theme, toggle: toggleTheme } = useTheme();

  const [orchestratorKind, setOrchestratorKind] = useState<"claude" | "codex">("codex");
  const [claudeModel, setClaudeModel] = useState<string | null>(null);
  const [codexModel, setCodexModel] = useState<string | null>(null);
  const [orchestratorModel, setOrchestratorModel] = useState<string | null>(null);
  const [budget, setBudget] = useState(300_000);
  const [fontSize, setFontSize] = useState<"sm" | "base" | "lg">("base");
  const [claudeOk, setClaudeOk] = useState<boolean | null>(null);
  const [codexOk, setCodexOk] = useState<boolean | null>(null);

  // Cheap settings load immediately; the model dropdowns each spawn an ACP
  // process just to list models, so those only fetch once the "Model" tab
  // is actually opened (see ModelSelect's own effect) instead of on every
  // Settings open regardless of which tab you look at.
  useEffect(() => {
    api.getOrchestratorKind().then(setOrchestratorKind);
    api.getModelSettings().then((s) => {
      setClaudeModel(s.claude_model);
      setCodexModel(s.codex_model);
      setOrchestratorModel(s.orchestrator_model);
    });
    api.getContextBudget().then(setBudget);
    api.getChatFontSize().then(setFontSize);
  }, []);

  // Spawns `claude --version` / `codex --version` — cheap, but still a
  // process spawn, so only check once the Model tab (where it now lives) is
  // actually opened rather than on every Settings open.
  useEffect(() => {
    if (tab !== "models") return;
    api.checkCliStatus("claude").then(setClaudeOk);
    api.checkCliStatus("codex").then(setCodexOk);
  }, [tab]);

  async function changeOrchestrator(kind: "claude" | "codex") {
    setOrchestratorKind(kind);
    await api.setOrchestratorKind(kind);
  }

  async function changeModel(scope: "claude" | "codex" | "orchestrator", model: string | null) {
    if (scope === "claude") setClaudeModel(model);
    else if (scope === "codex") setCodexModel(model);
    else setOrchestratorModel(model);
    await api.setModelSetting(scope, model);
  }

  async function changeBudget(tokens: number) {
    setBudget(tokens);
    await api.setContextBudget(tokens);
  }

  async function changeFontSize(size: "sm" | "base" | "lg") {
    setFontSize(size);
    await api.setChatFontSize(size);
    onFontSizeChange?.(size);
  }

  return (
    <Modal
      title="Cài đặt chung"
      subtitle="Áp dụng cho toàn bộ ứng dụng, có thể ghi đè theo từng phòng"
      onClose={onClose}
      width="max-w-lg"
      footer={
        <button
          className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700"
          onClick={onClose}
        >
          Đóng
        </button>
      }
    >
      <div className="mb-4 flex gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition ${
              tab === t.id
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "general" && (
        <>
          <Section title="Giao diện">
            <Field label="Chế độ sáng/tối">
              <button
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                onClick={toggleTheme}
              >
                {theme === "dark" ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
                {theme === "dark" ? "Đang tối — chuyển sang sáng" : "Đang sáng — chuyển sang tối"}
              </button>
            </Field>
            <Field label="Cỡ chữ tin nhắn">
              <select
                className={selectClass}
                value={fontSize}
                onChange={(e) => changeFontSize(e.target.value as "sm" | "base" | "lg")}
              >
                {FONT_SIZE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </Section>

          <Section title="Ngân sách ngữ cảnh">
            <Field label="Kích hoạt tóm tắt khi vượt ngưỡng">
              <select className={selectClass} value={budget} onChange={(e) => changeBudget(Number(e.target.value))}>
                {BUDGET_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {formatTokens(p)} token
                  </option>
                ))}
              </select>
            </Field>
          </Section>
        </>
      )}

      {tab === "models" && (
        <>
          <Section title="Trạng thái CLI">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-700 dark:text-neutral-300">Claude CLI</span>
              <StatusPill ok={claudeOk} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-700 dark:text-neutral-300">Codex CLI</span>
              <StatusPill ok={codexOk} />
            </div>
          </Section>

          <Section title="Model mặc định cho từng agent">
            <Field label="Claude">
              <ModelSelect agentKind="claude" value={claudeModel} onChange={(m) => changeModel("claude", m)} />
            </Field>
            <Field label="Codex">
              <ModelSelect agentKind="codex" value={codexModel} onChange={(m) => changeModel("codex", m)} />
            </Field>
            <p className="text-xs text-neutral-400">Có thể ghi đè riêng cho từng phòng ở "Cài đặt phòng".</p>
          </Section>

          <Section title="Agent điều phối (tóm tắt hội thoại)">
            <Field label="Agent">
              <select
                className={selectClass}
                value={orchestratorKind}
                onChange={(e) => changeOrchestrator(e.target.value as "claude" | "codex")}
              >
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
              </select>
            </Field>
            <Field label="Model">
              <ModelSelect
                key={orchestratorKind}
                agentKind={orchestratorKind}
                value={orchestratorModel}
                onChange={(m) => changeModel("orchestrator", m)}
              />
            </Field>
          </Section>
        </>
      )}
    </Modal>
  );
}
