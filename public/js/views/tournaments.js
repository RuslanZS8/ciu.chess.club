import { html, $, api, emptyState, fmtLong, formDialog, formatLabel, toast } from '../util.js';
import { isAdmin } from '../state.js';

const statusTag = (t) => ({
  registration: html`<span class="tag open">Taking players</span>`,
  in_progress: html`<span class="tag live">Round ${t.currentRound} of ${t.totalRounds}</span>`,
  finished: html`<span class="tag">Finished</span>`,
}[t.status]);

export function tournamentCard(t) {
  return html`
    <a class="t-card" href="#/tournaments/${t.id}">
      <div class="actions">${statusTag(t)}${t.joined ? html`<span class="tag open">You’re playing</span>` : ''}</div>
      <h3>${t.name}</h3>
      <div class="facts">
        <span>${formatLabel(t.format)}</span>
        <span>${t.timeMinutes} min${t.incrementSec ? ` + ${t.incrementSec} s per move` : ''}</span>
        <span>${t.playerCount} player${t.playerCount === 1 ? '' : 's'}</span>
      </div>
      ${t.startsAt && t.status === 'registration' ? html`<span class="small muted">Starts ${fmtLong(t.startsAt)}</span>` : ''}
    </a>`;
}

const createForm = () => html`
  <label class="field"><span>Name</span><input name="name" required maxlength="100" placeholder="Autumn rapid"></label>
  <label class="field"><span>Format</span>
    <select name="format">
      <option value="swiss">Swiss: players with similar scores meet each round</option>
      <option value="round_robin">Round robin: everyone plays everyone once</option>
    </select>
  </label>
  <div class="row">
    <label class="field"><span>Minutes per player</span><input name="timeMinutes" type="number" min="1" max="180" value="10" required></label>
    <label class="field"><span>Seconds added per move</span><input name="incrementSec" type="number" min="0" max="60" value="5" required></label>
  </div>
  <div class="row">
    <label class="field" data-rounds><span>Rounds</span><input name="rounds" type="number" min="1" max="15" placeholder="Automatic"><small>Leave empty to fit the number of players</small></label>
    <label class="field"><span>Starts</span><input name="startsAt" type="datetime-local"><small>Optional, for the announcement</small></label>
  </div>
  <label class="field"><span>Details</span><textarea name="description" maxlength="2000" placeholder="Prizes, rules, who can play…"></textarea></label>`;

export async function render(el, _params, scope) {
  async function load() {
    const list = await api('/api/tournaments');
    if (!scope.alive) return;
    const live = list.filter((t) => t.status !== 'finished');
    const done = list.filter((t) => t.status === 'finished');
    el.innerHTML = html`
      <div class="page">
        <header class="page-head">
          <div>
            <h1 class="display page-title">Tournaments</h1>
            <p>Play your games online, right here. Pairings are made automatically and the next round starts once every board has finished.</p>
          </div>
          ${isAdmin() ? html`<button class="btn" data-new>New tournament</button>` : ''}
        </header>
        ${live.length
          ? html`<div class="t-list">${live.map(tournamentCard)}</div>`
          : emptyState('No tournaments running', isAdmin() ? 'Create one and members can join right away.' : 'New tournaments are announced in the club chat.')}
        ${done.length ? html`
          <h2 class="section-title" style="margin-top:40px">Finished</h2>
          <div class="t-list">${done.map(tournamentCard)}</div>` : ''}
      </div>`.s;

    $('[data-new]', el)?.addEventListener('click', async () => {
      const created = await formDialog('New tournament', createForm(), {
        submitLabel: 'Create tournament',
        onSubmit: (data) => {
          const body = Object.fromEntries(data);
          body.startsAt = body.startsAt ? new Date(body.startsAt).getTime() : null;
          if (!body.rounds || body.format === 'round_robin') delete body.rounds;
          return api('/api/tournaments', { method: 'POST', body });
        },
      });
      if (created) {
        toast('Tournament created and announced in the chat');
        location.hash = `#/tournaments/${created.id}`;
      }
    });
  }

  await load();
  scope.on('tournaments:changed', load);
  scope.on('tournament:changed', load);
}
