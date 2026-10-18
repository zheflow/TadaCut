import { getState, remember, setState, type Theme } from "./store";

const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;
/** The theme actually on screen once "system" is resolved. */
export const shownTheme = (theme = getState().theme): "light" | "dark" =>
  theme === "system" ? (dark() ? "dark" : "light") : theme;
export function setTheme(theme: Theme) {
  const apply = () => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    setState({ theme });
  };
  remember("tadacut-theme", theme);
  // A short cross-fade instead of every surface switching at once.
  const fade =
    "startViewTransition" in document &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (fade)
    (
      document as Document & { startViewTransition(cb: () => void): unknown }
    ).startViewTransition(apply);
  else apply();
  void window.tadacut?.setTheme(theme).catch(() => {});
}
/** Keeps the desktop window's native parts in step with the saved theme, and re-renders on system changes. */
export function watchTheme() {
  void window.tadacut?.setTheme(getState().theme).catch(() => {});
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getState().theme === "system") setState({ theme: "system" });
  });
}
