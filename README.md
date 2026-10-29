# Chess Club

A web app for a student chess club: members register with their student ID, name and photo, follow club events, talk in a shared chat where admins post announcements, and play online tournaments in the browser.

## Run it

Requires Node.js 22.13 or newer (it uses the built-in `node:sqlite` database).

```sh
npm install
npm start
```

For development, `npm run dev` restarts the server whenever a server file changes.

Open http://localhost:3000. **The first account you register becomes the club admin**, unless `ADMIN_STUDENT_IDS` is set. Admins can make other members admins from the Members page.

Settings (environment variables):

| Variable        | Default      | Purpose                                               |
| --------------- | ------------ | ----------------------------------------------------- |
| `PORT`          | `3000`       | HTTP port                                             |
| `CLUB_NAME`     | `Chess Club` | Name shown in the header and on the login page        |
| `DATA_DIR`      | `./data`     | Where the SQLite database and uploaded photos are kept |
| `COOKIE_SECURE` | `false`      | Set to `true` when serving over HTTPS                 |
| `ADMIN_STUDENT_IDS` | (empty)  | Comma-separated student IDs that become admins when they register. Set it on hosts that wipe data on restart, so a stranger can't become admin |

All data lives in `DATA_DIR` (`chess-club.db` plus `uploads/`). Back up that folder to back up the club.

## What's in it

- **Registration**: student ID, first name, surname, password, a photo (JPG, PNG, WebP or GIF, up to 4 MB) and optionally an existing Elo rating (100–3000) to start from instead of 1200. Members can change their name, photo and password on their profile.
- **Events**: admins create, edit and delete events. A new event is announced in the chat automatically. Members RSVP with "I'm going".
- **Club chat**: real-time chat for all members. Admins can post highlighted announcements, which also pop up as notifications for everyone online, and can delete messages. The chat has an "Announcements" filter.
- **Online tournaments**
  - Swiss (players with similar scores meet; no rematches) or round robin (everyone plays everyone).
  - Admin sets the time control (minutes + seconds per move), opens registration and starts the event.
  - Pairings are made automatically. When every board in a round has finished, the next round is paired and announced, and each player gets a notification with their opponent and colour.
  - **Pairing chart**: every board, with both players' photos, names, ratings and colours, so contestants can see who they're playing. Also standings (Buchholz or Sonneborn-Berger tie-breaks) and a crosstable for round robins.
  - Games are played live in the browser with legal-move checking on the server, clocks with increment, flag on time, checkmate/stalemate/repetition/50-move detection, resign and draw offers. Anyone can watch any board.
  - Admins can set a result for a no-show.
- **Members**: everyone, ranked by an Elo-style club rating (starts at 1200, updated after each game). Student IDs are shown to admins only.
- **Look and feel**: a black, green and white theme that follows the device's light or dark mode, with a 3D backdrop of chess pieces floating above a board. It shows a still frame for people who prefer reduced motion. On phones the sidebar becomes a top bar plus a bottom tab bar.

## Tech stack

No build step: the browser loads the files in `public/` as they are, and the server sends the two browser libraries straight from `node_modules`.

| Part | What's used |
| --- | --- |
| Runtime | [Node.js](https://nodejs.org) 22.13+, ES modules |
| Web server | [Express](https://expressjs.com) 4 for the JSON API and static files |
| Real-time | [Socket.IO](https://socket.io) 4 for live games, clocks, chat, notifications and who's online |
| Database | SQLite through Node's built-in `node:sqlite`, so there's no separate database server |
| Chess rules | [chess.js](https://github.com/jhlywa/chess.js) on the server (move checking, check/mate, draws) and in the browser (move hints) |
| Logins | Passwords hashed with [bcryptjs](https://github.com/dcodeIO/bcrypt.js), sessions in an HTTP-only cookie |
| Photo uploads | [Multer](https://github.com/expressjs/multer), saved to `DATA_DIR/uploads` |
| Frontend | Plain JavaScript modules and hand-written CSS, no framework. A small hash-based router shows one view per page |
| 3D backdrop | [three.js](https://threejs.org) |
| Font | [Archivo](https://fonts.google.com/specimen/Archivo) from Google Fonts |
| Hosting | [Render](https://render.com), set up in `render.yaml` |

## Project layout

```
server/
  index.js          HTTP API, uploads, sessions, Socket.IO
  db.js             SQLite schema
  games.js          moves, clocks, results, ratings
  tournaments.js    Swiss and round-robin pairing, standings
  bus.js            events from game/tournament logic to the socket layer
public/
  index.html, css/style.css
  js/app.js         router and layout
  js/state.js       shared app state
  js/util.js        helpers (HTML templating, API calls, toasts)
  js/components.js  shared UI pieces
  js/board.js       chessboard (click or drag to move)
  js/backdrop.js    3D chess-piece backdrop
  js/views/         one file per page
  pieces/           piece images
render.yaml         Render deploy config
```

## Deploying to Render

`render.yaml` describes the web service. Connect the GitHub repo in Render (New > Blueprint) and set `ADMIN_STUDENT_IDS` in the dashboard. Each push to `main` redeploys the site. On the free plan the disk is wiped on every restart and deploy, so the database and photos don't last. Add a persistent disk and point `DATA_DIR` at it to keep them.

## Before putting it online

- Serve it over HTTPS (for example behind Nginx or Caddy) and set `COOKIE_SECURE=true`.
- Add rate limiting on `/api/login` and `/api/register` if the site is public.
- Run one server process: live games and the chat are coordinated in memory.

Chess pieces: "cburnett" set by Colin M.L. Burnett (GPLv2+), as used by Lichess.
