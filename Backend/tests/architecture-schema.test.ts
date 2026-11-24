import { describe, expect, it } from "vitest";
import {
  isArchitectureLike,
  normalizeArchitecture,
  parseRawArchitecture,
  slugify
} from "../src/modules/analysis/architecture.schema";
import { ApiError } from "../src/shared/utils/api-error";

describe("slugify", () => {
  it("kebab-cases mixed input", () => {
    expect(slugify("Auth Routes!")).toBe("auth-routes");
    expect(slugify("  User  Model  ")).toBe("user-model");
    expect(slugify("Payment_Gateway v2")).toBe("payment-gateway-v2");
  });

  it("strips diacritics via NFKD normalization", () => {
    expect(slugify("café")).toBe("cafe");
    // NFKD splits ï into i + U+0308; the combining mark becomes the dash
    expect(slugify("naïve scheme")).toBe("nai-ve-scheme");
  });

  it("falls back to 'component' when nothing usable remains", () => {
    expect(slugify("???")).toBe("component");
    expect(slugify("")).toBe("component");
  });

  it("caps length at 48 characters", () => {
    const long = "a".repeat(80);
    expect(slugify(long)).toHaveLength(48);
  });

  it("trims leading/trailing dashes", () => {
    expect(slugify("--auth--routes--")).toBe("auth-routes");
  });
});

describe("isArchitectureLike", () => {
  it("accepts objects with a components array", () => {
    expect(isArchitectureLike({ components: [] })).toBe(true);
    expect(isArchitectureLike({ components: [{ name: "x", type: "y" }], extra: true })).toBe(true);
  });

  it.each([null, undefined, 42, "str", [], { connections: [] }, { components: "not-array" }])(
    "rejects %p",
    (value) => {
      expect(isArchitectureLike(value)).toBe(false);
    }
  );
});

describe("parseRawArchitecture", () => {
  it("parses a valid architecture and defaults connections to []", () => {
    const parsed = parseRawArchitecture({
      components: [{ id: "a", name: "Alpha", type: "service" }],
      connections: [{ from: "a", to: "a2", label: "calls" }]
    });
    expect(parsed.components[0].name).toBe("Alpha");
    expect(parsed.connections[0].label).toBe("calls");

    const noConns = parseRawArchitecture({
      components: [{ name: "Solo", type: "model" }]
    });
    expect(noConns.connections).toEqual([]);
  });

  it("throws ApiError 422 when components are missing or empty", () => {
    for (const bad of [null, {}, { components: [] }]) {
      try {
        parseRawArchitecture(bad);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).statusCode).toBe(422);
      }
    }
  });

  it("throws ApiError 422 listing issue paths for bad component shapes", () => {
    try {
      parseRawArchitecture({ components: [{ type: "missing-name-and-type" }] });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const details = (err as ApiError).details as { issues: Array<{ path: string }> };
      expect(details.issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects non-string ids/names/types", () => {
    try {
      parseRawArchitecture({ components: [{ name: 123, type: "x" }] });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(422);
    }
  });
});

describe("normalizeArchitecture (edge cases)", () => {
  it("truncates long names/descriptions and caps files per component", () => {
    const arch = normalizeArchitecture({
      components: [
        {
          name: "N".repeat(300),
          type: "service",
          description: "d".repeat(1000),
          files: Array.from({ length: 30 }, (_, i) => [`nested\\dir`, `f${i}.ts`].join("\\"))
        }
      ],
      connections: []
    });

    expect(arch.components[0].name).toHaveLength(120);
    expect(arch.components[0].description).toHaveLength(500);
    expect(arch.components[0].files).toHaveLength(12);
    expect(arch.components[0].files?.every((f) => !f.includes("\\"))).toBe(true);
  });

  it("defaults empty description to undefined and normalizes type separators", () => {
    const arch = normalizeArchitecture({
      components: [
        { name: "X", type: "Third Party API" },
        { name: "Y", type: "Some Cool Thing" }
      ],
      connections: []
    });
    expect(arch.components[0].description).toBeUndefined();
    // third-party synonyms collapse into the single `external` canonical type
    // (TYPE_ALIASES), which is what the district mapping keys off
    expect(arch.components[0].type).toBe("external");
    // unknown multi-word types only get their separators normalized
    expect(arch.components[1].type).toBe("some_cool_thing");
  });

  it("deduplicates identical connections but keeps distinct labels", () => {
    const arch = normalizeArchitecture({
      components: [
        { id: "a", name: "A", type: "s" },
        { id: "b", name: "B", type: "m" }
      ],
      connections: [
        { from: "a", to: "b", label: "uses" },
        { from: "a", to: "b", label: "uses" },
        { from: "a", to: "b", label: "reads" }
      ]
    });
    expect(arch.connections).toHaveLength(2);
    expect(arch.connections.map((c) => c.label)).toEqual(["uses", "reads"]);
  });

  it("resolves endpoints referenced by original id OR display name", () => {
    const arch = normalizeArchitecture({
      components: [
        { id: "orig-id", name: "Display Name", type: "controller" },
        { id: "other", name: "Other", type: "model" }
      ],
      connections: [
        { from: "Display Name", to: "other", label: "l1" },
        { from: "orig-id", to: "Other", label: "l2" },
        { from: "Orig Id", to: "other", label: "l3" } // fuzzy slug of orig-id
      ]
    });
    expect(arch.connections).toHaveLength(3);
    for (const c of arch.connections) {
      expect(["orig-id", "other"]).toContain(c.from);
      expect(c.to).toBe("other");
    }
  });

  it("defaults blank labels to 'uses' and truncates long ones", () => {
    const arch = normalizeArchitecture({
      components: [
        { id: "a", name: "A", type: "s" },
        { id: "b", name: "B", type: "s" }
      ],
      connections: [
        { from: "a", to: "b", label: "" },
        { from: "a", to: "b", label: "L".repeat(200) }
      ]
    });
    expect(arch.connections[0].label).toBe("uses");
    expect(arch.connections[1].label).toHaveLength(80);
  });

  it("caps total components at 60", () => {
    const arch = normalizeArchitecture({
      components: Array.from({ length: 80 }, (_, i) => ({ name: `Comp ${i}`, type: "other" })),
      connections: []
    });
    expect(arch.components).toHaveLength(60);
  });

  it("regenerates colliding slugs deterministically (-2, -3 ...)", () => {
    const arch = normalizeArchitecture({
      components: [
        { name: "Same Name", type: "s" },
        { name: "Same Name", type: "s" },
        { name: "Same Name", type: "s" }
      ],
      connections: []
    });
    const ids = arch.components.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe("same-name");
    expect(ids).toContain("same-name-2");
  });
});
