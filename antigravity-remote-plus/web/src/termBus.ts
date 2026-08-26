// Tiny event bus for terminal SSE frames. The single EventSource lives in
// App (useEvents); terminal frames are forwarded here so the TerminalPanel can
// subscribe/unsubscribe independently of the chat state wiring.

import type { TerminalInfo } from "./api";

export type TermEvent =
  | { type: "term-data"; id: string; data: string }
  | { type: "term-exit"; id: string; code: number | null }
  | { type: "term-list"; terminals: TerminalInfo[] };

type Handler = (e: TermEvent) => void;

const handlers = new Set<Handler>();

export const termBus = {
  emit(e: TermEvent) {
    for (const h of handlers) {
      try {
        h(e);
      } catch {
        /* ignore handler errors */
      }
    }
  },
  subscribe(h: Handler): () => void {
    handlers.add(h);
    return () => handlers.delete(h);
  },
};
