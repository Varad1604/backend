/**
 * Tiny pub/sub so an adapter can report "the server says this session is gone" (401
 * UNAUTHENTICATED on any call other than login / me) without importing React state.
 * AuthProvider subscribes, clears the user and RequireAuth sends them to /login with the
 * route they were on, where the login page explains that the session ended.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onSessionExpired(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function emitSessionExpired(): void {
  listeners.forEach((l) => l());
}
