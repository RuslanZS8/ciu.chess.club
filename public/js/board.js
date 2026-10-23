import { Chess } from '/vendor/chess.js';

const FILES = 'abcdefgh';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const pieceSrc = (color, type) => `/pieces/${color}${type.toUpperCase()}.svg`;
const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

/**
 * Chessboard with click-to-move and drag-to-move.
 * The board only lets `myColor` move, and only when it's that side's turn.
 * onMove({ from, to, promotion }) is called after the move is shown locally.
 */
export class Board {
  constructor(root, { onMove }) {
    this.root = root;
    this.onMove = onMove;
    this.fen = START;
    this.orientation = 'w';
    this.myColor = null;
    this.lastMove = null;
    this.selected = null;
    this.drag = null;
    root.classList.add('board');
    root.setAttribute('role', 'grid');
    root.setAttribute('aria-label', 'Chessboard');
    root.addEventListener('pointerdown', (e) => this.onDown(e));
    root.addEventListener('keydown', (e) => this.onKey(e));
    this.onPointerMove = (e) => this.onDragMove(e);
    this.onPointerUp = (e) => this.onUp(e);
  }

  set({ fen, orientation, myColor, lastMove }) {
    if (fen !== this.fen) this.selected = null;
    if (fen !== undefined) this.fen = fen;
    if (orientation !== undefined) this.orientation = orientation;
    if (myColor !== undefined) this.myColor = myColor;
    if (lastMove !== undefined) this.lastMove = lastMove;
    this.render();
  }

  get turn() { return this.fen.split(' ')[1]; }
  canMove() { return !!this.myColor && this.turn === this.myColor; }

  legalFrom(square) {
    return new Chess(this.fen).moves({ square, verbose: true });
  }

  squaresInOrder() {
    const out = [];
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const file = this.orientation === 'w' ? f : 7 - f;
        const rank = this.orientation === 'w' ? 8 - r : r + 1;
        out.push({ sq: FILES[file] + rank, file, rank, row: r, col: f });
      }
    }
    return out;
  }

  render() {
    const chess = new Chess(this.fen);
    const targets = this.selected ? this.legalFrom(this.selected) : [];
    let checkSq = null;
    if (chess.inCheck()) {
      for (const row of chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === chess.turn()) checkSq = p.square;
    }
    const movable = this.canMove();

    let out = '';
    for (const { sq, file, rank, row, col } of this.squaresInOrder()) {
      const piece = chess.get(sq);
      const dark = (file + rank) % 2 === 1 ? ' dark' : ''; // a1 is a dark square
      const cls = ['sq' + dark];
      if (this.lastMove && (this.lastMove.from === sq || this.lastMove.to === sq)) cls.push('last');
      if (this.selected === sq) cls.push('sel');
      if (checkSq === sq) cls.push('check');
      const target = targets.find((m) => m.to === sq);
      if (target) cls.push('target', target.captured ? 'capture' : '');
      if (movable && piece?.color === this.myColor) cls.push('movable');
      if (this.drag?.from === sq) cls.push('dragging');
      const label = piece ? `${sq}, ${piece.color === 'w' ? 'white' : 'black'} ${PIECE_NAMES[piece.type]}` : sq;
      out += `<div class="${cls.join(' ')}" data-sq="${sq}" role="gridcell" aria-label="${label}" tabindex="${sq === (this.selected ?? this.focusSq ?? '') ? 0 : -1}">`;
      if (row === 7) out += `<span class="coord file">${FILES[file]}</span>`;
      if (col === 0) out += `<span class="coord rank">${rank}</span>`;
      if (piece) out += `<img src="${pieceSrc(piece.color, piece.type)}" alt="" draggable="false">`;
      out += '</div>';
    }
    const promo = this.root.querySelector('.promo');
    this.root.innerHTML = out;
    if (promo) this.root.append(promo);
    if (!this.root.querySelector('[tabindex="0"]')) this.root.querySelector('.sq')?.setAttribute('tabindex', '0');
  }

  squareAt(x, y) {
    return document.elementFromPoint(x, y)?.closest('.sq')?.dataset.sq ?? null;
  }

  onDown(e) {
    if (e.button !== 0 || this.root.querySelector('.promo')) return;
    const sq = e.target.closest('.sq')?.dataset.sq;
    if (!sq || !this.canMove()) return;

    if (this.selected && this.selected !== sq && this.legalFrom(this.selected).some((m) => m.to === sq)) {
      this.tryMove(this.selected, sq);
      return;
    }
    const piece = new Chess(this.fen).get(sq);
    if (piece?.color !== this.myColor) {
      this.selected = null;
      this.render();
      return;
    }

    e.preventDefault();
    const wasSelected = this.selected === sq;
    this.selected = sq;
    const size = this.root.getBoundingClientRect().width / 8;
    const ghost = document.createElement('img');
    ghost.className = 'drag-ghost';
    ghost.src = pieceSrc(piece.color, piece.type);
    ghost.style.width = ghost.style.height = `${size}px`;
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    ghost.hidden = true;
    document.body.append(ghost);
    this.drag = { from: sq, ghost, x: e.clientX, y: e.clientY, moved: false, wasSelected };
    this.render();
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  onDragMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) {
      d.moved = true;
      d.ghost.hidden = false;
      this.root.querySelector(`[data-sq="${d.from}"]`)?.classList.add('dragging');
    }
    d.ghost.style.left = `${e.clientX}px`;
    d.ghost.style.top = `${e.clientY}px`;
  }

  onUp(e) {
    const d = this.drag;
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    if (!d) return;
    d.ghost.remove();
    this.drag = null;
    const to = this.squareAt(e.clientX, e.clientY);
    if (d.moved && to && to !== d.from && this.legalFrom(d.from).some((m) => m.to === to)) {
      this.tryMove(d.from, to);
      return;
    }
    // A plain click on an already-selected piece puts it back down.
    if (!d.moved && d.wasSelected) this.selected = null;
    this.render();
  }

  onKey(e) {
    const sqEl = e.target.closest('.sq');
    if (!sqEl) return;
    const order = this.squaresInOrder();
    const i = order.findIndex((s) => s.sq === sqEl.dataset.sq);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      const next = order[i + step];
      if (!next) return;
      this.focusSq = next.sq;
      sqEl.setAttribute('tabindex', '-1');
      const el = this.root.querySelector(`[data-sq="${next.sq}"]`);
      el.setAttribute('tabindex', '0');
      el.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const sq = sqEl.dataset.sq;
      this.focusSq = sq;
      if (!this.canMove()) return;
      if (this.selected && this.legalFrom(this.selected).some((m) => m.to === sq)) {
        this.tryMove(this.selected, sq);
      } else {
        this.selected = new Chess(this.fen).get(sq)?.color === this.myColor && this.selected !== sq ? sq : null;
        this.render();
      }
      this.root.querySelector(`[data-sq="${sq}"]`)?.focus();
    }
  }

  async tryMove(from, to) {
    const candidates = this.legalFrom(from).filter((m) => m.to === to);
    if (!candidates.length) return;
    let promotion;
    if (candidates.some((m) => m.promotion)) {
      promotion = await this.choosePromotion();
      if (!promotion) {
        this.selected = null;
        this.render();
        return;
      }
    }
    const chess = new Chess(this.fen);
    chess.move({ from, to, promotion });
    this.fen = chess.fen();
    this.lastMove = { from, to };
    this.selected = null;
    this.render();
    this.onMove({ from, to, promotion });
  }

  choosePromotion() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'promo';
      overlay.innerHTML = `<div role="dialog" aria-label="Promote pawn to">${['q', 'r', 'b', 'n'].map((t) =>
        `<button type="button" data-p="${t}" aria-label="${PIECE_NAMES[t]}"><img src="${pieceSrc(this.myColor, t)}" alt=""></button>`).join('')}</div>`;
      overlay.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const btn = e.target.closest('[data-p]');
        if (btn || e.target === overlay) {
          overlay.remove();
          resolve(btn?.dataset.p ?? null);
        }
      });
      overlay.addEventListener('keydown', (e) => {
        const btn = e.target.closest('[data-p]');
        if (e.key === 'Escape') { overlay.remove(); resolve(null); }
        if ((e.key === 'Enter' || e.key === ' ') && btn) { e.preventDefault(); overlay.remove(); resolve(btn.dataset.p); }
      });
      this.root.append(overlay);
      overlay.querySelector('button').focus();
    });
  }
}
