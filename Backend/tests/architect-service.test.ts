import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectMetadata } from "../src/modules/parser/parser.types";
import { generateArchitecture, generateHeuristic } from "../src/modules/ai/architect.service";

const { llmConfiguredMock, chatCompletionMock } = vi.hoisted(() => ({
  llmConfiguredMock: vi.fn<() => boolean>(),
  chatCompletionMock: vi.fn()
}));

vi.mock("../src/infrastructure/llm/llm.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/infrastructure/llm/llm.client")>();
  return {
    ...actual,
    llmConfigured: llmConfiguredMock,
    chatCompletion: chatCompletionMock
  };
});

function meta(): ProjectMetadata {
  return {
    generatedAt: new Date().toISOString(),
    project: { name: "shop-api", repo: "acme/shop-api" },
    stats: {
      filesConsidered: 5,
      filesParsedBabel: 5,
      filesFallback: 0,
      filesFailed: 0,
      totalFunctions: 3,
      totalClasses: 1,
      totalRoutes: 2,
      totalModels: 1,
      durationMs: 10
    },
    dependencies: { express: "^4", mongoose: "^8", axios: "^1" },
    devDependencies: {},
    files: [
      { path: "server.js", bytes: 512, lines: 20, role: "entry" },
      { path: "src/routes/auth.routes.ts", bytes: 768, lines: 30, role: "routes" },
      { path: "src/controllers/auth.controller.ts", bytes: 1024, lines: 40, role: "controller" },
      { path: "src/services/order.service.ts", bytes: 640, lines: 25, role: "service" },
      { path: "src/models/user.model.ts", bytes: 384, lines: 15, role: "model" }
    ],
    imports: [],
    exports: [],
    functions: [],
    classes: [],
    routes: [
      { method: "POST", path: "/login", handler: "loginUser", file: "src/routes/auth.routes.ts" },
      { method: "GET", path: "/orders/:id", handler: "getOrder", file: "src/routes/order.routes.ts" }
    ],
    controllers: [
      { name: "loginUser", file: "src/controllers/auth.controller.ts", kind: "controller", type: "function" },
      { name: "getOrder", file: "src/controllers/order.controller.ts", kind: "controller", type: "function" }
    ],
    services: [
      { name: "OrderService", file: "src/services/order.service.ts", kind: "service", type: "class" },
      { name: "UserService", file: "src/services/user.service.ts", kind: "service", type: "class" }
    ],
    models: [{ name: "User", file: "src/models/user.model.ts", collection: "users", fields: ["email"] }],
    authIndicators: {
      jwtLibraryUsed: true,
      passwordHashingUsed: false,
      passportUsed: false,
      sessionUsed: false,
      oauthUsed: false,
      authMiddlewareDetected: true,
      evidence: []
    }
  };
}

beforeEach(() => {
  llmConfiguredMock.mockReturnValue(false);
  chatCompletionMock.mockReset();
});

describe("generateHeuristic — component synthesis rules", () => {
  it("creates frontend when a React dependency exists even without component files", () => {
    const m = meta();
    m.dependencies.react = "^18";
    const arch = generateHeuristic(m);
    expect(arch.components.some((c) => c.id === "frontend")).toBe(true);
  });

  it("attaches UI component file paths to a frontend node", () => {
    const m = meta();
    m.files.push({ path: "src/ui/Button.tsx", bytes: 300, lines: 12, role: "component" });
    const arch = generateHeuristic(m);
    // the frontend is now split into one component per UI surface, so the file
    // lands on the surface that owns it instead of a monolithic "frontend" node
    const surface = arch.components.find(
      (c) => c.type === "frontend" && (c.files ?? []).includes("src/ui/Button.tsx")
    );
    expect(surface).toBeDefined();
    expect(surface!.id).not.toBe("server-app");
  });

  it("groups routes and controllers per feature (auth, order)", () => {
    const arch = generateHeuristic(meta());
    const ids = arch.components.map((c) => c.id);
    expect(ids).toContain("auth-routes");
    expect(ids).toContain("order-routes");
    expect(ids.filter((id) => id.endsWith("-controller")).length).toBeGreaterThanOrEqual(2);
  });

  it("links routes -> controllers and adds auth middleware for guarded handlers", () => {
    const arch = generateHeuristic(meta());
    const ids = new Set(arch.components.map((c) => c.id));
    expect(ids.has("auth-middleware")).toBe(true);

    const authRoutes = arch.connections.find((c) => c.from === "auth-routes" && c.to === "auth-middleware");
    expect(authRoutes?.label).toBe("guards");
  });

  it("connects services to their feature controller and models to the database", () => {
    const arch = generateHeuristic(meta());
    const svc = arch.components.find((c) => c.id === "orderservice-svc");
    expect(svc).toBeDefined();

    const modelLink = arch.connections.find((c) => c.to === "user-model" && c.label === "uses");
    expect(modelLink).toBeDefined();

    const dbLink = arch.connections.find((c) => c.to === "mongodb-database");
    expect(dbLink).toBeDefined();
  });

  it("adds external-services integration node for http/sdk dependencies", () => {
    const arch = generateHeuristic(meta());
    const ext = arch.components.find((c) => c.id === "external-services");
    expect(ext?.type).toBe("integration");
    expect(ext?.description).toContain("axios");
  });

  it("reduces to frontend + server-app (fallback-chained) when no backend signals exist", () => {
    const empty: ProjectMetadata = {
      ...meta(),
      routes: [],
      controllers: [],
      services: [],
      models: [],
      // no backend signals at all, but the project HAS a UI — that is enough
      // for the frontend node to be synthesized
      dependencies: { react: "^18" }
    };
    const arch = generateHeuristic(empty);

    const ids = arch.components.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["frontend", "server-app"]));
    expect(ids).not.toContain("core-codebase"); // frontend/server-app are always synthesized
    // chain fallback keeps the graph connected
    expect(arch.connections.length).toBeGreaterThan(0);
    expect(arch.connections[0].label).toBe("relates to");
  });

  it("falls back to core-codebase when NOTHING but the entry file is detected", () => {
    const blank: ProjectMetadata = {
      ...meta(),
      routes: [],
      controllers: [],
      services: [],
      models: [],
      dependencies: {}
    };
    const arch = generateHeuristic(blank);

    const ids = arch.components.map((c) => c.id);
    // no UI signals → no phantom "Frontend App"; the scanned code is shown as
    // one extra component instead of leaving a single orphan node
    expect(ids).toEqual(["server-app", "core-codebase"]);
    expect(arch.connections.length).toBeGreaterThan(0);
    expect(arch.connections[0].label).toBe("relates to");
  });

  it("never produces dangling connections or duplicate edges", () => {
    const arch = generateHeuristic(meta());
    const ids = new Set(arch.components.map((c) => c.id));
    const seen = new Set<string>();
    for (const conn of arch.connections) {
      expect(ids.has(conn.from)).toBe(true);
      expect(ids.has(conn.to)).toBe(true);
      const key = `${conn.from}->${conn.to}:${conn.label}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe("generateArchitecture — engine selection", () => {
  it("returns the heuristic architecture when LLM is not configured", async () => {
    const { architecture, engine } = await generateArchitecture(meta());
    expect(engine).toBe("heuristic");
    expect(architecture.components.length).toBeGreaterThan(0);
    expect(chatCompletionMock).not.toHaveBeenCalled();
  });

  it("uses the LLM result when configured and valid (prose-wrapped JSON ok)", async () => {
    llmConfiguredMock.mockReturnValue(true);
    chatCompletionMock.mockResolvedValue(
      'Sure! Here is the architecture:\n```json\n{"components":[{"id":"api-gateway","name":"API Gateway","type":"routes","files":["server.js"]}],"connections":[]}\n```'
    );

    const { architecture, engine } = await generateArchitecture(meta());

    expect(engine).toBe("llm");
    expect(architecture.components.map((c) => c.id)).toEqual(["api-gateway"]);
  });

  it("retries once with a corrective nudge when the first reply lacks components", async () => {
    llmConfiguredMock.mockReturnValue(true);
    chatCompletionMock
      .mockResolvedValueOnce('{"note": "this is not an architecture"}')
      .mockResolvedValueOnce(
        '{"components":[{"name":"Recovered","type":"service"}],"connections":[]}'
      );

    const { architecture, engine } = await generateArchitecture(meta());

    expect(engine).toBe("llm");
    expect(chatCompletionMock).toHaveBeenCalledTimes(2);
    expect(architecture.components[0].name).toBe("Recovered");
  });

  it("falls back to heuristic mode when the LLM keeps failing", async () => {
    llmConfiguredMock.mockReturnValue(true);
    chatCompletionMock.mockRejectedValue(new Error("503 upstream"));

    const { architecture, engine } = await generateArchitecture(meta());

    expect(engine).toBe("heuristic");
    expect(architecture.components.length).toBeGreaterThan(0);
  });
});
