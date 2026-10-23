import { db, getUser, publicUser, now, tx } from './db.js';
import { bus } from './bus.js';

const stmt = {
  get: db.prepare('SELECT * FROM tournaments WHERE id = ?'),
  players: db.prepare(`
    SELECT u.*, tp.seed FROM tournament_players tp JOIN users u ON u.id = tp.user_id
    WHERE tp.tournament_id = ? ORDER BY tp.joined_at`),
  games: db.prepare('SELECT * FROM games WHERE tournament_id = ? ORDER BY round, board'),
  openGamesInRound: db.prepare(`
    SELECT COUNT(*) AS n FROM games WHERE tournament_id = ? AND round = ? AND status = 'active'`),
  setSeed: db.prepare('UPDATE tournament_players SET seed = ? WHERE tournament_id = ? AND user_id = ?'),
  start: db.prepare(`UPDATE tournaments SET status = 'in_progress', total_rounds = ? WHERE id = ?`),
  setRound: db.prepare('UPDATE tournaments SET current_round = ? WHERE id = ?'),
  finish: db.prepare(`UPDATE tournaments SET status = 'finished' WHERE id = ?`),
  insertGame: db.prepare(`
    INSERT INTO games (tournament_id, round, board, white_id, black_id, status, result, termination,
                       white_ms, black_ms, increment_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
};

export class TournamentError extends Error {}

export const getTournament = (id) => stmt.get.get(id);

/**
 * Scores, colour history and tie-breaks for every player, sorted into the standings.
 * Swiss uses Buchholz (sum of opponents' scores); round robin uses Sonneborn-Berger.
 */
export function standings(t) {
  const players = stmt.players.all(t.id);
  const games = stmt.games.all(t.id);
  const rows = new Map(players.map((u) => [u.id, {
    user: u, points: 0, wins: 0, draws: 0, losses: 0, byes: 0,
    opponents: [], colors: [], results: [],
  }]));

  for (const g of games) {
    const w = rows.get(g.white_id);
    const b = rows.get(g.black_id);
    if (g.result === 'bye') {
      if (w) {
        w.byes++;
        if (t.format === 'swiss') w.points += 1;
      }
      continue;
    }
    if (w) { w.colors.push('w'); w.opponents.push(g.black_id); }
    if (b) { b.colors.push('b'); b.opponents.push(g.white_id); }
    if (g.status !== 'finished') continue;
    const ws = g.result === '1-0' ? 1 : g.result === '0-1' ? 0 : 0.5;
    for (const [row, score, opp] of [[w, ws, g.black_id], [b, 1 - ws, g.white_id]]) {
      if (!row) continue;
      row.points += score;
      row.results.push({ opp, score });
      if (score === 1) row.wins++;
      else if (score === 0) row.losses++;
      else row.draws++;
    }
  }

  for (const row of rows.values()) {
    row.tiebreak = t.format === 'swiss'
      ? row.results.reduce((sum, r) => sum + (rows.get(r.opp)?.points ?? 0), 0)
      : row.results.reduce((sum, r) => sum + r.score * (rows.get(r.opp)?.points ?? 0), 0);
  }

  return [...rows.values()].sort((a, b) =>
    b.points - a.points || b.tiebreak - a.tiebreak || b.user.rating - a.user.rating);
}

const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** Pair top-down, never repeating a pairing; backtracks when it gets stuck. */
function pairWithoutRematches(list, played) {
  let budget = 200_000;
  const go = (rest) => {
    if (!rest.length) return [];
    if (--budget < 0) return null;
    const [a, ...others] = rest;
    for (let i = 0; i < others.length; i++) {
      const b = others[i];
      if (played.has(pairKey(a.user.id, b.user.id))) continue;
      const sub = go(others.filter((_, j) => j !== i));
      if (sub) return [[a, b], ...sub];
    }
    return null;
  };
  return go(list);
}

function assignColors(a, b) {
  const balance = (row) => row.colors.filter((c) => c === 'w').length - row.colors.filter((c) => c === 'b').length;
  const ba = balance(a);
  const bb = balance(b);
  if (ba !== bb) return ba < bb ? [a, b] : [b, a];
  return a.colors.at(-1) === 'w' ? [b, a] : [a, b];
}

function swissPairings(t) {
  let list = standings(t);
  let bye = null;
  if (list.length % 2) {
    bye = [...list].reverse().find((r) => r.byes === 0) ?? list.at(-1);
    list = list.filter((r) => r !== bye);
  }
  const played = new Set();
  for (const row of list) for (const opp of row.opponents) played.add(pairKey(row.user.id, opp));

  let pairs = pairWithoutRematches(list, played);
  if (!pairs) {
    pairs = [];
    for (let i = 0; i < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
  }
  return {
    pairs: pairs.map(([a, b]) => assignColors(a, b).map((r) => r.user.id)),
    bye: bye?.user.id ?? null,
  };
}

/** Circle method: seat 1 stays put, everyone else rotates one place per round. */
function roundRobinPairings(t, round) {
  const seats = stmt.players.all(t.id).sort((a, b) => a.seed - b.seed).map((u) => u.id);
  if (seats.length % 2) seats.push(null);
  const n = seats.length;
  const rest = seats.slice(1);
  for (let k = 1; k < round; k++) rest.unshift(rest.pop());
  const order = [seats[0], ...rest];

  const pairs = [];
  let bye = null;
  for (let i = 0; i < n / 2; i++) {
    let a = order[i];
    let b = order[n - 1 - i];
    if (a === null || b === null) {
      bye = a ?? b;
      continue;
    }
    if ((i + round) % 2 === 0) [a, b] = [b, a];
    pairs.push([a, b]);
  }
  return { pairs, bye };
}

function pairRound(t, round) {
  const { pairs, bye } = t.format === 'swiss' ? swissPairings(t) : roundRobinPairings(t, round);
  const ms = t.time_minutes * 60_000;
  const inc = t.increment_sec * 1000;
  const created = now();

  const gameIds = tx(() => {
    const ids = [];
    let board = 1;
    for (const [white, black] of pairs) {
      const r = stmt.insertGame.run(t.id, round, board++, white, black, 'active', null, null, ms, ms, inc, created);
      ids.push({ id: Number(r.lastInsertRowid), white, black });
    }
    if (bye) stmt.insertGame.run(t.id, round, board, bye, null, 'finished', 'bye', 'bye', ms, ms, inc, created);
    stmt.setRound.run(round, t.id);
    return ids;
  });

  bus.emit('announce', `${t.name}: round ${round} of ${t.total_rounds} is paired. Open the tournament to find your board and opponent.`);
  bus.emit('round', { tournament: t, games: gameIds, bye });
  bus.emit('tournament', t.id);

  // A round made only of a bye (can't happen with 2+ players) would otherwise stall.
  if (!gameIds.length) advance(getTournament(t.id));
}

export function startTournament(id) {
  const t = getTournament(id);
  if (!t) throw new TournamentError('Tournament not found');
  if (t.status !== 'registration') throw new TournamentError('This tournament has already started');
  const players = stmt.players.all(id);
  if (players.length < 2) throw new TournamentError('At least two players must join before you can start');

  const seeded = [...players].sort((a, b) => b.rating - a.rating || Math.random() - 0.5);
  let rounds;
  if (t.format === 'round_robin') {
    rounds = players.length % 2 ? players.length : players.length - 1;
  } else {
    const suggested = Math.ceil(Math.log2(players.length)) + 1;
    rounds = Math.min(t.total_rounds || suggested, players.length - 1 || 1);
  }

  tx(() => {
    seeded.forEach((u, i) => stmt.setSeed.run(i + 1, id, u.id));
    stmt.start.run(rounds, id);
  });
  pairRound(getTournament(id), 1);
}

function advance(t) {
  if (t.current_round < t.total_rounds) return pairRound(t, t.current_round + 1);
  stmt.finish.run(t.id);
  const [winner, second] = standings(t);
  if (winner) {
    const shared = second && second.points === winner.points && second.tiebreak === winner.tiebreak;
    bus.emit('announce', shared
      ? `${t.name} is over. ${winner.user.first_name} ${winner.user.last_name} and ${second.user.first_name} ${second.user.last_name} share first place with ${winner.points} points.`
      : `${t.name} is over. ${winner.user.first_name} ${winner.user.last_name} wins with ${winner.points} points. Congratulations!`);
  }
  bus.emit('tournament', t.id);
}

bus.on('game-finished', (game) => {
  const t = getTournament(game.tournament_id);
  if (!t || t.status !== 'in_progress' || game.round !== t.current_round) {
    bus.emit('tournament', game.tournament_id);
    return;
  }
  if (stmt.openGamesInRound.get(t.id, t.current_round).n > 0) {
    bus.emit('tournament', t.id);
    return;
  }
  advance(t);
});

export function tournamentSummary(t, viewerId) {
  const players = stmt.players.all(t.id);
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    format: t.format,
    totalRounds: t.total_rounds,
    currentRound: t.current_round,
    timeMinutes: t.time_minutes,
    incrementSec: t.increment_sec,
    status: t.status,
    startsAt: t.starts_at,
    playerCount: players.length,
    joined: players.some((p) => p.id === viewerId),
  };
}

export function tournamentDetail(t, viewerId) {
  const games = stmt.games.all(t.id);
  const users = new Map();
  const user = (id) => {
    if (id == null) return null;
    if (!users.has(id)) users.set(id, publicUser(getUser(id)));
    return users.get(id);
  };

  const rounds = [];
  for (const g of games) {
    let r = rounds.find((x) => x.round === g.round);
    if (!r) rounds.push((r = { round: g.round, games: [] }));
    r.games.push({
      id: g.id,
      board: g.board,
      white: user(g.white_id),
      black: user(g.black_id),
      status: g.status,
      result: g.result,
      termination: g.termination,
    });
  }

  return {
    ...tournamentSummary(t, viewerId),
    players: stmt.players.all(t.id).map((u) => ({ ...publicUser(u), seed: u.seed })),
    standings: standings(t).map((row) => ({
      player: user(row.user.id),
      points: row.points,
      tiebreak: row.tiebreak,
      wins: row.wins,
      draws: row.draws,
      losses: row.losses,
      byes: row.byes,
    })),
    rounds,
  };
}
