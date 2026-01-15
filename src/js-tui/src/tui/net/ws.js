/**
 * Bun provides WebSocket client as global WebSocket.
 */
export function connectWebSocket(url, { onOpen, onMessage, onClose, onError } = {}) {
  const ws = new WebSocket(url);

  ws.addEventListener("open", () => onOpen?.(ws));
  ws.addEventListener("message", (ev) => onMessage?.(ws, ev.data));
  ws.addEventListener("close", () => onClose?.(ws));
  ws.addEventListener("error", (ev) => onError?.(ws, ev));

  return ws;
}
