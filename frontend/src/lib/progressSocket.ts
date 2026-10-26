import { io, type Socket } from "socket.io-client";
import { API_BASE } from "./auth";

/** Payload of the backend's `analysis:progress` event
 *  (Backend/src/modules/analysis/analysis.pipeline.ts → step()). */
export interface AnalysisProgress {
  analysisId: string;
  projectId: string;
  step: string;
  /** pipeline percent — emitted by most steps; absent for a few */
  percent?: number;
  message?: string;
}

/** Server origin: socket.io attaches to the SAME http server as the REST API
 *  at its root path. Dev goes through the vite proxy (same-origin, no CORS). */
const SOCKET_ORIGIN = API_BASE.replace(/\/api\/v1\/?$/, "") || window.location.origin;

/**
 * Real pipeline progress straight from the backend's Socket.IO stream
 * (`project:join` room → `analysis:progress` events).
 *
 * Returns an unsubscribe function. Any failure (missing token, backend down,
 * websocket blocked) degrades to a no-op — the UI then shows an honest
 * indeterminate "BUILDING…" instead of a fabricated counter.
 */
export function subscribeAnalysisProgress(opts: {
  projectId: string;
  analysisId: string;
  token: string;
  onProgress: (p: AnalysisProgress) => void;
}): () => void {
  let socket: Socket | null = null;
  try {
    socket = io(SOCKET_ORIGIN, {
      auth: { token: opts.token },
      reconnection: false,
      timeout: 6000,
    });
    socket.on("connect", () => {
      // room is ownership-checked server-side (socket.server.ts)
      socket?.emit("project:join", { projectId: opts.projectId }, () => undefined);
    });
    socket.on("analysis:progress", (p: AnalysisProgress) => {
      if (p?.analysisId === opts.analysisId) opts.onProgress(p);
    });
    socket.on("connect_error", () => {
      /* stay silent — poll fallback keeps the build moving */
    });
  } catch {
    /* degrade to indeterminate */
  }
  return () => {
    try {
      socket?.emit("project:leave", { projectId: opts.projectId });
      socket?.removeAllListeners();
      socket?.disconnect();
    } catch {
      /* ignore */
    }
    socket = null;
  };
}
