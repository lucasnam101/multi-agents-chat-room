import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { IconClose } from "./icons";
import { useLang } from "../lib/i18n";

interface Props {
  url: string;
  onClose: () => void;
}

// A plain <iframe> — enough for most links agents post (docs, GitHub PRs,
// localhost previews). Sites that set X-Frame-Options/CSP frame-ancestors
// (e.g. Google) will refuse to render inside it; the "open externally"
// fallback covers that case rather than trying to work around it.
export function InAppBrowser({ url, onClose }: Props) {
  const { t } = useLang();
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200/80 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <span className="min-w-0 flex-1 truncate rounded-lg bg-neutral-100 px-3 py-1.5 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          {url}
        </span>
        <button
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          onClick={() => openUrl(url)}
        >
          {t("browser.openExternal")}
        </button>
        <button
          className="flex items-center gap-1 rounded-lg bg-neutral-100 px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
          onClick={onClose}
        >
          <IconClose className="h-3.5 w-3.5" />
          {t("common.close")}
        </button>
      </div>

      <div className="relative min-h-0 flex-1 bg-white">
        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white text-sm text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
            <p>{t("browser.blockedMessage")}</p>
            <button
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              onClick={() => openUrl(url)}
            >
              {t("browser.openExternal")}
            </button>
          </div>
        )}
        <iframe
          src={url}
          className="h-full w-full border-0"
          onError={() => setFailed(true)}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  );
}
