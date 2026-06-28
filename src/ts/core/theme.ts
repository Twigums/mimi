export function initThemeToggle(): void {
  const saved = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved !== null ? saved === "dark" : prefersDark);

  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    const dark = !document.documentElement.classList.contains("theme-dark");
    localStorage.setItem("theme", dark ? "dark" : "light");
    applyTheme(dark);
  });
}

function applyTheme(dark: boolean): void {
  document.documentElement.classList.toggle("theme-dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  document.getElementById("theme-toggle")?.setAttribute("aria-checked", dark.toString());
}
