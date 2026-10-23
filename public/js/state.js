/** Shared, mutable app state. Views read from here; app.js keeps it up to date. */
export const ctx = {
  me: null,
  config: { clubName: 'Chess Club' },
  socket: null,
  online: new Set(),
  unread: 0,
};

export const isAdmin = () => ctx.me?.role === 'admin';

/** Socket.IO emit that resolves on the server's ack, or rejects with its error message. */
export function emit(event, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!ctx.socket?.connected) {
      reject(new Error('Not connected to the club server. Reconnecting…'));
      return;
    }
    ctx.socket.timeout(8000).emit(event, payload, (err, res) => {
      if (err) reject(new Error('The server didn’t respond. Check your connection and try again.'));
      else if (res?.error) reject(new Error(res.error));
      else resolve(res);
    });
  });
}

/**
 * A view's lifetime. Socket listeners and timers registered through it are
 * removed automatically when the user navigates away.
 */
export function createScope() {
  const cleanups = [];
  return {
    alive: true,
    on(event, handler) {
      ctx.socket?.on(event, handler);
      cleanups.push(() => ctx.socket?.off(event, handler));
    },
    every(ms, fn) {
      const id = setInterval(fn, ms);
      cleanups.push(() => clearInterval(id));
    },
    onCleanup(fn) { cleanups.push(fn); },
    dispose() {
      this.alive = false;
      cleanups.splice(0).forEach((fn) => fn());
    },
  };
}
