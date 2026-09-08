import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  collapseDuplicateParams,
  sanitizeRequest,
  stripMongoOperators
} from "../src/shared/middleware/sanitize.middleware";

function makeReq(over: Partial<Request> = {}): Request {
  return { params: {}, query: {}, body: {}, ...over } as unknown as Request;
}

describe("stripMongoOperators", () => {
  it("removes $-prefixed keys at the top level", () => {
    const obj: Record<string, unknown> = { email: { $gt: "" }, name: "acme" };
    stripMongoOperators(obj);
    expect(obj).toEqual({ email: {}, name: "acme" });
  });

  it("removes $where and nested operators", () => {
    const obj: Record<string, unknown> = {
      $where: "1==1",
      filter: { age: { $ne: null }, ok: true }
    };
    stripMongoOperators(obj);
    expect(obj).toEqual({ filter: { age: {}, ok: true } });
  });

  it("strips dotted keys and prototype-pollution attempts", () => {
    const obj: Record<string, unknown> = {
      "escaped.key": 1,
      __proto__: { admin: true },
      constructor: {},
      keep: "me"
    };
    stripMongoOperators(obj);
    expect(Object.keys(obj)).toEqual(["keep"]);
  });

  it("recurses into arrays", () => {
    const obj: Record<string, unknown> = { tags: [{ $bad: 1 }, { good: 2 }] };
    stripMongoOperators(obj);
    expect(obj).toEqual({ tags: [{}, { good: 2 }] });
  });

  it("leaves primitives untouched", () => {
    const s = "hello";
    stripMongoOperators(s as unknown as Record<string, unknown>);
    expect(s).toBe("hello");
  });
});

describe("collapseDuplicateParams", () => {
  it("keeps the last value of repeated query params", () => {
    const query: Record<string, unknown> = { id: ["1", "2"], page: "3" };
    collapseDuplicateParams(query);
    expect(query).toEqual({ id: "2", page: "3" });
  });

  it("keeps empty arrays (nothing to collapse)", () => {
    const query: Record<string, unknown> = { id: [] };
    collapseDuplicateParams(query);
    expect(query).toEqual({ id: [] });
  });
});

describe("sanitizeRequest middleware", () => {
  let next: NextFunction & ReturnType<typeof vi.fn>;
  let res: Response;

  beforeEach(() => {
    next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
    res = {} as Response;
  });

  it("sanitizes body, query and params in place then calls next()", () => {
    const req = makeReq({
      body: { email: { $gt: "" }, password: "real" },
      query: { id: ["a", "b"] },
      params: { slug: { $regex: ".*" } }
    });

    sanitizeRequest(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.body).toEqual({ email: {}, password: "real" });
    // Express 5 exposes query via a getter — in-place mutation must work
    expect((req as unknown as { query: object }).query).toEqual({ id: "b" });
    expect(req.params).toEqual({ slug: {} });
  });

  it("forwards thrown errors to next(err)", () => {
    const req = makeReq();
    Object.defineProperty(req, "body", {
      get() {
        throw new Error("boom");
      }
    });

    sanitizeRequest(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0] as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("boom");
  });
});
