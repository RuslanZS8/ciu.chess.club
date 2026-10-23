import { html, api, emptyState, fmtLong, timeAgo, formatLabel } from '../util.js';
import { ctx } from '../state.js';
import { dateBlock, faceoff } from '../components.js';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export async function render(el, _params, scope) {
  async function load() {
    const [myGames, events, announcements, tournaments] = await Promise.all([
      api('/api/my/games'),
      api('/api/events'),
      api('/api/messages?announcements=1&limit=3'),
      api('/api/tournaments'),
    ]);
    if (!scope.alive) return;

    const active = myGames.filter((g) => g.status === 'active');
    const upcoming = events.filter((e) => e.startsAt >= Date.now() - 3 * 3600_000).slice(0, 4);
    const open = tournaments.filter((t) => t.status === 'registration');
    const waiting = tournaments.filter((t) => t.status === 'in_progress' && t.joined);

    let hero;
    if (active.length) {
      hero = html`${faceoff(active[0], ctx.me.id)}
        ${active.length > 1 ? html`<p class="small muted">You have ${active.length - 1} more game${active.length > 2 ? 's' : ''} in progress. <a href="#/games/${active[1].id}">Open the next one</a></p>` : ''}`;
    } else if (waiting.length) {
      hero = emptyState('Waiting for the next round', html`Your games in <a href="#/tournaments/${waiting[0].id}">${waiting[0].name}</a> are done. The next round is paired as soon as every board finishes.`);
    } else if (open.length) {
      hero = emptyState('No games right now', `${open[0].name} is taking players.`, html`<a class="btn" href="#/tournaments/${open[0].id}">View tournament</a>`);
    } else {
      hero = emptyState('No games right now', 'When an admin opens a tournament, you can join it from the Tournaments page.');
    }

    el.innerHTML = html`
      <div class="page">
        <header class="page-head">
          <div>
            <h1 class="display page-title">${greeting()}, ${ctx.me.firstName}</h1>
            <p>Rating ${ctx.me.rating}. ${ctx.online.size > 1 ? `${ctx.online.size - 1} other member${ctx.online.size > 2 ? 's are' : ' is'} online.` : ''}</p>
          </div>
        </header>
        <div class="stack">
          ${hero}
          <div class="home-grid">
            <section>
              <h2 class="section-title">Latest announcements</h2>
              ${announcements.length
                ? html`${announcements.slice().reverse().map((m) => html`
                    <div class="ann"><p>${m.body}</p><time>${m.author ? `${m.author.name}, ` : ''}${timeAgo(m.createdAt)}</time></div>`)}
                    <p class="small"><a href="#/chat">Open the club chat</a></p>`
                : emptyState('Nothing announced yet', 'Admin announcements show up here and in the chat.')}
              ${open.length ? html`
                <h2 class="section-title" style="margin-top:28px">Open for registration</h2>
                <div class="t-list">${open.map((t) => html`
                  <a class="t-card" href="#/tournaments/${t.id}">
                    <h3>${t.name}</h3>
                    <div class="facts"><span>${formatLabel(t.format)}</span><span>${t.timeMinutes}+${t.incrementSec}</span><span>${t.playerCount} joined</span></div>
                    ${t.joined ? html`<span class="tag open">You’re in</span>` : ''}
                  </a>`)}</div>` : ''}
            </section>
            <section>
              <h2 class="section-title">Coming up</h2>
              ${upcoming.length
                ? html`<ul class="list">${upcoming.map((e) => html`
                    <li><a class="compact-event" href="#/events">
                      ${dateBlock(e.startsAt)}
                      <span><strong>${e.title}</strong><span class="small muted">${fmtLong(e.startsAt)}${e.location ? `, ${e.location}` : ''}</span>
                      ${e.going ? html`<br><span class="tag open">Going</span>` : ''}</span>
                    </a></li>`)}</ul>`
                : emptyState('No events planned', 'Check back soon.')}
            </section>
          </div>
        </div>
      </div>`.s;
  }

  await load();
  scope.on('tournament:changed', load);
  scope.on('chat:message', (m) => m.announcement && load());
}
