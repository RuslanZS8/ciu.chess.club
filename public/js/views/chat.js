import { html, $, api, avatar, fmtTime, fmtDay, confirmDialog, toastError } from '../util.js';
import { ctx, emit, isAdmin } from '../state.js';

const GROUP_MS = 5 * 60_000;

export async function render(el, _params, scope) {
  let messages = await api('/api/messages?limit=80');
  let filter = 'all';
  let reachedStart = messages.length < 80;
  if (!scope.alive) return;

  el.innerHTML = html`
    <div class="chat">
      <header class="page-head">
        <div>
          <h1 class="display page-title">Club chat</h1>
          <p data-online></p>
        </div>
        <div class="segmented" role="group" aria-label="Show">
          <button type="button" data-filter="all" aria-pressed="true">Everything</button>
          <button type="button" data-filter="ann" aria-pressed="false">Announcements</button>
        </div>
      </header>
      <div class="chat-log" data-log aria-live="polite"></div>
      <div class="composer">
        <form>
          <textarea name="body" rows="1" maxlength="1000" placeholder="Write to the club" aria-label="Message"></textarea>
          <button class="btn" type="submit">Send</button>
        </form>
        ${isAdmin() ? html`<label class="check"><input type="checkbox" name="announce"> Post as an announcement (highlighted and sent to everyone as a notification)</label>` : ''}
      </div>
    </div>`.s;

  const log = $('[data-log]', el);
  const form = $('form', el);
  const box = form.elements.body;
  const announceBox = $('[name=announce]', el);

  const showOnline = () => {
    const n = ctx.online.size;
    $('[data-online]', el).textContent = `${n} member${n === 1 ? '' : 's'} online now`;
  };
  showOnline();
  document.addEventListener('presence', showOnline);
  scope.onCleanup(() => document.removeEventListener('presence', showOnline));

  function messageHtml(m, prev) {
    const sameDay = prev && new Date(prev.createdAt).toDateString() === new Date(m.createdAt).toDateString();
    const sep = sameDay ? '' : html`<div class="day-sep">${fmtDay(m.createdAt)}</div>`;
    const del = isAdmin() ? html`<button class="btn ghost small del" data-del="${m.id}" aria-label="Delete message">Delete</button>` : '';
    if (m.announcement) {
      return html`${sep}
        <article class="msg announce">
          ${m.author ? avatar(m.author, 'sm') : html`<span class="club-mark"><img src="/pieces/wN.svg" alt=""></span>`}
          <div>
            <div class="head"><strong>Announcement</strong><time>${m.author ? `${m.author.name}, ` : ''}${fmtTime(m.createdAt)}</time>${del}</div>
            <div class="body">${m.body}</div>
          </div>
        </article>`;
    }
    const cont = sameDay && prev && !prev.announcement && prev.author?.id === m.author?.id && m.createdAt - prev.createdAt < GROUP_MS;
    return html`${sep}
      <article class="msg${cont ? ' cont' : ''}">
        ${avatar(m.author, 'sm')}
        <div>
          ${cont ? '' : html`<div class="head"><strong>${m.author?.name ?? 'Former member'}</strong>${m.author?.role === 'admin' ? html`<span class="tag admin">Admin</span>` : ''}<time>${fmtTime(m.createdAt)}</time>${del}</div>`}
          <div class="body">${m.body}</div>
        </div>
      </article>`;
  }

  function draw({ keepScroll = false } = {}) {
    const visible = filter === 'ann' ? messages.filter((m) => m.announcement) : messages;
    const fromBottom = log.scrollHeight - log.scrollTop;
    if (!visible.length) {
      log.innerHTML = html`<div class="empty" style="margin-top:16px"><strong>${filter === 'ann' ? 'No announcements yet' : 'No messages yet'}</strong>${filter === 'ann' ? 'Admin announcements will collect here.' : 'Say hello to the club.'}</div>`.s;
      return;
    }
    log.innerHTML = html`${!reachedStart && filter === 'all' ? html`<div class="day-sep"><button class="btn ghost small" data-older>Show earlier messages</button></div>` : ''}${visible.map((m, i) => messageHtml(m, visible[i - 1]))}`.s;
    log.scrollTop = keepScroll ? log.scrollHeight - fromBottom : log.scrollHeight;
  }

  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 120;

  log.addEventListener('click', async (e) => {
    const older = e.target.closest('[data-older]');
    if (older) {
      older.disabled = true;
      const earlier = await api(`/api/messages?limit=80&before=${messages[0].id}`).catch(toastError);
      if (!earlier) return;
      reachedStart = earlier.length < 80;
      messages = [...earlier, ...messages];
      draw({ keepScroll: true });
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const ok = await confirmDialog('Delete message?', 'It will disappear for everyone.', { confirmLabel: 'Delete message', danger: true });
      if (ok) api(`/api/messages/${del.dataset.del}`, { method: 'DELETE' }).catch(toastError);
    }
  });

  for (const btn of el.querySelectorAll('[data-filter]')) {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      for (const b of el.querySelectorAll('[data-filter]')) b.setAttribute('aria-pressed', String(b === btn));
      draw();
    });
  }

  const grow = () => {
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  };
  box.addEventListener('input', grow);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = box.value.trim();
    if (!body) return;
    const btn = $('[type=submit]', form);
    btn.disabled = true;
    try {
      await emit('chat:send', { body, announcement: !!announceBox?.checked });
      box.value = '';
      if (announceBox) announceBox.checked = false;
      grow();
    } catch (err) {
      toastError(err);
    } finally {
      btn.disabled = false;
      box.focus();
    }
  };

  scope.on('chat:message', (m) => {
    const stick = nearBottom() || m.author?.id === ctx.me.id;
    messages.push(m);
    draw({ keepScroll: !stick });
  });
  scope.on('chat:deleted', ({ id }) => {
    messages = messages.filter((m) => m.id !== id);
    draw({ keepScroll: true });
  });

  draw();
  box.focus();
}
