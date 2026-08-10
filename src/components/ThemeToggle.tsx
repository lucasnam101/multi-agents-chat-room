import { useTheme } from "../lib/useTheme";
import { useLang } from "../lib/i18n";
import { IconMoon, IconSun } from "./icons";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useLang();
  return (
    <button
      className="rounded-full p-2 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      onClick={toggle}
      title={theme === "dark" ? t("settings.themeDark") : t("settings.themeLight")}
      aria-label={t("theme.toggleAria")}
    >
      {theme === "dark" ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
    </button>
  );
}
