import { html, $, api, avatar, toast, describeResult, resultLabel, fmtDate } from '../util.js';
import { ctx } from '../state.js';
import { refreshMe, logout } from '../app.js';

export async function render(el, _params, scope) {
  const games = await api('/api/my/games');
  if (!scope.alive) return;
  const me = ctx.me;
  const finished = games.filter((g) => g.status === 'finished');

  el.innerHTML = html`
    <div class="page" style="max-width:860px">
      <header class="page-head">
        <div>
          <h1 class="display page-title">Your profile</h1>
          <p>Student ID ${me.studentId}. Rating ${me.rating}.</p>
        </div>
        <button class="btn secondary" data-logout>Log out</button>
      </header>
      <div class="grid-2">
        <form class="panel" novalidate>
          <h2 class="section-title">Details</h2>
          <p class="form-error" hidden></p>
          <div class="photo-pick">
            <span data-preview>${avatar(me, 'xl')}</span>
            <label>
              <input type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/gif">
              <span class="btn secondary small">Change photo</span>
            </label>
          </div>
          <div class="row">
            <label class="field"><span>First name</span><input name="firstName" value="${me.firstName}" required maxlength="50"></label>
            <label class="field"><span>Surname</span><input name="lastName" value="${me.lastName}" required maxlength="50"></label>
          </div>
          <label class="field"><span>New password</span><input name="password" type="password" autocomplete="new-password" minlength="6"><small>Leave empty to keep your current password</small></label>
          <button class="btn" type="submit">Save changes</button>
        </form>
        <section>
          <h2 class="section-title">Recent games</h2>
          ${finished.length ? html`<ul class="list">${finished.map((g) => {
            const meWhite = g.white?.id === me.id;
            const opp = meWhite ? g.black : g.white;
            return html`<li><a class="compact-event" href="#/games/${g.id}" style="grid-template-columns:auto 1fr auto;align-items:center">
              ${avatar(opp, 'sm')}
              <span><strong>${opp?.name ?? 'Unknown'}</strong><span class="small muted">${describeResult(g)}, ${fmtDate(g.finishedAt ?? g.createdAt)}</span></span>
              <b class="tabular">${resultLabel(g.result)}</b>
            </a></li>`;
          })}</ul>` : html`<div class="empty">Your finished games will be listed here.</div>`}
        </section>
      </div>
    </div>`.s;

  $('[data-logout]', el).onclick = logout;

  const form = $('form', el);
  const errEl = $('.form-error', form);
  form.elements.photo.addEventListener('change', () => {
    const file = form.elements.photo.files[0];
    if (file) $('[data-preview]', form).innerHTML = html`<img class="avatar xl" src="${URL.createObjectURL(file)}" alt="">`.s;
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('[type=submit]', form);
    btn.disabled = true;
    errEl.hidden = true;
    try {
      const data = new FormData(form);
      if (!form.elements.photo.files.length) data.delete('photo');
      const updated = await api('/api/me', { method: 'PUT', form: data });
      toast('Profile saved');
      refreshMe(updated);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      btn.disabled = false;
    }
  };
}
