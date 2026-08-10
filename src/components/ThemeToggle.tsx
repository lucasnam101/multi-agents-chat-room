import { useTheme } from "../lib/useTheme";
import { IconMoon, IconSun } from "./icons";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      className="rounded-full p-2 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      onClick={toggle}
      title={theme === "dark" ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối"}
      aria-label="Đổi giao diện sáng/tối"
    >
      {theme === "dark" ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
    </button>
  );
}
