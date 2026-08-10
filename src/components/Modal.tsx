import type { ReactNode } from "react";
import { IconClose } from "./icons";
import { useLang } from "../lib/i18n";

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}

export function Modal({ title, subtitle, onClose, children, footer, width = "max-w-md" }: Props) {
  const { t } = useLang();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`animate-fade-in-up flex max-h-[85vh] w-full ${width} flex-col overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900`}
      >
        <div className="flex shrink-0 items-start justify-between border-b border-neutral-100 px-5 py-4 dark:border-neutral-800">
          <div>
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{subtitle}</p>}
          </div>
          <button
            className="rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-neutral-100 px-5 py-3 dark:border-neutral-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
