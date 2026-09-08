// Apply the saved/device theme before paint. The locale changes after hydration.
(() => {
  let dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  try {
    const saved = JSON.parse(localStorage.getItem('scan-and-send.preferences.v1') || 'null');
    if (saved?.theme === 'dark' || saved?.theme === 'light') dark = saved.theme === 'dark';
  } catch { /* Storage may be unavailable. */ }
  document.documentElement.classList.toggle('dark', dark);
})();
