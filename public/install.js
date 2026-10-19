// PWA: service worker + install popup (shown only on the main page, i.e. after login).
(() => {
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

  const KEY = 'ft:install';
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const get = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const set = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} };
  if (standalone()) { set({ installed: true }); return; }
  const st = get();
  if (st.installed || (st.snooze && Date.now() < st.snooze)) return;

  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIOSSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);

  const share = '<svg class="pwa-share" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  let box;
  const close = () => { if (box) { box.remove(); box = null; } };
  function show(html, onInstall) {
    if (box) return;
    box = document.createElement('div');
    box.className = 'pwa-wrap';
    box.innerHTML = `<div class="pwa-card" role="dialog" aria-modal="true" aria-labelledby="pwa-t">
      <img src="/icon-192.png" alt="" class="pwa-icon" width="56" height="56">
      <h2 id="pwa-t">დააყენეთ FLOWTRACKER</h2>${html}
      <div class="pwa-btns">${onInstall ? '<button type="button" class="pwa-ok">დაყენება</button>' : ''}<button type="button" class="pwa-later">მოგვიანებით</button></div></div>`;
    document.body.appendChild(box);
    box.querySelector('.pwa-later').onclick = () => { set({ snooze: Date.now() + 7 * 864e5 }); close(); };
    if (onInstall) box.querySelector('.pwa-ok').onclick = onInstall;
  }

  window.addEventListener('appinstalled', () => { set({ installed: true }); close(); });

  if (isIOSSafari) {
    setTimeout(() => show(`<p>აპი მთავარ ეკრანზე დაემატება და ცალკე ფანჯარაში გაიხსნება.</p>
      <ol class="pwa-steps">
        <li>ეკრანის ქვედა ნაწილში შეეხეთ „გაზიარების“ ღილაკს ${share}</li>
        <li>აირჩიეთ „მთავარ ეკრანზე დამატება“ (Add to Home Screen)</li>
        <li>ზედა მარჯვენა კუთხეში დააჭირეთ „დამატებას“ (Add)</li>
      </ol>`), 1200);
    return;
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    const evt = e;
    show('<p>დააყენეთ აპი თქვენს მოწყობილობაზე: ის მთავარი ეკრანიდან ერთი შეხებით გაიხსნება.</p>', async () => {
      close();
      evt.prompt();
      try { const r = await evt.userChoice; if (r.outcome === 'accepted') set({ installed: true }); } catch (err) {}
    });
  });
})();
