// The only inline scripts on public pages. Their exact text is hashed (see middleware), so the browser will
// run these two and nothing else. A hash, unlike a per-request nonce, stays valid when a page is cached.

// Runs in <head> before first paint: marks the page as "JavaScript is on" (so menu and theme controls appear)
// and applies a saved light/dark choice, so there is never a flash of the wrong theme.
export const THEME_INIT = `(function(){var d=document.documentElement;d.classList.add('js');try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')d.setAttribute('data-theme',t);}catch(e){}})();`;

// Theme switch (light / dark / system) and the small-screen menu.
export const THEME_TOGGLE = `(function(){var root=document.documentElement;function current(){try{var t=localStorage.getItem('theme');return t==='light'||t==='dark'?t:'system';}catch(e){return 'system';}}function sync(){var c=current();document.querySelectorAll('[data-theme-choice]').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-theme-choice')===c));});}function menu(){return document.getElementById('site-menu');}function burger(){return document.querySelector('[data-burger]');}function setOpen(o){var m=menu(),b=burger();if(!m||!b)return;m.classList.toggle('open',o);b.setAttribute('aria-expanded',String(o));b.textContent=o?'Close':'Menu';}document.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;var c=t.closest('[data-theme-choice]');if(c){var v=c.getAttribute('data-theme-choice');try{v==='system'?localStorage.removeItem('theme'):localStorage.setItem('theme',v);}catch(x){}v==='system'?root.removeAttribute('data-theme'):root.setAttribute('data-theme',v);sync();return;}if(t.closest('[data-burger]')){var m=menu();setOpen(!(m&&m.classList.contains('open')));return;}if(t.closest('#site-menu a')){setOpen(false);return;}if(!t.closest('#site-menu')&&!t.closest('.site-header'))setOpen(false);});document.addEventListener('keydown',function(e){if(e.key==='Escape'){var m=menu();if(m&&m.classList.contains('open')){setOpen(false);var b=burger();if(b)b.focus();}}});window.addEventListener('resize',function(){if(window.innerWidth>860)setOpen(false);});sync();})();`;

let hashes: string[] | null = null;
export async function inlineScriptHashes(): Promise<string[]> {
  if (hashes) return hashes;
  hashes = await Promise.all([THEME_INIT, THEME_TOGGLE].map(async (s) => {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
    return `'sha256-${btoa(String.fromCharCode(...d))}'`;
  }));
  return hashes;
}
