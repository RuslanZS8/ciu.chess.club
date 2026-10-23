import { html, $, $$, api, avatar, emptyState, fmtLong, formatLabel, confirmDialog, toastError, toast } from '../util.js';
import { ctx, isAdmin } from '../state.js';
import { pairingRow } from '../components.js';

const fmtPoints = (p) => {
  const whole = Math.floor(p);
  const half = p - whole >= 0.5;
  return half ? (whole ? `${whole}½` : '½') : String(whole);
};

function standingsTable(t) {
  if (!t.standings.length) return emptyState('No players yet', 'Standings appear once players join.');
  const tbLabel = t.format === 'swiss' ? 'Buchholz' : 'Sonneborn-Berger';
  return html`
    <div class="table-wrap">
      <table class="data">
        <thead><tr>
          <th class="num">#</th><th>Player</th><th class="num">Points</th>
          <th class="num" title="Wins, draws, losses">W / D / L</th>
          <th class="num" title="${tbLabel} tie-break">${t.format === 'swiss' ? 'Buch.' : 'S-B'}</th>
          <th class="num">Rating</th>
        </tr></thead>
        <tbody>${t.standings.map((s, i) => html`
          <tr class="${s.player.id === ctx.me.id ? 'mine' : ''}">
            <td class="num"><span class="rank">${i + 1}</span></td>
            <td><span class="player-cell">${avatar(s.player, 'xs')}<span>${s.player.name}${s.byes ? html` <span class="small muted">(${s.byes} bye${s.byes > 1 ? 's' : ''})</span>` : ''}</span></span></td>
            <td class="num"><b>${fmtPoints(s.points)}</b></td>
            <td class="num">${s.wins} / ${s.draws} / ${s.losses}</td>
            <td class="num">${fmtPoints(s.tiebreak)}</td>
            <td class="num">${s.player.rating}</td>
          </tr>`)}
        </tbody>
      </table>
    </div>
    <p class="small muted">Ties are broken by ${tbLabel}: ${t.format === 'swiss' ? 'the total score of everyone you played' : 'the scores of the players you beat, plus half the scores of those you drew'}.</p>`;
}

/** Everyone-against-everyone grid: each cell is the row player's score against the column player. */
function crosstable(t) {
  const order = t.standings.map((s) => s.player);
  const games = t.rounds.flatMap((r) => r.games).filter((g) => g.result !== 'bye');
  const cell = (rowId, colId) => {
    if (rowId === colId) return html`<td class="x" aria-label="Same player"></td>`;
    const g = games.find((x) => (x.white?.id === rowId && x.black?.id === colId) || (x.black?.id === rowId && x.white?.id === colId));
    if (!g) return html`<td></td>`;
    if (g.status === 'active') return html`<td><a href="#/games/${g.id}" title="Playing now">•</a></td>`;
    const whiteScore = g.result === '1-0' ? 1 : g.result === '0-1' ? 0 : 0.5;
    const score = g.white?.id === rowId ? whiteScore : 1 - whiteScore;
    return html`<td><a href="#/games/${g.id}">${score === 0.5 ? '½' : score}</a></td>`;
  };
  return html`
    <div class="table-wrap">
      <table class="data cross">
        <thead><tr><th>#</th><th>Player</th>${order.map((_, i) => html`<th>${i + 1}</th>`)}<th>Points</th></tr></thead>
        <tbody>${order.map((p, i) => html`
          <tr class="${p.id === ctx.me.id ? 'mine' : ''}">
            <td><span class="rank">${i + 1}</span></td>
            <td><span class="player-cell">${avatar(p, 'xs')}${p.name}</span></td>
            ${order.map((q) => cell(p.id, q.id))}
            <td><b>${fmtPoints(t.standings[i].points)}</b></td>
          </tr>`)}
        </tbody>
      </table>
    </div>`;
}

function playersGrid(t) {
  if (!t.players.length) return emptyState('Nobody has joined yet', 'Be the first to join.');
  const sorted = [...t.players].sort((a, b) => b.rating - a.rating);
  return html`<div class="members">${sorted.map((p) => html`
    <div class="member">
      ${avatar(p, 'lg', { online: ctx.online.has(p.id) })}
      <div><strong>${p.name}</strong><span class="stats">Rating ${p.rating}</span></div>
    </div>`)}</div>`;
}

export async function render(el, [id], scope) {
  let t;
  let tab = null;
  let round = null;

  function draw() {
    const started = t.status !== 'registration';
    tab ??= started ? 'pairings' : 'players';
    round ??= t.currentRound || 1;
    const rounds = t.rounds;
    const shown = rounds.find((r) => r.round === round) ?? rounds.at(-1);
    const myGame = t.status === 'in_progress'
      ? rounds.find((r) => r.round === t.currentRound)?.games.find((g) => g.status === 'active' && (g.white?.id === ctx.me.id || g.black?.id === ctx.me.id))
      : null;

    const tabs = started
      ? [['pairings', 'Pairings'], ['standings', 'Standings'], ...(t.format === 'round_robin' ? [['cross', 'Crosstable']] : []), ['players', 'Players']]
      : [['players', `Players (${t.players.length})`]];

    let body;
    if (tab === 'pairings') {
      body = shown ? html`
        <div class="round-picker" role="group" aria-label="Round">
          ${rounds.map((r) => html`<button type="button" data-round="${r.round}" aria-pressed="${String(r.round === shown.round)}" aria-label="Round ${r.round}">${r.round}</button>`)}
          ${Array.from({ length: Math.max(0, t.totalRounds - rounds.length) }, (_, i) => html`<button type="button" disabled aria-label="Round ${rounds.length + i + 1}, not paired yet">${rounds.length + i + 1}</button>`)}
        </div>
        <h2 class="section-title">Round ${shown.round}${shown.round === t.currentRound && t.status === 'in_progress' ? ', in progress' : ''}</h2>
        <div class="pairings">${shown.games.map((g) => pairingRow(g, ctx.me.id))}</div>
        <p class="small muted"><i class="piece-color w"></i> White <i class="piece-color b" style="margin-left:8px"></i> Black. Select any board to watch the game live.</p>`
        : emptyState('No pairings yet', 'Round 1 is paired when the tournament starts.');
    } else if (tab === 'standings') body = standingsTable(t);
    else if (tab === 'cross') body = crosstable(t);
    else body = playersGrid(t);

    el.innerHTML = html`
      <div class="page">
        <p class="small"><a href="#/tournaments">All tournaments</a></p>
        <header class="t-head">
          <div class="actions">
            ${{ registration: html`<span class="tag open">Taking players</span>`, in_progress: html`<span class="tag live">Round ${t.currentRound} of ${t.totalRounds}</span>`, finished: html`<span class="tag">Finished</span>` }[t.status]}
          </div>
          <h1 class="display page-title">${t.name}</h1>
          <div class="facts">
            <span><b>${formatLabel(t.format)}</b></span>
            <span>Each player has <b>${t.timeMinutes} min</b>${t.incrementSec ? html` plus <b>${t.incrementSec} s</b> per move` : ''}</span>
            <span><b>${t.playerCount}</b> player${t.playerCount === 1 ? '' : 's'}</span>
            ${t.totalRounds ? html`<span><b>${t.totalRounds}</b> rounds</span>` : ''}
            ${t.startsAt && !started ? html`<span>Starts <b>${fmtLong(t.startsAt)}</b></span>` : ''}
          </div>
          ${t.description ? html`<p class="desc">${t.description}</p>` : ''}
          <div class="actions">
            ${t.status === 'registration' ? (t.joined
              ? html`<button class="btn secondary" data-leave>Withdraw</button>`
              : html`<button class="btn" data-join>Join tournament</button>`) : ''}
            ${isAdmin() && t.status === 'registration' ? html`<button class="btn" data-start ${t.playerCount < 2 ? 'disabled' : ''}>Start and pair round 1</button>` : ''}
            ${isAdmin() ? html`<button class="btn ghost" data-delete>Delete</button>` : ''}
          </div>
          ${isAdmin() && t.status === 'registration' && t.playerCount < 2 ? html`<p class="small muted" style="margin:0">At least two players need to join before you can start.</p>` : ''}
        </header>

        ${myGame ? html`
          <section style="margin-bottom:28px">
            <h2 class="section-title">Your board this round</h2>
            <div class="pairings">${pairingRow(myGame, ctx.me.id)}</div>
          </section>` : ''}

        <div class="segmented" role="group" aria-label="View" style="margin-bottom:18px">
          ${tabs.map(([key, label]) => html`<button type="button" data-tab="${key}" aria-pressed="${String(tab === key)}">${label}</button>`)}
        </div>
        ${body}
      </div>`.s;

    for (const b of $$('[data-tab]', el)) b.onclick = () => { tab = b.dataset.tab; draw(); };
    for (const b of $$('[data-round]', el)) b.onclick = () => { round = Number(b.dataset.round); draw(); };

    const act = (sel, fn) => $(sel, el)?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        await fn();
      } catch (err) {
        toastError(err);
        if (scope.alive) draw();
      }
    });
    act('[data-join]', async () => { t = await api(`/api/tournaments/${id}/join`, { method: 'POST' }); toast('You’re in. You’ll get a notification when round 1 is paired.'); draw(); });
    act('[data-leave]', async () => { t = await api(`/api/tournaments/${id}/leave`, { method: 'POST' }); draw(); });
    act('[data-start]', async () => {
      const ok = await confirmDialog('Start the tournament?', `Registration closes and round 1 is paired for ${t.playerCount} players. Players are notified straight away.`, { confirmLabel: 'Start tournament' });
      if (!ok) return draw();
      t = await api(`/api/tournaments/${id}/start`, { method: 'POST' });
      tab = 'pairings';
      round = 1;
      draw();
    });
    act('[data-delete]', async () => {
      const ok = await confirmDialog('Delete this tournament?', 'All of its games and results are deleted. This can’t be undone.', { confirmLabel: 'Delete tournament', danger: true });
      if (!ok) return draw();
      await api(`/api/tournaments/${id}`, { method: 'DELETE' });
      location.hash = '#/tournaments';
    });
  }

  async function load() {
    const prevRound = t?.currentRound;
    t = await api(`/api/tournaments/${id}`);
    if (!scope.alive) return;
    // Follow the action when a new round is paired.
    if (prevRound && t.currentRound !== prevRound && round === prevRound) round = t.currentRound;
    if (prevRound === 0 && t.currentRound) tab = 'pairings';
    draw();
  }

  await load();
  scope.on('tournament:changed', (e) => e.id === Number(id) && load());
  const onPresence = () => tab === 'players' && draw();
  document.addEventListener('presence', onPresence);
  scope.onCleanup(() => document.removeEventListener('presence', onPresence));
}
