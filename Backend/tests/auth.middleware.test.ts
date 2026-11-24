import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAuth, requireDemoForGuest } from "../src/shared/middleware/auth.middleware";
import { signAccessToken } from "../src/shared/utils/jwt.util";

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function makeRes(): Response {
  return {} as Response;
}

describe("requireAuth middleware", () => {
  let next: NextFunction & ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  });

  it("rejects requests without an Authorization header", () => {
    requireAuth(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe("Missing bearer token");
  });

  it("rejects malformed Authorization headers", () => {
    for (const header of ["Basic abc123", "Bearer", "Token abc", "bearer-no-space"]) {
      next.mockClear();
      requireAuth(makeReq({ authorization: header }), makeRes(), next);
      const err = next.mock.calls[0][0];
      expect(err.statusCode).toBe(401);
    }
  });

  it("rejects invalid or expired tokens", () => {
    requireAuth(makeReq({ authorization: "Bearer garbage.token.here" }), makeRes(), next);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toMatch(/invalid|expired/i);
  });

  it("attaches req.user and calls next for a valid bearer token", () => {
    const token = signAccessToken({ sub: "u-42", email: "dev@example.com" });
    const req = makeReq({ authorization: `Bearer ${token}` }) as Request & { user?: unknown };

    requireAuth(req, makeRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]).toHaveLength(0); // no error passed
    expect(req.user).toEqual({ id: "u-42", email: "dev@example.com", guest: false });
  });

  it("trims whitespace after Bearer prefix", () => {
    const token = signAccessToken({ sub: "u-7", email: "x@example.com" });
    const req = makeReq({ authorization: `Bearer   ${token}   ` }) as Request & { user?: unknown };

    requireAuth(req, makeRes(), next);

    expect(next.mock.calls[0]).toHaveLength(0);
    expect(req.user).toEqual({ id: "u-7", email: "x@example.com", guest: false });
  });

  it("carries the guest claim through so the demo guard can see it", () => {
    const token = signAccessToken({ sub: "g-9", email: "guest-9@codecity.local", guest: true });
    const req = makeReq({ authorization: `Bearer ${token}` }) as Request & { user?: unknown };

    requireAuth(req, makeRes(), next);

    expect(next.mock.calls[0]).toHaveLength(0);
    expect(req.user).toEqual({ id: "g-9", email: "guest-9@codecity.local", guest: true });
  });

  it("rejects structurally valid tokens whose payload has no sub claim", async () => {
    const { default: jwt } = await import("jsonwebtoken");
    const { env } = await import("../src/config/env");
    const noSub = jwt.sign({ email: "a@b.c" }, env.jwtSecret);

    requireAuth(makeReq({ authorization: `Bearer ${noSub}` }), makeRes(), next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe("Invalid token payload");
  });
});

describe("requireDemoForGuest middleware", () => {
  let next: NextFunction & ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  });

  const reqAs = (user: { id: string; email: string; guest?: boolean } | undefined, body: unknown): Request =>
    ({ user, body, query: {} }) as unknown as Request;

  const guest = { id: "g-1", email: "guest-1@codecity.local", guest: true };

  it("is a no-op for signed-in accounts", () => {
    requireDemoForGuest(reqAs({ id: "u-1", email: "dev@example.com" }, { repoUrl: "https://github.com/a/b" }), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]).toHaveLength(0);
  });

  it("lets a guest open the bundled demo:// repository", () => {
    requireDemoForGuest(reqAs(guest, { repoUrl: "demo://beach-resort" }), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]).toHaveLength(0);
  });

  it("answers 403 when a guest tries a real repository", () => {
    const attempts = [
      { repoUrl: "https://github.com/expressjs/express" },
      { url: "https://github.com/expressjs/express" }, // POST /repos/explain
      { repoUrl: "git@github.com:expressjs/express.git" },
      {}, // no target at all — never assume demo
    ];
    for (const body of attempts) {
      next.mockClear();
      requireDemoForGuest(reqAs(guest, body), makeRes(), next);
      const err = next.mock.calls[0][0];
      expect(err.statusCode).toBe(403);
      expect(err.message).toMatch(/demo only/i);
    }
  });

  it("keeps the query-string form (/repos/explain?url=) under the same rule", () => {
    const withQuery = ({ user: guest, body: {}, query: { url: "https://github.com/expressjs/express" } }) as unknown as Request;
    requireDemoForGuest(withQuery, makeRes(), next);
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });
});
