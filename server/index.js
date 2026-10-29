import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import multer from 'multer';
import bcrypt from 'bcryptjs';

import { db, tx, now, getUser, publicUser, UPLOAD_DIR } from './db.js';
import { bus } from './bus.js';
import * as games from './games.js';
import * as tournaments from './tournaments.js';

const PORT = Number(process.env.PORT) || 3000;
const CLUB_NAME = process.env.CLUB_NAME || 'Chess Club';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const ADMIN_STUDENT_IDS = new Set((process.env.ADMIN_STUDENT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const SESSION_DAYS = 30;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const route = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res);
    if (out instanceof Promise) out.catch(next);
  } catch (err) {
    next(err);
  }
};

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const sessionStmt = db.prepare(`
  SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token = ? AND s.created_at > ?`);

function userFromCookie(header) {
  const token = parseCookies(header).sid;
  if (!token) return null;
  return sessionStmt.get(token, now() - SESSION_DAYS * 86_400_000) ?? null;
}

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, now());
  res.cookie('sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: SESSION_DAYS * 86_400_000,
  });
}

app.use((req, _res, next) => {
  req.user = userFromCookie(req.headers.cookie);
  next();
});

function requireUser(req) {
  if (!req.user) throw new HttpError(401, 'Log in to continue');
  return req.user;
}

function requireAdmin(req) {
  const user = requireUser(req);
  if (user.role !== 'admin') throw new HttpError(403, 'Only club admins can do this');
  return user;
}

function text(value, label, { min = 1, max = 200 } = {}) {
  const v = String(value ?? '').trim();
  if (v.length < min) throw new HttpError(400, `${label} is required`);
  if (v.length > max) throw new HttpError(400, `${label} must be at most ${max} characters`);
  return v;
}

function int(value, label, { min, max }) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

function timestamp(value, label) {
  const n = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(n)) throw new HttpError(400, `${label} must be a valid date and time`);
  return n;
}

// ---------- photo uploads ----------

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + IMAGE_TYPES[file.mimetype]),
  }),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_TYPES[file.mimetype]) cb(null, true);
    else cb(new HttpError(400, 'Photo must be a JPG, PNG, WebP or GIF image'));
  },
});

function removeUpload(filename) {
  if (filename) fs.rm(path.join(UPLOAD_DIR, path.basename(filename)), { force: true }, () => {});
}

/** Wrap a multipart handler so a rejected request doesn't leave its photo behind. */
const withPhoto = (fn) => [
  upload.single('photo'),
  (req, res, next) => {
    try {
      fn(req, res);
    } catch (err) {
      removeUpload(req.file?.filename);
      next(err);
    }
  },
];

// ---------- auth & profile ----------

app.get('/api/config', (_req, res) => res.json({ clubName: CLUB_NAME }));

app.post('/api/register', ...withPhoto((req, res) => {
  const studentId = text(req.body.studentId, 'Student ID', { min: 3, max: 32 });
  if (!/^[A-Za-z0-9-]+$/.test(studentId)) {
    throw new HttpError(400, 'Student ID can only contain letters, numbers and dashes');
  }
  const firstName = text(req.body.firstName, 'First name', { max: 50 });
  const lastName = text(req.body.lastName, 'Surname', { max: 50 });
  const password = String(req.body.password ?? '');
  if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  if (!req.file) throw new HttpError(400, 'Add a photo so opponents can recognise you');
  // Optional: players who already have an Elo (FIDE, national, online) start from it.
  const elo = String(req.body.rating ?? '').trim();
  const rating = elo === '' ? 1200 : int(elo, 'Elo rating', { min: 100, max: 3000 });

  const exists = db.prepare('SELECT 1 FROM users WHERE student_id = ?').get(studentId);
  if (exists) throw new HttpError(409, 'An account with this student ID already exists. Log in instead.');

  const user = tx(() => {
    // Listed student IDs run the club; without a list, the first person to register does.
    const isAdmin = ADMIN_STUDENT_IDS.size
      ? ADMIN_STUDENT_IDS.has(studentId)
      : db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
    const role = isAdmin ? 'admin' : 'member';
    const r = db.prepare(`
      INSERT INTO users (student_id, first_name, last_name, password_hash, photo, role, rating, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(studentId, firstName, lastName, bcrypt.hashSync(password, 10), req.file.filename, role, rating, now());
    return getUser(Number(r.lastInsertRowid));
  });
  startSession(res, user.id);
  res.status(201).json(publicUser(user, { withStudentId: true }));
}));

app.post('/api/login', route((req, res) => {
  const studentId = String(req.body.studentId ?? '').trim();
  const user = db.prepare('SELECT * FROM users WHERE student_id = ?').get(studentId);
  if (!user || !bcrypt.compareSync(String(req.body.password ?? ''), user.password_hash)) {
    throw new HttpError(401, 'Student ID or password is incorrect');
  }
  startSession(res, user.id);
  res.json(publicUser(user, { withStudentId: true }));
}));

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie('sid');
  res.json({ ok: true });
});

app.get('/api/me', route((req, res) => {
  res.json(req.user ? publicUser(req.user, { withStudentId: true }) : null);
}));

app.put('/api/me', ...withPhoto((req, res) => {
  const user = requireUser(req);
  const firstName = text(req.body.firstName, 'First name', { max: 50 });
  const lastName = text(req.body.lastName, 'Surname', { max: 50 });
  const password = String(req.body.password ?? '');
  if (password && password.length < 6) throw new HttpError(400, 'New password must be at least 6 characters');

  db.prepare('UPDATE users SET first_name = ?, last_name = ? WHERE id = ?').run(firstName, lastName, user.id);
  if (password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), user.id);
  if (req.file) {
    db.prepare('UPDATE users SET photo = ? WHERE id = ?').run(req.file.filename, user.id);
    removeUpload(user.photo);
  }
  res.json(publicUser(getUser(user.id), { withStudentId: true }));
}));

// ---------- members ----------

app.get('/api/members', route((req, res) => {
  const viewer = requireUser(req);
  const rows = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM games g WHERE g.status = 'finished' AND g.result != 'bye'
         AND (g.white_id = u.id OR g.black_id = u.id)) AS played,
      (SELECT COUNT(*) FROM games g WHERE (g.white_id = u.id AND g.result = '1-0')
         OR (g.black_id = u.id AND g.result = '0-1')) AS wins
    FROM users u ORDER BY u.rating DESC, u.last_name`).all();
  res.json(rows.map((u) => ({
    ...publicUser(u, { withStudentId: viewer.role === 'admin' }),
    played: u.played,
    wins: u.wins,
    joinedAt: u.created_at,
  })));
}));

app.patch('/api/members/:id/role', route((req, res) => {
  const admin = requireAdmin(req);
  const target = getUser(Number(req.params.id));
  if (!target) throw new HttpError(404, 'Member not found');
  const role = req.body.role === 'admin' ? 'admin' : 'member';
  if (target.id === admin.id && role !== 'admin') {
    throw new HttpError(400, 'You can’t remove your own admin role. Ask another admin to do it.');
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
  res.json(publicUser(getUser(target.id), { withStudentId: true }));
}));

// ---------- events ----------

function eventView(e, viewerId) {
  const attendees = db.prepare(`
    SELECT u.* FROM event_attendees a JOIN users u ON u.id = a.user_id WHERE a.event_id = ?`).all(e.id);
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    location: e.location,
    startsAt: e.starts_at,
    attendees: attendees.map((u) => publicUser(u)),
    going: attendees.some((u) => u.id === viewerId),
  };
}

function readEvent(body) {
  return {
    title: text(body.title, 'Title', { max: 120 }),
    description: text(body.description, 'Description', { min: 0, max: 2000 }),
    location: text(body.location, 'Location', { min: 0, max: 120 }),
    startsAt: timestamp(body.startsAt, 'Start time'),
  };
}

const formatWhen = (ts) => new Date(ts).toLocaleString('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
});

app.get('/api/events', route((req, res) => {
  const viewer = requireUser(req);
  const rows = db.prepare('SELECT * FROM events ORDER BY starts_at').all();
  res.json(rows.map((e) => eventView(e, viewer.id)));
}));

app.post('/api/events', route((req, res) => {
  const admin = requireAdmin(req);
  const e = readEvent(req.body);
  const r = db.prepare(`
    INSERT INTO events (title, description, location, starts_at, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(e.title, e.description, e.location, e.startsAt, admin.id, now());
  if (req.body.announce !== false) {
    postMessage(admin.id, `New event: ${e.title}, ${formatWhen(e.startsAt)}${e.location ? ` at ${e.location}` : ''}. RSVP on the Events page.`, true);
  }
  res.status(201).json(eventView(db.prepare('SELECT * FROM events WHERE id = ?').get(r.lastInsertRowid), admin.id));
}));

app.put('/api/events/:id', route((req, res) => {
  const admin = requireAdmin(req);
  const e = readEvent(req.body);
  const r = db.prepare('UPDATE events SET title = ?, description = ?, location = ?, starts_at = ? WHERE id = ?')
    .run(e.title, e.description, e.location, e.startsAt, Number(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Event not found');
  res.json(eventView(db.prepare('SELECT * FROM events WHERE id = ?').get(Number(req.params.id)), admin.id));
}));

app.delete('/api/events/:id', route((req, res) => {
  requireAdmin(req);
  db.prepare('DELETE FROM events WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
}));

app.post('/api/events/:id/rsvp', route((req, res) => {
  const user = requireUser(req);
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(Number(req.params.id));
  if (!event) throw new HttpError(404, 'Event not found');
  if (req.body.going) {
    db.prepare('INSERT OR IGNORE INTO event_attendees (event_id, user_id) VALUES (?, ?)').run(event.id, user.id);
  } else {
    db.prepare('DELETE FROM event_attendees WHERE event_id = ? AND user_id = ?').run(event.id, user.id);
  }
  res.json(eventView(event, user.id));
}));

// ---------- chat ----------

function messageView(m) {
  return {
    id: m.id,
    body: m.body,
    announcement: !!m.is_announcement,
    createdAt: m.created_at,
    author: publicUser(getUser(m.user_id)),
  };
}

function postMessage(userId, body, announcement) {
  const r = db.prepare('INSERT INTO messages (user_id, body, is_announcement, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, body, announcement ? 1 : 0, now());
  const msg = messageView(db.prepare('SELECT * FROM messages WHERE id = ?').get(r.lastInsertRowid));
  io.to('members').emit('chat:message', msg);
  return msg;
}

app.get('/api/messages', route((req, res) => {
  requireUser(req);
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const onlyAnnouncements = req.query.announcements === '1';
  const limit = Math.min(Number(req.query.limit) || 60, 200);
  const rows = db.prepare(`
    SELECT * FROM messages WHERE id < ? ${onlyAnnouncements ? 'AND is_announcement = 1' : ''}
    ORDER BY id DESC LIMIT ?`).all(before, limit);
  res.json(rows.reverse().map(messageView));
}));

app.delete('/api/messages/:id', route((req, res) => {
  requireAdmin(req);
  db.prepare('DELETE FROM messages WHERE id = ?').run(Number(req.params.id));
  io.to('members').emit('chat:deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
}));

// ---------- tournaments ----------

function loadTournament(req) {
  const t = tournaments.getTournament(Number(req.params.id));
  if (!t) throw new HttpError(404, 'Tournament not found');
  return t;
}

app.get('/api/tournaments', route((req, res) => {
  const viewer = requireUser(req);
  const rows = db.prepare(`
    SELECT * FROM tournaments
    ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'registration' THEN 1 ELSE 2 END, created_at DESC`).all();
  res.json(rows.map((t) => tournaments.tournamentSummary(t, viewer.id)));
}));

app.post('/api/tournaments', route((req, res) => {
  const admin = requireAdmin(req);
  const name = text(req.body.name, 'Name', { max: 100 });
  const description = text(req.body.description, 'Description', { min: 0, max: 2000 });
  const format = req.body.format === 'round_robin' ? 'round_robin' : 'swiss';
  const rounds = format === 'swiss' && req.body.rounds ? int(req.body.rounds, 'Rounds', { min: 1, max: 15 }) : 0;
  const minutes = int(req.body.timeMinutes, 'Minutes per player', { min: 1, max: 180 });
  const increment = int(req.body.incrementSec ?? 0, 'Increment', { min: 0, max: 60 });
  const startsAt = req.body.startsAt ? timestamp(req.body.startsAt, 'Start time') : null;

  const r = db.prepare(`
    INSERT INTO tournaments (name, description, format, total_rounds, time_minutes, increment_sec, starts_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(name, description, format, rounds, minutes, increment, startsAt, now());
  const label = format === 'swiss' ? 'Swiss' : 'round robin';
  postMessage(admin.id, `New tournament: ${name} (${label}, ${minutes}+${increment}). Join it on the Tournaments page${startsAt ? ` before ${formatWhen(startsAt)}` : ''}.`, true);
  const t = tournaments.getTournament(Number(r.lastInsertRowid));
  io.to('members').emit('tournaments:changed');
  res.status(201).json(tournaments.tournamentSummary(t, admin.id));
}));

app.get('/api/tournaments/:id', route((req, res) => {
  const viewer = requireUser(req);
  res.json(tournaments.tournamentDetail(loadTournament(req), viewer.id));
}));

app.post('/api/tournaments/:id/join', route((req, res) => {
  const user = requireUser(req);
  const t = loadTournament(req);
  if (t.status !== 'registration') throw new HttpError(400, 'Registration for this tournament is closed');
  db.prepare('INSERT OR IGNORE INTO tournament_players (tournament_id, user_id, joined_at) VALUES (?, ?, ?)')
    .run(t.id, user.id, now());
  bus.emit('tournament', t.id);
  res.json(tournaments.tournamentDetail(t, user.id));
}));

app.post('/api/tournaments/:id/leave', route((req, res) => {
  const user = requireUser(req);
  const t = loadTournament(req);
  if (t.status !== 'registration') throw new HttpError(400, 'You can’t withdraw after the tournament has started');
  db.prepare('DELETE FROM tournament_players WHERE tournament_id = ? AND user_id = ?').run(t.id, user.id);
  bus.emit('tournament', t.id);
  res.json(tournaments.tournamentDetail(t, user.id));
}));

app.post('/api/tournaments/:id/start', route((req, res) => {
  const admin = requireAdmin(req);
  const t = loadTournament(req);
  try {
    tournaments.startTournament(t.id);
  } catch (err) {
    if (err instanceof tournaments.TournamentError) throw new HttpError(400, err.message);
    throw err;
  }
  res.json(tournaments.tournamentDetail(tournaments.getTournament(t.id), admin.id));
}));

app.delete('/api/tournaments/:id', route((req, res) => {
  requireAdmin(req);
  const t = loadTournament(req);
  db.prepare('DELETE FROM tournaments WHERE id = ?').run(t.id);
  io.to('members').emit('tournaments:changed');
  res.json({ ok: true });
}));

// ---------- games ----------

app.get('/api/my/games', route((req, res) => {
  const user = requireUser(req);
  const rows = db.prepare(`
    SELECT * FROM games WHERE (white_id = ? OR black_id = ?) AND result IS NOT 'bye'
    ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at DESC LIMIT 20`).all(user.id, user.id);
  res.json(rows.map(games.gameState));
}));

app.get('/api/games/:id', route((req, res) => {
  requireUser(req);
  const game = games.getGame(Number(req.params.id));
  if (!game) throw new HttpError(404, 'Game not found');
  res.json(games.gameState(game));
}));

app.post('/api/games/:id/result', route((req, res) => {
  requireAdmin(req);
  const game = games.getGame(Number(req.params.id));
  if (!game) throw new HttpError(404, 'Game not found');
  if (game.status !== 'active') throw new HttpError(400, 'This game already has a result');
  if (!['1-0', '0-1', '1/2-1/2'].includes(req.body.result)) throw new HttpError(400, 'Choose a result');
  games.finishGame(game.id, req.body.result, 'set by admin');
  res.json(games.gameState(games.getGame(game.id)));
}));

// ---------- static files ----------

app.use('/uploads', express.static(UPLOAD_DIR, {
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
}));
app.get('/vendor/chess.js', (_req, res) => res.sendFile(path.join(root, 'node_modules/chess.js/dist/esm/chess.js')));
app.get('/vendor/three.js', (_req, res) => res.sendFile(path.join(root, 'node_modules/three/build/three.module.min.js')));
app.use(express.static(path.join(root, 'public')));

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Photo must be smaller than 4 MB' : err.message;
    return res.status(400).json({ error: message });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
});

// ---------- real-time ----------

io.use((socket, next) => {
  const user = userFromCookie(socket.handshake.headers.cookie);
  if (!user) return next(new Error('unauthorized'));
  socket.data.userId = user.id;
  next();
});

const online = new Map(); // userId -> number of open sockets

function broadcastOnline() {
  io.to('members').emit('presence', [...online.keys()]);
}

io.on('connection', (socket) => {
  const userId = socket.data.userId;
  socket.join('members');
  socket.join(`user:${userId}`);
  online.set(userId, (online.get(userId) ?? 0) + 1);
  broadcastOnline();

  const on = (event, fn) => socket.on(event, (payload, ack) => {
    try {
      fn(payload ?? {});
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      const known = err instanceof games.GameError || err instanceof HttpError;
      if (!known) console.error(err);
      if (typeof ack === 'function') ack({ error: known ? err.message : 'Something went wrong. Try again.' });
    }
  });

  on('chat:send', ({ body, announcement }) => {
    const user = getUser(userId);
    const message = String(body ?? '').trim();
    if (!message) throw new HttpError(400, 'Write a message first');
    if (message.length > 1000) throw new HttpError(400, 'Messages can be at most 1000 characters');
    if (announcement && user.role !== 'admin') throw new HttpError(403, 'Only admins can post announcements');
    postMessage(userId, message, !!announcement);
  });

  on('game:watch', ({ gameId }) => {
    const game = games.getGame(Number(gameId));
    if (!game) throw new games.GameError('Game not found');
    socket.join(`game:${game.id}`);
    socket.emit('game:state', games.gameState(game));
  });
  on('game:unwatch', ({ gameId }) => socket.leave(`game:${Number(gameId)}`));
  on('game:move', ({ gameId, from, to, promotion }) => games.makeMove(userId, Number(gameId), { from, to, promotion }));
  on('game:resign', ({ gameId }) => games.resign(userId, Number(gameId)));
  on('game:offerDraw', ({ gameId }) => games.offerDraw(userId, Number(gameId)));
  on('game:answerDraw', ({ gameId, accept }) => games.answerDraw(userId, Number(gameId), !!accept));

  socket.on('disconnect', () => {
    const left = (online.get(userId) ?? 1) - 1;
    if (left > 0) online.set(userId, left);
    else online.delete(userId);
    broadcastOnline();
  });
});

bus.on('game', (gameId) => {
  const game = games.getGame(gameId);
  if (game) io.to(`game:${gameId}`).emit('game:state', games.gameState(game));
});

bus.on('tournament', (id) => io.to('members').emit('tournament:changed', { id }));

bus.on('round', ({ tournament, games: paired }) => {
  for (const g of paired) {
    for (const [me, opp, color] of [[g.white, g.black, 'white'], [g.black, g.white, 'black']]) {
      io.to(`user:${me}`).emit('game:assigned', {
        gameId: g.id,
        tournament: { id: tournament.id, name: tournament.name },
        color,
        opponent: publicUser(getUser(opp)),
      });
    }
  }
});

bus.on('announce', (body) => postMessage(null, body, true));

setInterval(() => {
  try {
    games.sweepClocks();
  } catch (err) {
    console.error('Clock sweep failed', err);
  }
}, 1000);

server.listen(PORT, () => {
  console.log(`${CLUB_NAME} is running at http://localhost:${PORT}`);
});
