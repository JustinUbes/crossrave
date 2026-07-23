// Applies the saved (or system-preferred) theme before first paint to avoid a
// flash of the wrong theme. Loaded as a plain blocking script in <head>.
(function () {
  var theme = "light";
  try {
    var stored = localStorage.getItem("crossrave-theme");
    if (stored === "dark" || stored === "light") {
      theme = stored;
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      theme = "dark";
    }
  } catch (err) {
    // localStorage unavailable (private mode, etc.) — fall back to light.
  }
  document.documentElement.dataset.theme = theme;
})();
