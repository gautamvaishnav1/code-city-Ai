import { describe, expect, it } from "vitest";
import {
  ARCHITECT_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
  architectUserPrompt,
  compactMetadataForPrompt
} from "../src/modules/ai/ai.prompts";
import type { ProjectMetadata } from "../src/modules/parser/parser.types";

function meta(over: Partial<ProjectMetadata> = {}): ProjectMetadata {
  return {
    generatedAt: new Date().toISOString(),
    project: { name: "demo", repo: "acme/demo" },
    stats: {
      filesConsidered: 1,
      filesParsedBabel: 1,
      filesFallback: 0,
      filesFailed: 0,
      totalFunctions: 0,
      totalClasses: 0,
      totalRoutes: 0,
      totalModels: 0,
      durationMs: 5
    },
    syntax: {
      es6PlusFiles: 1,
      totalFiles: 1,
      arrowFunctions: 1,
      asyncAwait: 0,
      templateLiterals: 0,
      destructuring: 0,
      classes: 0,
      modules: 1
    },
    signals: {
      processEnvUsage: 0,
      consoleErrorCalls: 0,
      consoleWarnCalls: 0,
      consoleLogCalls: 0,
      awaitCalls: 0,
      swallowedErrors: 0,
      requireCalls: 0,
      cjsExports: 0
    },
    dependencies: { express: "^4" },
    devDependencies: {},
    files: [{ path: "index.ts", bytes: 256, lines: 10, role: "entry" }],
    imports: [],
    exports: [],
    functions: [],
    classes: [],
    routes: [],
    controllers: [],
    services: [],
    models: [],
    authIndicators: {
      jwtLibraryUsed: false,
      passwordHashingUsed: false,
      passportUsed: false,
      sessionUsed: false,
      oauthUsed: false,
      authMiddlewareDetected: false,
      evidence: []
    },
    ...over
  };
}

describe("compactMetadataForPrompt", () => {
  it("emits line-oriented summary carrying project/stats/auth info", () => {
    const text = compactMetadataForPrompt(meta());

    expect(text).toContain("REPO:demo");
    expect(text).toContain("FILES:1");
    expect(text).toContain("DEPS:express");
    expect(text).toContain("AUTH:jwt=false");
  });

  it("summarizes dependencies as name list with cap", () => {
    const deps: Record<string, string> = {};
    for (let i = 0; i < 80; i++) deps[`pkg-${i}`] = "1.0.0";

    const text = compactMetadataForPrompt(meta({ dependencies: deps }));
    const depsLine = text.split("\n").find((l) => l.startsWith("DEPS:"));
    expect(depsLine).toBeDefined();
    const names = depsLine!.slice(5).split(",");
    expect(names.length).toBeLessThanOrEqual(50);
  });

  it("caps routes/models/imports samples", () => {
    const m = meta({
      routes: Array.from({ length: 100 }, (_, i) => ({
        method: "GET" as const,
        path: `/${i}`,
        handler: `h${i}`,
        file: "r.ts"
      })),
      models: Array.from({ length: 60 }, (_, i) => ({
        name: `M${i}`,
        file: "m.ts",
        collection: null,
        fields: []
      })),
      imports: Array.from({ length: 70 }, (_, i) => ({
        file: "a.ts",
        source: `lib-${i}`,
        specifiers: []
      }))
    });

    const text = compactMetadataForPrompt(m);
    const routesLine = text.split("\n").find((l) => l.startsWith("ROUTES:"));
    const modelsLine = text.split("\n").find((l) => l.startsWith("MODELS:"));
    const importsLine = text.split("\n").find((l) => l.startsWith("IMPORTS:"));

    expect(routesLine!.split(" | ").length).toBeLessThanOrEqual(60);
    expect(modelsLine!.split(" | ").length).toBeLessThanOrEqual(30);
    expect(importsLine!.slice(8).split(",").length).toBeLessThanOrEqual(40);
  });

  it("counts filesByRole", () => {
    const m = meta({
      files: [
        { path: "s.ts", bytes: 10, lines: 1, role: "service" },
        { path: "s2.ts", bytes: 20, lines: 2, role: "service" },
        { path: "e.ts", bytes: 30, lines: 3, role: "entry" }
      ]
    });
    const text = compactMetadataForPrompt(m);
    expect(text).toContain("ROLES:service:2,entry:1");
  });

  it("truncates oversized payloads to the hard budget with a marker", () => {
    const longPath = "/".concat("segment-".repeat(100), Math.random().toString());
    const m = meta({
      routes: Array.from({ length: 200 }, (_, i) => ({
        method: "POST" as const,
        path: `${longPath}-${i}`,
        handler: "handler",
        file: longPath
      }))
    });

    const text = compactMetadataForPrompt(m);
    expect(text.length).toBeLessThanOrEqual(32_000 + 30);
    expect(text).toContain("TRUNCATED");
  });

  it("never emits raw AST keys in the payload", () => {
    const text = compactMetadataForPrompt(meta());
    expect(text).not.toContain('"ast"');
    expect(text).not.toContain('"type":"File"');
    expect(text).not.toContain('"loc"');
  });

  it("includes ES6+ syntax signals when present", () => {
    const m = meta({
      syntax: {
        es6PlusFiles: 10,
        totalFiles: 12,
        arrowFunctions: 10,
        asyncAwait: 5,
        templateLiterals: 3,
        destructuring: 2,
        classes: 4,
        modules: 11
      }
    });
    const text = compactMetadataForPrompt(m);
    expect(text).toContain("ES6+:10/12");
    expect(text).toContain("ARROW:10");
    expect(text).toContain("ASYNC:5");
  });

  it("includes runtime signals when present", () => {
    const m = meta({
      signals: {
        processEnvUsage: 8,
        consoleErrorCalls: 3,
        consoleWarnCalls: 1,
        consoleLogCalls: 12,
        awaitCalls: 20,
        swallowedErrors: 2,
        requireCalls: 5,
        cjsExports: 4
      }
    });
    const text = compactMetadataForPrompt(m);
    expect(text).toContain("SIG:await=20 env=8 cerr=3 swallowed=2 require=5 cjs=4");
  });
});

describe("prompt constants", () => {
  it("architect system prompt demands strict JSON with components+connections", () => {
    expect(ARCHITECT_SYSTEM_PROMPT).toContain("JSON");
    expect(ARCHITECT_SYSTEM_PROMPT).toContain("components");
    expect(ARCHITECT_SYSTEM_PROMPT).toContain("connections");
  });

  it("chat system prompt requires TARGET_COMPONENT / PATH markers", () => {
    expect(CHAT_SYSTEM_PROMPT).toContain("TARGET_COMPONENT:");
    expect(CHAT_SYSTEM_PROMPT).toContain("PATH:");
  });

  it("architectUserPrompt embeds the summary after an instruction line", () => {
    const inner = compactMetadataForPrompt(meta());
    const prompt = architectUserPrompt(inner);
    expect(prompt.startsWith("Analyze this codebase summary")).toBe(true);
    expect(prompt).toContain(inner);
  });
});
