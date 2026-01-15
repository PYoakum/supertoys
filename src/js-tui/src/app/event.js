export function stop(evt, reason = "stopped") {
  evt._stopped = true;
  evt._stopReason = reason;
  return evt;
}

export function isStopped(evt) {
  return !!evt._stopped;
}

// Normalized event shapes used by the app:
export function keyEvent(key) {
  return { type: "key", key, _stopped: false };
}
export function textEvent(text) {
  return { type: "text", text, _stopped: false };
}
export function systemEvent(name, data) {
  return { type: "system", name, data, _stopped: false };
}
