import { Chess } from 'chess.js';
import { db, getUser, publicUser, now, tx } from './db.js';
import { bus } from './bus.js';

export class GameError extends Error {}

const stmt = {
  get: db.prepare('SELECT * FROM games WHERE id = ?'),
  tournament: db.prepare('SELECT id, name, format FROM tournaments WHERE id = ?'),
  saveMove: db.prepare(`
    UPDATE games SET moves = ?, fen = ?, white_ms = ?, black_ms = ?, turn_started_at = ?, draw_offer_by = ?
    WHERE id = ?`),
  finish: db.prepare(`
    UPDATE games SET status = 'finished', result = ?, termination = ?, finished_at = ?,
      white_ms = ?, black_ms = ?, turn_started_at = NULL, draw_offer_by = NULL
    WHERE id = ?`),
  setDrawOffer: db.prepare('UPDATE games SET draw_offer_by = ? WHERE id = ?'),
  setRating: db.prepare('UPDATE users SET rating = ? WHERE id = ?'),
  clocksRunning: db.prepare(`SELECT * FROM games WHERE status = 'active' AND turn_started_at IS NOT NULL`),
};

export const getGame = (id) => stmt.get.get(id);

function replay(game) {
  const chess = new Chess();
  for (const san of JSON.parse(game.moves)) chess.move(san);
  return chess;
}

const sideToMove = (game) => game.fen.split(' ')[1];

/** Clocks as they stand at time t, charging the running side for its thinking time. */
function clocksAt(game, t) {
  let w = game.white_ms;
  let b = game.black_ms;
  if (game.status === 'active' && game.turn_started_at) {
    const elapsed = t - game.turn_started_at;
    if (sideToMove(game) === 'w') w -= elapsed;
    else b -= elapsed;
  }
  return [Math.max(0, w), Math.max(0, b)];
}

export function gameState(game) {
  const chess = replay(game);
  const history = chess.history({ verbose: true });
  const last = history.at(-1);
  return {
    id: game.id,
    tournament: game.tournament_id ? stmt.tournament.get(game.tournament_id) : null,
    round: game.round,
    board: game.board,
    white: publicUser(getUser(game.white_id)),
    black: publicUser(getUser(game.black_id)),
    fen: game.fen,
    moves: history.map((m) => m.san),
    lastMove: last ? { from: last.from, to: last.to } : null,
    turn: chess.turn(),
    inCheck: chess.inCheck(),
    status: game.status,
    result: game.result,
    termination: game.termination,
    whiteMs: game.white_ms,
    blackMs: game.black_ms,
    incrementMs: game.increment_ms,
    turnStartedAt: game.turn_started_at,
    drawOfferBy: game.draw_offer_by,
    createdAt: game.created_at,
    finishedAt: game.finished_at,
    serverNow: now(),
  };
}

function applyRatings(game, result) {
  const white = getUser(game.white_id);
  const black = getUser(game.black_id);
  if (!white || !black) return;
  const expected = 1 / (1 + 10 ** ((black.rating - white.rating) / 400));
  const score = result === '1-0' ? 1 : result === '0-1' ? 0 : 0.5;
  const delta = Math.round(32 * (score - expected));
  stmt.setRating.run(white.rating + delta, white.id);
  stmt.setRating.run(black.rating - delta, black.id);
}

export function finishGame(id, result, termination) {
  const game = getGame(id);
  if (!game || game.status === 'finished') return;
  const t = now();
  const [w, b] = clocksAt(game, t);
  tx(() => {
    stmt.finish.run(result, termination, t, w, b, id);
    applyRatings(game, result);
  });
  bus.emit('game', id);
  if (game.tournament_id) bus.emit('game-finished', getGame(id));
}

function colorOf(game, userId) {
  if (game.white_id === userId) return 'w';
  if (game.black_id === userId) return 'b';
  return null;
}

function activeGameFor(gameId, userId) {
  const game = getGame(gameId);
  if (!game) throw new GameError('Game not found');
  if (game.status !== 'active') throw new GameError('This game is already over');
  const color = colorOf(game, userId);
  if (!color) throw new GameError('You are not playing in this game');
  return { game, color };
}

export function makeMove(userId, gameId, { from, to, promotion }) {
  const { game, color } = activeGameFor(gameId, userId);
  const chess = replay(game);
  if (chess.turn() !== color) throw new GameError('Wait for your opponent to move');

  const t = now();
  let [w, b] = clocksAt(game, t);
  if ((color === 'w' ? w : b) <= 0) {
    finishGame(game.id, color === 'w' ? '0-1' : '1-0', 'time');
    throw new GameError('Your time ran out');
  }

  try {
    chess.move({ from, to, promotion: promotion || 'q' });
  } catch {
    throw new GameError('That move is not legal');
  }

  if (color === 'w') w += game.increment_ms;
  else b += game.increment_ms;

  const moves = chess.history();
  // An offer stands until the opponent replies with a move instead of accepting.
  const drawOffer = game.draw_offer_by === userId ? userId : null;
  stmt.saveMove.run(JSON.stringify(moves), chess.fen(), w, b, t, drawOffer, game.id);

  if (chess.isCheckmate()) return finishGame(game.id, color === 'w' ? '1-0' : '0-1', 'checkmate');
  if (chess.isStalemate()) return finishGame(game.id, '1/2-1/2', 'stalemate');
  if (chess.isThreefoldRepetition()) return finishGame(game.id, '1/2-1/2', 'repetition');
  if (chess.isInsufficientMaterial()) return finishGame(game.id, '1/2-1/2', 'insufficient material');
  if (chess.isDraw()) return finishGame(game.id, '1/2-1/2', 'fifty-move rule');
  bus.emit('game', game.id);
}

export function resign(userId, gameId) {
  const { game, color } = activeGameFor(gameId, userId);
  finishGame(game.id, color === 'w' ? '0-1' : '1-0', 'resignation');
}

export function offerDraw(userId, gameId) {
  const { game } = activeGameFor(gameId, userId);
  if (game.draw_offer_by && game.draw_offer_by !== userId) {
    return finishGame(game.id, '1/2-1/2', 'agreement');
  }
  stmt.setDrawOffer.run(userId, game.id);
  bus.emit('game', game.id);
}

export function answerDraw(userId, gameId, accept) {
  const { game } = activeGameFor(gameId, userId);
  if (!game.draw_offer_by || game.draw_offer_by === userId) {
    throw new GameError('There is no draw offer to answer');
  }
  if (accept) return finishGame(game.id, '1/2-1/2', 'agreement');
  stmt.setDrawOffer.run(null, game.id);
  bus.emit('game', game.id);
}

/** Called every second: flag anyone whose clock has reached zero. */
export function sweepClocks() {
  const t = now();
  for (const game of stmt.clocksRunning.all()) {
    const [w, b] = clocksAt(game, t);
    const color = sideToMove(game);
    if ((color === 'w' ? w : b) <= 0) finishGame(game.id, color === 'w' ? '0-1' : '1-0', 'time');
  }
}
