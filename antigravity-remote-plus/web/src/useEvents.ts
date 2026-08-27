// Subscribe to the server's SSE stream (/api/events) and surface chat/terminal/window events.
// EventSource can't set Authorization headers, so auth rides on the cookie set
// at login. We reconnect automatically on drop.

import { useEffect, useRef } from "react";
import type { ChatState, Trajectory, TerminalInfo, IdeWindowInfo, ModelInfo } from "./api";

export type ServerEvent =
  | { type: "windows"; windows: IdeWindowInfo[] }
  | { type: "state"; windowId?: string; state: ChatState }
  | {
      type: "state_update";
      windowId?: string;
      cascadeId: string;
      generating: boolean;
      statusText: string;
      lastMessage: any;
    }
  | {
      type: "status";
      windowId?: string;
      cascadeId: string;
      generating: boolean;
      statusText: string;
    }
  | { type: "models"; windowId?: string; models: ModelInfo[] }
  | { type: "quota"; windowId?: string; quota: any }
  | { type: "stats_update"; windowId?: string; stats: any }
  | { type: "trajectories"; windowId?: string; list: Trajectory[] }
  | { type: "term-data"; windowId?: string; id: string; data: string }
  | { type: "term-exit"; windowId?: string; id: string; code: number | null }
  | { type: "term-list"; windowId?: string; terminals: TerminalInfo[] };

export function useEvents(onEvent: (e: ServerEvent) => void, enabled: boolean) {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/events", { withCredentials: true });
      es.onmessage = (ev) => {
        try {
          cbRef.current(JSON.parse(ev.data));
        } catch {
          /* ignore malformed frame */
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (!closed) retry = setTimeout(connect, 2000);
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [enabled]);
}
