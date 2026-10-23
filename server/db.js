import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'chess-club.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    student_id    TEXT NOT NULL UNIQUE COLLATE NOCASE,
    first_name    TEXT NOT NULL,
    last_name     TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    photo         TEXT,
    role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
    rating        INTEGER NOT NULL DEFAULT 1200,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    location    TEXT NOT NULL DEFAULT '',
    starts_at   INTEGER NOT NULL,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS event_attendees (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    body            TEXT NOT NULL,
    is_announcement INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tournaments (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    format        TEXT NOT NULL CHECK (format IN ('swiss', 'round_robin')),
    total_rounds  INTEGER NOT NULL DEFAULT 0,
    current_round INTEGER NOT NULL DEFAULT 0,
    time_minutes  INTEGER NOT NULL DEFAULT 10,
    increment_sec INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'registration'
                  CHECK (status IN ('registration', 'in_progress', 'finished')),
    starts_at     INTEGER,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tournament_players (
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seed          INTEGER,
    joined_at     INTEGER NOT NULL,
    PRIMARY KEY (tournament_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS games (
    id               INTEGER PRIMARY KEY,
    tournament_id    INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
    round            INTEGER NOT NULL DEFAULT 0,
    board            INTEGER NOT NULL DEFAULT 0,
    white_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    black_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    moves            TEXT NOT NULL DEFAULT '[]',
    fen              TEXT NOT NULL DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
    result           TEXT CHECK (result IN ('1-0', '0-1', '1/2-1/2', 'bye')),
    termination      TEXT,
    white_ms         INTEGER NOT NULL,
    black_ms         INTEGER NOT NULL,
    increment_ms     INTEGER NOT NULL DEFAULT 0,
    turn_started_at  INTEGER,
    draw_offer_by    INTEGER,
    created_at       INTEGER NOT NULL,
    finished_at      INTEGER
  );

  CREATE INDEX IF NOT EXISTS games_by_tournament ON games(tournament_id, round);
  CREATE INDEX IF NOT EXISTS games_active ON games(status);
`);

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const now = () => Date.now();

/** Public shape of a user, safe to send to any member. */
export function publicUser(u, { withStudentId = false } = {}) {
  if (!u) return null;
  const out = {
    id: u.id,
    firstName: u.first_name,
    lastName: u.last_name,
    name: `${u.first_name} ${u.last_name}`,
    photo: u.photo ? `/uploads/${u.photo}` : null,
    role: u.role,
    rating: u.rating,
  };
  if (withStudentId) out.studentId = u.student_id;
  return out;
}

const userById = db.prepare('SELECT * FROM users WHERE id = ?');
export const getUser = (id) => (id == null ? null : userById.get(id));
