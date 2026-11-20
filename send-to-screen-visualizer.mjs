/* Send to Screen Visualizer.
 *
 * Copy this file into a tool that makes images or video, and it can hand them to the NRF27 Screen Visualizer as
 * media, with nothing downloaded in between:
 *
 *   import { openScreenVisualizer } from './send-to-screen-visualizer.js';
 *
 *   button.addEventListener('click', async () => {
 *     const visualizer = openScreenVisualizer();           // in the click itself, or the browser blocks the window
 *     const blob = await renderYourPngOrMp4();             // however long it takes
 *     const { code, name } = await visualizer.send(blob, 'my-loop.mp4', { tool: 'Dot grid' });
 *   });
 *
 * The file goes from this page to that window inside the browser (postMessage). The Screen Visualizer adds it as a
 * new item, exactly as if it had been dropped there: nothing already there is changed. It only listens to tools on
 * *.quick.shopify.io, justin-close.github.io and localhost.
 */
const DEFAULT_TARGET = 'https://nrf27-screen-visualizer.quick.shopify.io';
const T = 'nrf27-screen-visualizer:';

export function openScreenVisualizer({ target = DEFAULT_TARGET } = {}) {
  const base = target.replace(/\/$/, '');
  const origin = new URL(base).origin;
  const win = window.open(`${base}/?ws=media&receive=1`, 'nrf27-screen-visualizer');
  if (!win) throw new Error('The browser blocked the window. Allow pop-ups for this site and send again.');
  let ready = false;
  const pending = new Map();
  const onMessage = (e) => {
    if (e.origin !== origin || typeof e.data?.type !== 'string') return;
    if (e.data.type === `${T}ready`) ready = true;
    const waiting = pending.get(e.data.token);
    if (!waiting) return;
    if (e.data.type === `${T}added`) { pending.delete(e.data.token); waiting.resolve({ code: e.data.code, name: e.data.name }); }
    if (e.data.type === `${T}refused`) { pending.delete(e.data.token); waiting.reject(new Error(e.data.reason || 'It was refused')); }
  };
  window.addEventListener('message', onMessage);
  // Ask until it answers: the window may still be loading, or waiting for a sign-in.
  const hello = setInterval(() => {
    if (ready || win.closed) { clearInterval(hello); return; }
    try { win.postMessage({ type: `${T}hello` }, origin); } catch { /* not there yet */ }
  }, 400);
  const close = () => { clearInterval(hello); window.removeEventListener('message', onMessage); };

  async function whenReady(timeout) {
    const started = Date.now();
    while (!ready) {
      if (win.closed) throw new Error('The Screen Visualizer window was closed');
      if (Date.now() - started > timeout) throw new Error('The Screen Visualizer did not answer. If its window is asking you to sign in, sign in and send again.');
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return {
    window: win,
    /** Hand it a file. Resolves with the new item's code and name once it has been added (a video uploads first). */
    async send(blob, name, { tool, timeout = 120000 } = {}) {
      await whenReady(timeout);
      const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const added = new Promise((resolve, reject) => pending.set(token, { resolve, reject }));
      win.postMessage({ type: `${T}media`, token, name, file: blob, tool }, origin);
      try { win.focus(); } catch { /* not allowed to */ }
      try { return await added; } finally { close(); }
    },
    close,
  };
}
