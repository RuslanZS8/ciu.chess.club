import { html, raw, $, api, avatar, fmtClock, describeResult, resultLabel, confirmDialog, toastError } from '../util.js';
import { ctx, emit, isAdmin } from '../state.js';
import { Board } from '../board.js';

const LOW_TIME_MS = 20_000;

export async function render(el, [id], scope) {
  const gameId = Number(id);
  let game = await api(`/api/games/${gameId}`);
  let offset = game.serverNow - Date.now();
  if (!scope.alive) return;

  const myColor = game.white?.id === ctx.me.id ? 'w' : game.black?.id === ctx.me.id ? 'b' : null;
  const orientation = myColor ?? 'w';
  const topColor = orientation === 'w' ? 'b' : 'w';
  const bottomColor = orientation;

  el.innerHTML = html`
    <div class="page">
      <p class="small" data-crumb></p>
      <div class="game">
        <div class="board-col">
          <div class="player-bar" data-bar="${topColor}"></div>
          <div data-board></div>
          <div class="player-bar" data-bar="${bottomColor}"></div>
        </div>
        <aside class="game-side">
          <div data-status></div>
          <div data-actions></div>
          <div>
            <h2 class="section-title" style="font-size:16px;margin-bottom:8px">Moves</h2>
            <div class="moves" data-moves></div>
          </div>
        </aside>
      </div>
    </div>`.s;

  const board = new Board($('[data-board]', el), {
    onMove: (move) => {
      emit('game:move', { gameId, ...move }).catch((err) => {
        toastError(err);
        applyState(game);
      });
    },
  });

  const player = (c) => (c === 'w' ? game.white : game.black);
  const clockMs = (c) => {
    const base = c === 'w' ? game.whiteMs : game.blackMs;
    if (game.status !== 'active' || !game.turnStartedAt || game.turn !== c) return base;
    return base - (Date.now() + offset - game.turnStartedAt);
  };

  function drawBars() {
    for (const c of ['w', 'b']) {
      const u = player(c);
      const bar = $(`[data-bar="${c}"]`, el);
      bar.innerHTML = html`
        ${avatar(u, 'sm', { online: u && ctx.online.has(u.id) })}
        <div class="who">
          <strong>${u?.id === ctx.me.id ? 'You' : u?.name ?? 'Unknown player'}</strong>
          <span><i class="piece-color ${c}"></i> ${c === 'w' ? 'White' : 'Black'}, ${u?.rating ?? ''}</span>
        </div>
        <div class="clock" data-clock="${c}" role="timer" aria-label="${c === 'w' ? 'White' : 'Black'} clock"></div>`.s;
    }
    tickClocks();
  }

  function tickClocks() {
    for (const c of ['w', 'b']) {
      const elc = $(`[data-clock="${c}"]`, el);
      if (!elc) continue;
      const ms = clockMs(c);
      const running = game.status === 'active' && !!game.turnStartedAt && game.turn === c;
      elc.textContent = fmtClock(ms);
      elc.classList.toggle('running', running);
      elc.classList.toggle('low', running && ms < LOW_TIME_MS);
    }
  }

  function drawStatus() {
    const st = $('[data-status]', el);
    if (game.status === 'finished') {
      st.innerHTML = html`<div class="result-banner"><b>${resultLabel(game.result)}</b>${describeResult(game)}</div>`.s;
      return;
    }
    const turnPlayer = player(game.turn);
    let line;
    if (myColor) line = game.turn === myColor ? 'Your move' : `Waiting for ${turnPlayer?.firstName ?? 'your opponent'}`;
    else line = `${game.turn === 'w' ? 'White' : 'Black'} to move`;
    const hint = !game.turnStartedAt ? 'Clocks start after White’s first move.' : game.inCheck ? 'Check!' : '';
    st.innerHTML = html`
      <div class="panel" style="padding:14px 16px">
        <strong style="font-size:18px">${line}</strong>
        ${hint ? html`<div class="small muted">${hint}</div>` : ''}
      </div>`.s;
  }

  function drawActions() {
    const box = $('[data-actions]', el);
    if (game.status !== 'active') {
      box.innerHTML = game.tournament
        ? html`<a class="btn secondary block" href="#/tournaments/${game.tournament.id}">Back to ${game.tournament.name}</a>`.s
        : '';
      return;
    }
    const oppOffered = game.drawOfferBy && game.drawOfferBy !== ctx.me.id;
    const iOffered = game.drawOfferBy === ctx.me.id;
    box.innerHTML = html`
      ${myColor && oppOffered ? html`
        <div class="draw-offer" style="margin-bottom:10px">
          <strong>${player(myColor === 'w' ? 'b' : 'w')?.firstName} offers a draw</strong>
          <div class="actions">
            <button class="btn small" data-accept>Accept draw</button>
            <button class="btn secondary small" data-decline>Decline</button>
          </div>
        </div>` : ''}
      ${myColor ? html`
        <div class="actions">
          <button class="btn secondary" data-draw ${iOffered ? 'disabled' : ''}>${iOffered ? 'Draw offered' : 'Offer draw'}</button>
          <button class="btn danger" data-resign>Resign</button>
        </div>` : html`<p class="small muted" style="margin:0">You’re watching this game. Moves appear live.</p>`}
      ${isAdmin() ? html`
        <details style="margin-top:14px">
          <summary class="small muted" style="cursor:pointer">Admin: set the result</summary>
          <p class="small muted">Use this for no-shows or disconnections. Ratings update as if the game was played.</p>
          <div class="actions">
            <button class="btn secondary small" data-set="1-0">White wins</button>
            <button class="btn secondary small" data-set="1/2-1/2">Draw</button>
            <button class="btn secondary small" data-set="0-1">Black wins</button>
          </div>
        </details>` : ''}`.s;

    const on = (sel, fn) => $(sel, box)?.addEventListener('click', (e) => {
      const target = e.currentTarget;
      target.disabled = true;
      Promise.resolve(fn(target)).catch(toastError).finally(() => { target.disabled = false; });
    });
    on('[data-accept]', () => emit('game:answerDraw', { gameId, accept: true }));
    on('[data-decline]', () => emit('game:answerDraw', { gameId, accept: false }));
    on('[data-draw]', () => emit('game:offerDraw', { gameId }));
    on('[data-resign]', async () => {
      if (await confirmDialog('Resign this game?', 'Your opponent gets the point.', { confirmLabel: 'Resign', danger: true })) {
        await emit('game:resign', { gameId });
      }
    });
    for (const b of box.querySelectorAll('[data-set]')) {
      on(`[data-set="${b.dataset.set}"]`, async (btn) => {
        if (await confirmDialog('Set the result?', `The game ends now with the result ${resultLabel(btn.dataset.set)}.`, { confirmLabel: 'Set result' })) {
          await api(`/api/games/${gameId}/result`, { method: 'POST', body: { result: btn.dataset.set } });
        }
      });
    }
  }

  function drawMoves() {
    const box = $('[data-moves]', el);
    if (!game.moves.length) {
      box.innerHTML = '<span class="muted" style="grid-column:1/-1;padding:8px 12px">No moves yet</span>';
      return;
    }
    let out = '';
    for (let i = 0; i < game.moves.length; i += 2) {
      const cur = (j) => (j === game.moves.length - 1 ? ' class="cur"' : '');
      out += html`<span class="n">${i / 2 + 1}.</span>`.s;
      out += html`<span${raw(cur(i))}>${game.moves[i]}</span>`.s;
      out += game.moves[i + 1] ? html`<span${raw(cur(i + 1))}>${game.moves[i + 1]}</span>`.s : '<span></span>';
    }
    box.innerHTML = out;
    box.scrollTop = box.scrollHeight;
  }

  function applyState(state) {
    const wasActive = game.status === 'active';
    game = state;
    offset = state.serverNow - Date.now();
    $('[data-crumb]', el).innerHTML = game.tournament
      ? html`<a href="#/tournaments/${game.tournament.id}">${game.tournament.name}</a>, round ${game.round}, board ${game.board}`.s
      : '';
    board.set({
      fen: game.fen,
      orientation,
      myColor: game.status === 'active' ? myColor : null,
      lastMove: game.lastMove,
    });
    drawBars();
    drawStatus();
    drawActions();
    drawMoves();
    if (wasActive && game.status === 'finished') document.title = `${resultLabel(game.result)} | ${ctx.config.clubName}`;
  }

  applyState(game);

  scope.on('game:state', (state) => state.id === gameId && applyState(state));
  // Re-subscribe after a reconnect so the board never goes stale.
  const watch = () => emit('game:watch', { gameId }).catch(() => {});
  watch();
  scope.on('connect', watch);
  scope.every(100, tickClocks);
  const onPresence = () => drawBars();
  document.addEventListener('presence', onPresence);
  scope.onCleanup(() => {
    document.removeEventListener('presence', onPresence);
    document.title = ctx.config.clubName;
    ctx.socket?.emit('game:unwatch', { gameId });
  });
}
