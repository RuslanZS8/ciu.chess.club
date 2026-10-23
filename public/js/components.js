import { html, avatar, resultLabel, monthShort } from './util.js';

export function dateBlock(ts) {
  const d = new Date(ts);
  return html`<div class="date-block" aria-hidden="true"><small>${monthShort(ts)}</small><b>${d.getDate()}</b></div>`;
}

function sidePlayer(user, color) {
  return html`
    <div class="side-player ${color === 'w' ? 'white' : 'black'}">
      ${avatar(user, 'sm')}
      <div class="who">
        <strong>${user ? user.name : 'Bye'}</strong>
        <span><i class="piece-color ${color}" aria-label="${color === 'w' ? 'White' : 'Black'}"></i> ${user ? user.rating : ''}</span>
      </div>
    </div>`;
}

/** One board on a pairing chart: White on the left, Black on the right, board number between. */
export function pairingRow(g, meId) {
  const mine = g.white?.id === meId || g.black?.id === meId;
  const bye = g.result === 'bye';
  const centre = bye
    ? html`<span class="tag">Bye</span>`
    : g.status === 'active'
      ? html`<span class="tag live">Playing</span>`
      : html`<b>${resultLabel(g.result)}</b>`;
  const inner = html`
    ${sidePlayer(g.white, 'w')}
    <div class="board-no"><small>Board ${g.board}</small>${centre}</div>
    ${bye ? html`<div class="side-player black muted small">${g.white?.firstName} sits out this round</div>` : sidePlayer(g.black, 'b')}`;
  return bye
    ? html`<div class="pairing${mine ? ' mine' : ''}">${inner}</div>`
    : html`<a class="pairing${mine ? ' mine' : ''}" href="#/games/${g.id}" aria-label="Board ${g.board}: ${g.white?.name} against ${g.black?.name}">${inner}</a>`;
}

/** Large "you vs them" card for the viewer's current game. */
export function faceoff(game, meId) {
  const meWhite = game.white?.id === meId;
  const me = meWhite ? game.white : game.black;
  const opp = meWhite ? game.black : game.white;
  const yourTurn = game.turn === (meWhite ? 'w' : 'b');
  return html`
    <section class="faceoff" aria-label="Your current game">
      <div class="person">
        ${avatar(me, 'xl')}
        <strong>You</strong>
        <span>${meWhite ? 'White' : 'Black'}, rated ${me.rating}</span>
      </div>
      <div class="mid">
        <small>${game.tournament?.name ?? 'Casual game'}${game.round ? `, round ${game.round}` : ''}</small>
        <div class="mini-square" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <a class="btn" href="#/games/${game.id}">${game.moves.length === 0 && meWhite ? 'Make the first move' : yourTurn ? 'Your move' : 'Open board'}</a>
      </div>
      <div class="person">
        ${avatar(opp, 'xl')}
        <strong>${opp?.name ?? 'Opponent'}</strong>
        <span>${meWhite ? 'Black' : 'White'}, rated ${opp?.rating ?? ''}</span>
      </div>
    </section>`;
}
