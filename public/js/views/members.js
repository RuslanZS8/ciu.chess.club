import { html, $$, api, avatar, emptyState, confirmDialog, toastError, toast } from '../util.js';
import { ctx, isAdmin } from '../state.js';

export async function render(el, _params, scope) {
  let members = await api('/api/members');
  let query = '';
  if (!scope.alive) return;

  function draw() {
    const q = query.toLowerCase();
    const shown = members.filter((m) => !q || m.name.toLowerCase().includes(q) || m.studentId?.toLowerCase().includes(q));
    const list = $$('[data-list]', el)[0];
    const content = shown.length ? html`${shown.map((m) => html`
      <div class="member">
        ${avatar(m, 'lg', { online: ctx.online.has(m.id) })}
        <div>
          <strong>${m.name}${m.id === ctx.me.id ? ' (you)' : ''}</strong>
          ${m.role === 'admin' ? html`<span class="tag admin">Admin</span>` : ''}
          <div class="stats">Rating ${m.rating}, ${m.played} game${m.played === 1 ? '' : 's'}, ${m.wins} win${m.wins === 1 ? '' : 's'}</div>
        </div>
        ${isAdmin() ? html`
          <div class="admin-row">
            <span>Student ID ${m.studentId}</span>
            ${m.id === ctx.me.id ? '' : html`<button class="btn ghost small" data-role="${m.id}">${m.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>`}
          </div>` : ''}
      </div>`)}` : emptyState('No members match', 'Try a different name.');
    list.innerHTML = html`<div class="members">${content}</div>`.s;

    for (const btn of $$('[data-role]', list)) {
      btn.onclick = async () => {
        const m = members.find((x) => x.id === Number(btn.dataset.role));
        const makeAdmin = m.role !== 'admin';
        const ok = await confirmDialog(
          makeAdmin ? `Make ${m.firstName} an admin?` : `Remove ${m.firstName}’s admin role?`,
          makeAdmin ? 'Admins can post announcements, manage events and run tournaments.' : 'They’ll keep their account and games.',
          { confirmLabel: makeAdmin ? 'Make admin' : 'Remove admin' },
        );
        if (!ok) return;
        try {
          const updated = await api(`/api/members/${m.id}/role`, { method: 'PATCH', body: { role: makeAdmin ? 'admin' : 'member' } });
          members = members.map((x) => (x.id === m.id ? { ...x, role: updated.role } : x));
          toast(makeAdmin ? `${m.firstName} is now an admin` : `${m.firstName} is no longer an admin`);
          draw();
        } catch (err) {
          toastError(err);
        }
      };
    }
  }

  el.innerHTML = html`
    <div class="page">
      <header class="page-head">
        <div>
          <h1 class="display page-title">Members</h1>
          <p>${members.length} member${members.length === 1 ? '' : 's'}, ranked by club rating. Ratings change after every rated game.</p>
        </div>
        <input class="input" type="search" placeholder="${isAdmin() ? 'Search name or student ID' : 'Search members'}" aria-label="Search members" style="max-width:280px" data-search>
      </header>
      <div data-list></div>
    </div>`.s;

  $$('[data-search]', el)[0].addEventListener('input', (e) => {
    query = e.target.value.trim();
    draw();
  });
  draw();

  const onPresence = () => draw();
  document.addEventListener('presence', onPresence);
  scope.onCleanup(() => document.removeEventListener('presence', onPresence));
}
