// Applies the saved theme before the first paint so the window does not flash.
try {
  var theme = JSON.parse(localStorage.getItem("tadacut-theme") || '"light"');
  if (theme === "light" || theme === "dark")
    document.documentElement.dataset.theme = theme;
} catch (e) {
  document.documentElement.dataset.theme = "light";
}
