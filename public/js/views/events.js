import { html, $, $$, api, avatar, emptyState, fmtLong, formDialog, confirmDialog, toLocalInput, toastError, toast } from '../util.js';
import { isAdmin } from '../state.js';
import { dateBlock } from '../components.js';

function eventForm(e = {}) {
  const start = e.startsAt ?? (() => {
    const d = new Date(Date.now() + 7 * 86_400_000);
    d.setHours(18, 0, 0, 0);
    return d.getTime();
  })();
  return html`
    <label class="field"><span>Title</span><input name="title" required maxlength="120" value="${e.title ?? ''}" placeholder="Blitz night"></label>
    <div class="row">
      <label class="field"><span>Starts</span><input name="startsAt" type="datetime-local" required value="${toLocalInput(start)}"></label>
      <label class="field"><span>Location</span><input name="location" maxlength="120" value="${e.location ?? ''}" placeholder="Room 204, Main building"></label>
    </div>
    <label class="field"><span>Details</span><textarea name="description" maxlength="2000" placeholder="What to bring, who it’s for, time control…">${e.description ?? ''}</textarea></label>
    ${e.id ? '' : html`<label class="check"><input type="checkbox" name="announce" checked> Announce in the club chat</label>`}`;
}

const readForm = (data) => ({
  title: data.get('title'),
  location: data.get('location'),
  description: data.get('description'),
  startsAt: new Date(data.get('startsAt')).getTime(),
  announce: data.get('announce') === 'on',
});

function eventItem(e, past) {
  const others = e.attendees.length - (e.going ? 1 : 0);
  return html`
    <li class="event${past ? ' past' : ''}" data-id="${e.id}">
      ${dateBlock(e.startsAt)}
      <div>
        <h3>${e.title}</h3>
        <p class="meta">${fmtLong(e.startsAt)}${e.location ? `, ${e.location}` : ''}</p>
        ${e.description ? html`<p class="desc">${e.description}</p>` : ''}
        ${e.attendees.length ? html`
          <div class="player-cell">
            <div class="avatar-stack">${e.attendees.slice(0, 6).map((u) => avatar(u, 'xs'))}</div>
            <span class="small muted">${e.going ? (others ? `You and ${others} other${others > 1 ? 's' : ''} going` : 'You’re going') : `${e.attendees.length} going`}</span>
          </div>` : ''}
      </div>
      <div class="side-actions">
        ${past ? '' : html`<button class="btn small ${e.going ? 'secondary' : ''}" data-rsvp="${e.going ? '0' : '1'}">${e.going ? 'Not going' : 'I’m going'}</button>`}
        ${isAdmin() ? html`
          <div class="actions">
            <button class="btn ghost small" data-edit>Edit</button>
            <button class="btn ghost small" data-delete>Delete</button>
          </div>` : ''}
      </div>
    </li>`;
}

export async function render(el, _params, scope) {
  let events = [];

  function draw() {
    const cutoff = Date.now() - 3 * 3600_000;
    const upcoming = events.filter((e) => e.startsAt >= cutoff);
    const past = events.filter((e) => e.startsAt < cutoff).reverse();

    el.innerHTML = html`
      <div class="page" style="max-width:860px">
        <header class="page-head">
          <div>
            <h1 class="display page-title">Events</h1>
            <p>Club nights, lessons and over-the-board tournaments. Let the organisers know you’re coming.</p>
          </div>
          ${isAdmin() ? html`<button class="btn" data-new>New event</button>` : ''}
        </header>
        ${upcoming.length
          ? html`<ul class="list">${upcoming.map((e) => eventItem(e, false))}</ul>`
          : emptyState('No upcoming events', isAdmin() ? 'Create one and it will be announced in the chat.' : 'New events are announced in the club chat.')}
        ${past.length ? html`
          <h2 class="section-title" style="margin-top:40px">Past events</h2>
          <ul class="list">${past.map((e) => eventItem(e, true))}</ul>` : ''}
      </div>`.s;

    $('[data-new]', el)?.addEventListener('click', async () => {
      const created = await formDialog('New event', eventForm(), {
        submitLabel: 'Create event',
        onSubmit: (data) => api('/api/events', { method: 'POST', body: readForm(data) }),
      });
      if (created) {
        toast('Event created');
        await load();
      }
    });

    for (const li of $$('.event', el)) {
      const id = Number(li.dataset.id);
      const event = events.find((e) => e.id === id);
      $('[data-rsvp]', li)?.addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try {
          const updated = await api(`/api/events/${id}/rsvp`, { method: 'POST', body: { going: e.currentTarget.dataset.rsvp === '1' } });
          events = events.map((x) => (x.id === id ? updated : x));
          draw();
        } catch (err) {
          toastError(err);
          e.currentTarget.disabled = false;
        }
      });
      $('[data-edit]', li)?.addEventListener('click', async () => {
        const saved = await formDialog('Edit event', eventForm(event), {
          onSubmit: (data) => api(`/api/events/${id}`, { method: 'PUT', body: readForm(data) }),
        });
        if (saved) await load();
      });
      $('[data-delete]', li)?.addEventListener('click', async () => {
        const ok = await confirmDialog('Delete event?', `“${event.title}” will be removed for everyone.`, { confirmLabel: 'Delete event', danger: true });
        if (!ok) return;
        await api(`/api/events/${id}`, { method: 'DELETE' }).catch(toastError);
        await load();
      });
    }
  }

  async function load() {
    events = await api('/api/events');
    if (scope.alive) draw();
  }

  await load();
}
