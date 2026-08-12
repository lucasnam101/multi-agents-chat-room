import { useEffect, useState, type ReactNode } from "react";
import type { ModelInfo } from "../lib/tauriApi";
import { api } from "../lib/tauriApi";
import { Modal } from "./Modal";
import { useTheme } from "../lib/useTheme";
import { useLang, type Lang } from "../lib/i18n";
import { IconMoon, IconSun } from "./icons";

const BUDGET_PRESETS = [100_000, 200_000, 300_000, 500_000, 1_000_000];
const FONT_SIZE_VALUES: ("sm" | "base" | "lg")[] = ["sm", "base", "lg"];

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
  agentKind: "claude" | "codex" | "grok";
  value: string | null;
  onChange: (model: string | null) => void;
}) {
  const { t } = useLang();
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
    return <div className="text-xs text-red-500">{t("model.error")}</div>;
  }
  if (!models) {
    return <div className="text-xs text-neutral-400">{t("model.loading")}</div>;
  }

  return (
    <select className={selectClass} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{t("model.adapterDefault")}</option>
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
  const { t } = useLang();
  if (ok === null) {
    return <span className="text-xs text-neutral-400">{t("status.checking")}</span>;
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
        ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-red-400"}`} />
      {ok ? t("status.loggedIn") : t("status.notLoggedIn")}
    </span>
  );
}

interface SettingsPanelProps {
  onClose: () => void;
  onFontSizeChange?: (size: "sm" | "base" | "lg") => void;
}

export function SettingsPanel({ onClose, onFontSizeChange }: SettingsPanelProps) {
  const { t, lang, setLang } = useLang();
  const [tab, setTab] = useState<"general" | "models">("general");
  const { theme, toggle: toggleTheme } = useTheme();

  const TABS: { id: "general" | "models"; label: string }[] = [
    { id: "general", label: t("settings.tabs.general") },
    { id: "models", label: t("settings.tabs.models") },
  ];

  const [orchestratorKind, setOrchestratorKind] = useState<"claude" | "codex">("codex");
  const [claudeModel, setClaudeModel] = useState<string | null>(null);
  const [codexModel, setCodexModel] = useState<string | null>(null);
  const [grokModel, setGrokModel] = useState<string | null>(null);
  const [orchestratorModel, setOrchestratorModel] = useState<string | null>(null);
  const [budget, setBudget] = useState(300_000);
  const [fontSize, setFontSize] = useState<"sm" | "base" | "lg">("base");
  const [claudeOk, setClaudeOk] = useState<boolean | null>(null);
  const [codexOk, setCodexOk] = useState<boolean | null>(null);
  const [grokOk, setGrokOk] = useState<boolean | null>(null);

  // Cheap settings load immediately; the model dropdowns each spawn an ACP
  // process just to list models, so those only fetch once the "Model" tab
  // is actually opened (see ModelSelect's own effect) instead of on every
  // Settings open regardless of which tab you look at.
  useEffect(() => {
    api.getOrchestratorKind().then(setOrchestratorKind);
    api.getModelSettings().then((s) => {
      setClaudeModel(s.claude_model);
      setCodexModel(s.codex_model);
      setGrokModel(s.grok_model);
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
    api.checkCliStatus("grok").then(setGrokOk);
  }, [tab]);

  async function changeOrchestrator(kind: "claude" | "codex") {
    setOrchestratorKind(kind);
    await api.setOrchestratorKind(kind);
  }

  async function changeModel(scope: "claude" | "codex" | "grok" | "orchestrator", model: string | null) {
    if (scope === "claude") setClaudeModel(model);
    else if (scope === "codex") setCodexModel(model);
    else if (scope === "grok") setGrokModel(model);
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
      title={t("settings.title")}
      subtitle={t("settings.subtitle")}
      onClose={onClose}
      width="max-w-lg"
      footer={
        <button
          className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700"
          onClick={onClose}
        >
          {t("common.close")}
        </button>
      }
    >
      <div className="mb-4 flex gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition ${
              tab === tb.id
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
            onClick={() => setTab(tb.id)}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === "general" && (
        <>
          <Section title={t("settings.section.appearance")}>
            <Field label={t("settings.themeLabel")}>
              <button
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                onClick={toggleTheme}
              >
                {theme === "dark" ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
                {theme === "dark" ? t("settings.themeDark") : t("settings.themeLight")}
              </button>
            </Field>
            <Field label={t("settings.fontSizeLabel")}>
              <select
                className={selectClass}
                value={fontSize}
                onChange={(e) => changeFontSize(e.target.value as "sm" | "base" | "lg")}
              >
                {FONT_SIZE_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {t(`settings.fontSize.${v}` as const)}
                  </option>
                ))}
              </select>
            </Field>
          </Section>

          <Section title={t("settings.section.language")}>
            <Field label={t("settings.languageLabel")}>
              <select className={selectClass} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                <option value="en">English</option>
                <option value="vi">Tiếng Việt</option>
              </select>
            </Field>
          </Section>

          <Section title={t("settings.section.contextBudget")}>
            <Field label={t("settings.contextBudgetLabel")}>
              <select className={selectClass} value={budget} onChange={(e) => changeBudget(Number(e.target.value))}>
                {BUDGET_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {formatTokens(p)} {t("context.tokens")}
                  </option>
                ))}
              </select>
            </Field>
          </Section>
        </>
      )}

      {tab === "models" && (
        <>
          <Section title={t("settings.section.cliStatus")}>
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-700 dark:text-neutral-300">Claude CLI</span>
              <StatusPill ok={claudeOk} />
            </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-700 dark:text-neutral-300">Codex CLI</span>
                <StatusPill ok={codexOk} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-700 dark:text-neutral-300">Grok CLI</span>
                <StatusPill ok={grokOk} />
              </div>
          </Section>

          <Section title={t("settings.section.defaultModels")}>
            <Field label="Claude">
              <ModelSelect agentKind="claude" value={claudeModel} onChange={(m) => changeModel("claude", m)} />
            </Field>
              <Field label="Codex">
                <ModelSelect agentKind="codex" value={codexModel} onChange={(m) => changeModel("codex", m)} />
              </Field>
              <Field label="Grok">
                <ModelSelect agentKind="grok" value={grokModel} onChange={(m) => changeModel("grok", m)} />
              </Field>
            <p className="text-xs text-neutral-400">{t("settings.roomOverrideNote")}</p>
          </Section>

          <Section title={t("settings.section.orchestrator")}>
            <Field label={t("settings.orchestratorAgentLabel")}>
              <select
                className={selectClass}
                value={orchestratorKind}
                onChange={(e) => changeOrchestrator(e.target.value as "claude" | "codex")}
              >
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
              </select>
            </Field>
            <Field label={t("settings.orchestratorModelLabel")}>
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
