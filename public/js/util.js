// ---------- safe HTML templating ----------

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(s);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);

function renderValue(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join('');
  return escape(v);
}

/** Tagged template: interpolated values are escaped unless wrapped in raw() or produced by html``. */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += renderValue(v) + strings[i + 1]; });
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- API ----------

export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- formatting ----------

// The interface is in English, so dates are too, whatever the browser's language.
const LOCALE = 'en-GB';

const dateFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const longFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export const fmtDate = (ts) => dateFmt.format(ts);
export const fmtTime = (ts) => timeFmt.format(ts);
export const fmtLong = (ts) => longFmt.format(ts);
export const monthShort = (ts) => new Intl.DateTimeFormat(LOCALE, { month: 'short' }).format(ts);

export function fmtDay(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return fmtDate(ts);
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDate(ts);
}

/** Value for <input type="datetime-local"> in the viewer's own timezone. */
export function toLocalInput(ts) {
  const d = new Date(ts);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function fmtClock(ms) {
  ms = Math.max(0, ms);
  if (ms < 10_000) return `0:0${(ms / 1000).toFixed(1)}`;
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export const formatLabel = (format) => (format === 'swiss' ? 'Swiss' : 'Round robin');
export const resultLabel = (r) => (r === '1/2-1/2' ? '½–½' : r === 'bye' ? 'Bye' : r ? r.replace('-', '–') : '');

export function describeResult(game) {
  if (game.status !== 'finished') return '';
  const how = {
    checkmate: 'by checkmate',
    resignation: 'by resignation',
    time: 'on time',
    stalemate: 'by stalemate',
    repetition: 'by threefold repetition',
    'insufficient material': 'by insufficient material',
    'fifty-move rule': 'by the fifty-move rule',
    agreement: 'by agreement',
    'set by admin': '(result set by an admin)',
  }[game.termination] ?? '';
  if (game.result === '1/2-1/2') return `Draw ${how}`;
  const winner = game.result === '1-0' ? game.white : game.black;
  return `${winner?.firstName ?? (game.result === '1-0' ? 'White' : 'Black')} wins ${how}`;
}

// ---------- components ----------

export function avatar(user, size = '', { online = false } = {}) {
  const cls = `avatar ${size}`;
  const wrap = (inner) => (online ? html`<span class="online-dot">${inner}</span>` : inner);
  if (!user) return html`<span class="${cls}" aria-hidden="true">?</span>`;
  if (user.photo) return wrap(html`<img class="${cls}" src="${user.photo}" alt="" loading="lazy">`);
  const initials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase();
  return wrap(html`<span class="${cls}" aria-hidden="true">${initials}</span>`);
}

export function emptyState(title, body, action = '') {
  return html`<div class="empty"><strong>${title}</strong>${body}${action ? html`<div style="margin-top:14px">${action}</div>` : ''}</div>`;
}

export function toast(message, { error = false, link, linkText, timeout = 5000 } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.setAttribute('role', error ? 'alert' : 'status');
  el.innerHTML = html`<span>${message}</span>${link ? html`<a href="${link}">${linkText}</a>` : ''}`.s;
  el.querySelector('a')?.addEventListener('click', () => el.remove());
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), timeout);
}

export const toastError = (err) => toast(err.message || String(err), { error: true });

/** Opens a <dialog> containing a form; resolves with the submit handler's result, or null if cancelled. */
export function formDialog(title, body, { submitLabel = 'Save', submitClass = 'btn', onSubmit }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = html`
      <form method="dialog" novalidate>
        <h2 class="display">${title}</h2>
        <p class="form-error" hidden></p>
        ${body}
        <div class="actions">
          <button type="button" class="btn secondary" data-cancel>Cancel</button>
          <button class="${submitClass}" type="submit">${submitLabel}</button>
        </div>
      </form>`.s;
    document.body.append(dlg);
    const form = dlg.querySelector('form');
    const errEl = dlg.querySelector('.form-error');
    const close = (value) => { dlg.close(); dlg.remove(); resolve(value); };
    dlg.querySelector('[data-cancel]').onclick = () => close(null);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      errEl.hidden = true;
      try {
        close(await onSubmit(new FormData(form), form));
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        btn.disabled = false;
      }
    };
    dlg.showModal();
  });
}

export function confirmDialog(title, message, { confirmLabel = 'Confirm', danger = false } = {}) {
  return formDialog(title, html`<p style="margin-top:0">${message}</p>`, {
    submitLabel: confirmLabel,
    submitClass: danger ? 'btn danger' : 'btn',
    onSubmit: () => true,
  }).then(Boolean);
}
