/* Shared mock behaviour for the Identity/Entra mockups.
   Mock chrome only — none of this is proposed production code.
   - data-state="a b"  -> element only shows in those lifecycle states
   - data-tab / data-tabpanel -> in-page tab switching
   - .choice, .sw, .seg -> selectable controls
   - data-open / data-close -> dialogs */

const STATES = ['fresh', 'connected', 'mapping', 'preflight', 'operating', 'failing'];

function applyState(state) {
  document.querySelectorAll('[data-state]').forEach((el) => {
    const list = el.dataset.state.split(/\s+/).filter(Boolean);
    el.classList.toggle('hide', !list.includes(state));
  });
  document.querySelectorAll('.states button').forEach((b) => {
    b.classList.toggle('on', b.dataset.setstate === state);
  });
  // let a page react further (e.g. pick a default tab per state)
  document.dispatchEvent(new CustomEvent('mockstate', { detail: { state } }));
  history.replaceState(null, '', '#' + state);
}

function initStates() {
  const bar = document.querySelector('.states');
  if (bar) {
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-setstate]');
      if (b) applyState(b.dataset.setstate);
    });
  }
  const hash = (location.hash || '').replace('#', '');
  applyState(STATES.includes(hash) ? hash : (document.body.dataset.initial || 'fresh'));
}

function initTheme() {
  const saved = localStorage.getItem('mock-theme');
  if (saved) document.documentElement.dataset.theme = saved;
  document.querySelectorAll('.themetog').forEach((btn) => {
    const sync = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      btn.textContent = dark ? 'Light' : 'Dark';
    };
    sync();
    btn.addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      if (dark) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = 'dark';
      localStorage.setItem('mock-theme', dark ? 'light' : 'dark');
      document.querySelectorAll('.themetog').forEach((b) => {
        b.textContent = document.documentElement.dataset.theme === 'dark' ? 'Light' : 'Dark';
      });
    });
  });
}

function initTabs() {
  document.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const group = tab.closest('[data-tabgroup]') || document;
      const name = tab.dataset.tab;
      group.querySelectorAll('[data-tab]').forEach((t) => t.classList.toggle('on', t === tab));
      document.querySelectorAll('[data-tabpanel]').forEach((p) => {
        if (p.dataset.tabgroupref === (group.dataset.tabgroup || '')) {
          p.classList.toggle('hide', p.dataset.tabpanel !== name);
        }
      });
    });
  });
}

function showTab(name) {
  const tab = document.querySelector(`[data-tab="${name}"]`);
  if (tab) tab.click();
}

function initChoices() {
  document.querySelectorAll('.choices').forEach((grp) => {
    grp.addEventListener('click', (e) => {
      const c = e.target.closest('.choice');
      if (!c) return;
      grp.querySelectorAll('.choice').forEach((x) => {
        x.classList.toggle('sel', x === c);
        x.setAttribute('aria-checked', x === c ? 'true' : 'false');
      });
      const target = c.dataset.reveals;
      if (target) {
        document.querySelectorAll('[data-revealed]').forEach((r) => {
          r.classList.toggle('hide', r.dataset.revealed !== target);
        });
      }
    });
  });
}

function initSwitches() {
  document.querySelectorAll('.sw').forEach((sw) => {
    sw.addEventListener('click', (e) => {
      e.preventDefault();
      sw.classList.toggle('on');
      sw.setAttribute('aria-checked', sw.classList.contains('on') ? 'true' : 'false');
      const dep = sw.dataset.enables;
      if (dep) {
        document.querySelectorAll(`[data-enabledby="${dep}"]`).forEach((el) => {
          const on = sw.classList.contains('on');
          el.classList.toggle('hide', !on);
        });
      }
    });
  });
}

function initSegs() {
  document.querySelectorAll('.seg').forEach((seg) => {
    if (seg.hasAttribute('data-tabgroup')) return;
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      const filter = b.dataset.filter;
      const scope = seg.dataset.filters;
      if (filter && scope) {
        document.querySelectorAll(`[data-rowscope="${scope}"]`).forEach((row) => {
          const tags = (row.dataset.rowtags || '').split(/\s+/);
          row.classList.toggle('hide', filter !== 'all' && !tags.includes(filter));
        });
      }
    });
  });
}

function initDialogs() {
  document.addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]');
    if (o) {
      const d = document.getElementById(o.dataset.open);
      if (d) d.hidden = false;
      return;
    }
    const c = e.target.closest('[data-close]');
    if (c) {
      const d = c.closest('.scrim');
      if (d) d.hidden = true;
      return;
    }
    if (e.target.classList.contains('scrim')) e.target.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.scrim').forEach((s) => (s.hidden = true));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initTabs();
  initChoices();
  initSwitches();
  initSegs();
  initDialogs();
  initStates();
});
