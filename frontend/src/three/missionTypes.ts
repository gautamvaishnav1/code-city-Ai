export type Verb = "dispatch" | "gate" | "arrive" | "work" | "verify" | "query" | "done" | "deny";

/** How a traced request was (or wasn't) authenticated — the two options the
 *  REQUEST FLOW panel offers for every route:
 *    "no-jwt"  → fire it with NO Authorization header, whatever the route says
 *    "with-jwt"→ fire it WITH `Authorization: Bearer <access token>`
 *    "auto"    → the route's own policy (public → no header, guarded → header) */
export type FlowSendMode = "auto" | "no-jwt" | "with-jwt";

/** verdict of the real HTTP call a traced flow fires (see lib/flowRunner.ts).
 *  Lives here (types-only module) so the city store can hold it without
 *  importing the runner → no store↔lib import cycle. */
export interface FlowProbeResult {
  flow: string;
  /** an HTTP request actually left the browser */
  sent: boolean;
  /** the Authorization header was attached (protected route, signed in) */
  withJwt: boolean;
  status: number | null;
  ms: number;
  /** one-line verdict shown on the courier's final card + the log */
  note: string;
  kind: "ok" | "denied" | "rejected" | "unreachable" | "none";
}

/** One recorded send, kept per flow so the panel can show BOTH answers
 *  (401 without the JWT vs 200 with it) after the courier has finished. */
export interface FlowResult extends FlowProbeResult {
  mode: FlowSendMode;
  /** wall-clock ms — newest wins when the same mode is re-run */
  at: number;
}

/** both runs of one flow, e.g. { "no-jwt": …, "with-jwt": … } */
export type FlowResults = Partial<Record<FlowSendMode, FlowResult>>;
