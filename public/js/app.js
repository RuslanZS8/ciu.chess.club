import { html, raw, $, $$, api, avatar, toast } from './util.js';
import { ctx, createScope } from './state.js';
import * as auth from './views/auth.js';
import * as home from './views/home.js';
import * as events from './views/events.js';
import * as chat from './views/chat.js';
import * as tournamentList from './views/tournaments.js';
import * as tournament from './views/tournament.js';
import * as game from './views/game.js';
import * as members from './views/members.js';
import * as profile from './views/profile.js';

const routes = [
  { path: /^\/?$/, view: home, nav: 'home' },
  { path: /^\/events$/, view: events, nav: 'events' },
  { path: /^\/chat$/, view: chat, nav: 'chat' },
  { path: /^\/tournaments$/, view: tournamentList, nav: 'tournaments' },
  { path: /^\/tournaments\/(\d+)$/, view: tournament, nav: 'tournaments' },
  { path: /^\/games\/(\d+)$/, view: game, nav: 'tournaments' },
  { path: /^\/members$/, view: members, nav: 'members' },
  { path: /^\/profile$/, view: profile, nav: 'profile' },
];

const icon = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>',
  events: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12Z"/></svg>',
  tournaments: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
  members: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14a6.5 6.5 0 0 1 3 6"/></svg>',
};

const navItems = [
  ['home', '#/', 'Home'],
  ['events', '#/events', 'Events'],
  ['chat', '#/chat', 'Chat'],
  ['tournaments', '#/tournaments', 'Tournaments'],
  ['members', '#/members', 'Members'],
];

let scope = null;

function brand() {
  return html`<a class="brand" href="#/"><img src="/pieces/wN.svg" alt=""><span class="display">${ctx.config.clubName}</span></a>`;
}

function renderShell() {
  const links = () => navItems.map(([key, href, label]) => html`
    <a href="${href}" data-nav="${key}">${raw(icon[key])}<span>${label}</span>${key === 'chat' ? html`<span class="badge" data-unread hidden></span>` : ''}</a>`);
  $('#app').innerHTML = html`
    <div class="shell">
      <aside class="side">
        ${brand()}
        <nav class="nav" aria-label="Main">${links()}</nav>
        <a class="me" href="#/profile" data-nav="profile">
          ${avatar(ctx.me, 'sm')}
          <span><strong>${ctx.me.name}</strong><span class="small muted">${ctx.me.role === 'admin' ? 'Club admin' : `Rating ${ctx.me.rating}`}</span></span>
        </a>
      </aside>
      <header class="topbar">
        ${brand()}
        <a href="#/profile" data-nav="profile" aria-label="Your profile">${avatar(ctx.me, 'sm')}</a>
      </header>
      <main class="main" id="view" tabindex="-1"></main>
      <nav class="tabbar" aria-label="Main">${links()}</nav>
    </div>`.s;
}

export function updateUnread() {
  for (const el of $$('[data-unread]')) {
    el.hidden = ctx.unread === 0;
    el.textContent = ctx.unread > 99 ? '99+' : ctx.unread;
  }
}

export function refreshMe(me) {
  ctx.me = me;
  renderShell();
  route();
}

async function route() {
  if (!ctx.me) return;
  const path = location.hash.replace(/^#/, '') || '/';
  const match = routes.map((r) => ({ r, m: path.match(r.path) })).find((x) => x.m);
  if (!match) {
    location.hash = '#/';
    return;
  }
  scope?.dispose();
  scope = createScope();

  for (const a of $$('[data-nav]')) {
    if (a.dataset.nav === match.r.nav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (match.r.nav === 'chat') ctx.unread = 0;
  updateUnread();

  const el = $('#view');
  el.innerHTML = '<p class="loading">Loading…</p>';
  window.scrollTo(0, 0);
  try {
    await match.r.view.render(el, match.m.slice(1), scope);
  } catch (err) {
    if (!scope.alive) return;
    el.innerHTML = html`<div class="empty"><strong>This page didn’t load</strong>${err.message}</div>`.s;
  }
}

function connectSocket() {
  ctx.socket?.disconnect();
  const socket = io({ withCredentials: true });
  ctx.socket = socket;

  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') logout();
  });
  socket.on('presence', (ids) => {
    ctx.online = new Set(ids);
    document.dispatchEvent(new CustomEvent('presence'));
  });
  socket.on('chat:message', (msg) => {
    const onChat = location.hash === '#/chat';
    if (onChat || msg.author?.id === ctx.me.id) return;
    ctx.unread++;
    updateUnread();
    if (msg.announcement) {
      toast(`Announcement: ${msg.body}`, { link: '#/chat', linkText: 'Open chat', timeout: 9000 });
    }
  });
  socket.on('game:assigned', ({ gameId, tournament: t, color, opponent }) => {
    toast(`${t.name}: you play ${opponent?.name ?? 'your opponent'} with the ${color} pieces.`, {
      link: `#/games/${gameId}`, linkText: 'Go to your board', timeout: 15000,
    });
  });
}

export async function logout() {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  ctx.socket?.disconnect();
  ctx.socket = null;
  ctx.me = null;
  scope?.dispose();
  location.hash = '#/';
  showAuth();
}

function showAuth() {
  auth.render($('#app'), {
    onAuthed(me) {
      ctx.me = me;
      start();
    },
  });
}

function start() {
  connectSocket();
  renderShell();
  route();
}

async function boot() {
  ctx.config = await api('/api/config').catch(() => ctx.config);
  document.title = ctx.config.clubName;
  ctx.me = await api('/api/me').catch(() => null);
  if (ctx.me) start();
  else showAuth();
}

window.addEventListener('hashchange', route);
boot();
