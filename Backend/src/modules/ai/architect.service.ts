import type { ProjectMetadata } from "../parser/parser.types";
import { chatCompletion, extractJson, llmConfigured } from "../../infrastructure/llm/llm.client";
import { ApiError } from "../../shared/utils/api-error";
import { logger } from "../../shared/utils/logger";
import {
  ARCHITECT_SYSTEM_PROMPT,
  architectUserPrompt,
  compactMetadataForPrompt
} from "./ai.prompts";
import { isArchitectureLike, normalizeArchitecture, parseRawArchitecture } from "../analysis/architecture.schema";
import type { Architecture } from "../analysis/analysis.types";

/**
 * ProjectMetadata -> validated Architecture.
 * Tries the LLM (compact JSON in, strict JSON out, validated + normalized).
 * Falls back to a deterministic heuristic architect so the demo always works,
 * even with zero API keys — one bad LLM response never kills an analysis.
 */
export async function generateArchitecture(metadata: ProjectMetadata): Promise<{
  architecture: Architecture;
  engine: "llm" | "heuristic";
}> {
  if (llmConfigured()) {
    try {
      const architecture = await generateWithLlm(metadata);
      return { architecture, engine: "llm" };
    } catch (err) {
      logger.warn("LLM architect failed, falling back to heuristic mode", {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return { architecture: generateHeuristic(metadata), engine: "heuristic" };
}

async function generateWithLlm(metadata: ProjectMetadata): Promise<Architecture> {
  const content = await chatCompletion(
    [
      { role: "system", content: ARCHITECT_SYSTEM_PROMPT },
      { role: "user", content: architectUserPrompt(compactMetadataForPrompt(metadata)) }
    ],
    0.15
  );

  let parsed: unknown;
  try {
    parsed = extractJson(content);
  } catch (err) {
    throw ApiError.unprocessable("Could not parse AI response as JSON", {
      raw: content.slice(0, 200)
    });
  }

  // retry once with a corrective nudge when shape is wrong
  if (!isArchitectureLike(parsed)) {
    const retry = await chatCompletion(
      [
        { role: "system", content: ARCHITECT_SYSTEM_PROMPT },
        { role: "user", content: architectUserPrompt(compactMetadataForPrompt(metadata)) },
        { role: "assistant", content: content.slice(0, 4000) },
        {
          role: "user",
          content:
            'Your previous reply was not valid per the schema. Reply again with ONLY the JSON object having "components" and "connections".'
        }
      ],
      0
    );
    parsed = extractJson(retry);
  }

  return normalizeArchitecture(parseRawArchitecture(parsed));
}

/* ------------------------------------------------------------------ */
/* Deterministic heuristic architect (offline fallback)                */
/* ------------------------------------------------------------------ */

export function generateHeuristic(m: ProjectMetadata): Architecture {
  interface Node {
    id: string;
    name: string;
    type: string;
    description: string;
    files: string[];
  }
  const components = new Map<string, Node>();
  const connections: Architecture["connections"] = [];

  const add = (id: string, name: string, type: string, description: string, files: string[] = []): string => {
    const existing = components.get(id);
    if (existing) {
      for (const f of files) if (!existing.files.includes(f)) existing.files.push(f);
      return id;
    }
    components.set(id, { id, name, type, description, files });
    return id;
  };

  const link = (from: string | null, to: string, label: string) => {
    if (!from || !components.has(from) || !components.has(to)) return;
    if (!connections.some((c) => c.from === from && c.to === to && c.label === label)) {
      connections.push({ from, to, label });
    }
  };

  // frontend? — split into ONE COMPONENT PER UI SURFACE so the Frontend
  // district is a real neighbourhood of buildings (a screen you can point at)
  // instead of a single monolithic "Frontend App" block.
  const componentFiles = m.files.filter((f) => f.role === "component");
  const hasFrontend =
    componentFiles.length > 0 ||
    Object.keys({ ...m.dependencies }).some((d) => ["react", "vue", "svelte", "@angular/core"].includes(d));
  /** every frontend component we emit — routes are linked from ALL of them */
  const frontendIds: string[] = [];

  /** screen/route-group key + a human label ("pages · Login") */
  const uiGroupOf = (filePath: string): { key: string; label: string } => {
    const parts = filePath.replace(/\\/g, "/").split("/");
    const stem = (parts[parts.length - 1] ?? "").replace(/\.(jsx?|tsx?|vue|svelte)$/i, "") || "app";
    const dir = parts.slice(0, -1);
    const folder = dir.find((p) =>
      ["pages", "views", "screens", "routes", "features", "components", "ui", "layouts"].includes(
        p.toLowerCase()
      )
    );
    return {
      key: slug(folder ? `${folder}-${stem}` : stem),
      label: folder ? `${cap(folder)} · ${stem}` : cap(stem)
    };
  };

  if (componentFiles.length > 0) {
    const groups = new Map<string, { label: string; files: string[] }>();
    for (const f of componentFiles) {
      const g = uiGroupOf(f.path);
      const cur = groups.get(g.key) ?? { label: g.label, files: [] };
      if (cur.files.length < 6) cur.files.push(f.path);
      groups.set(g.key, cur);
    }
    const entries = [...groups.entries()].slice(0, 10);
    for (const [key, g] of entries) {
      frontendIds.push(
        add(
          key,
          g.label,
          "frontend",
          `UI surface rendering part of the client app (${g.files.length} file(s)).`,
          g.files
        )
      );
    }
    // anything past the 10-group cap still belongs to the app, not to nowhere
    if (groups.size > entries.length) {
      const extra = [...groups.entries()]
        .slice(entries.length)
        .flatMap(([, g]) => g.files)
        .slice(0, 6);
      const first = frontendIds[0];
      const target = components.get(first);
      if (target) for (const f of extra) if (!target.files.includes(f)) target.files.push(f);
    }
  } else if (hasFrontend) {
    frontendIds.push(
      add("frontend", "Frontend App", "frontend", "Client application rendering the user interface.", [])
    );
  }

  // group by feature derived from file names (auth.routes.ts -> "auth")
  const featureOf = (filePath?: string): string => {
    if (!filePath) return "core";
    const parts = filePath.replace(/\\/g, "/").split("/");
    let stem = (parts[parts.length - 1] ?? "").replace(/\.(jsx?|tsx?)$/i, "").toLowerCase();
    stem = stem.replace(/([a-z0-9])(routes?|routers?|controllers?|services?|models?|schemas?)/g, "$1-$2");
    stem = stem.replace(/[-._](routes?|routers?|controllers?|services?|models?|schemas?|middleware)+$/, "");
    return slug(stem || parts[parts.length - 2] || "core");
  };

  // entry point
  const entryFile = m.files.find((f) => f.role === "entry");
  const serverId = add(
    "server-app",
    "Express Server",
    "config",
    `Application entry point wiring middleware and mounting routers${
      entryFile ? ` (${entryFile.path})` : ""
    }.`,
    entryFile ? [entryFile.path] : []
  );

  // routes -> controllers per feature
  const routeControllerIds = new Map<string, string>();
  for (const route of m.routes.slice(0, 120)) {
    const feature = featureOf(route.file);
    const routesId = add(
      `${feature}-routes`,
      `${cap(feature)} Routes`,
      "routes",
      `HTTP endpoints for ${feature} (${route.method} ${route.path}, ...).`,
      [route.file]
    );
    for (const fid of frontendIds) link(fid, routesId, "sends requests");

    const controllerEntry = m.controllers.find((c) => c.name === route.handler);
    const controllerName = controllerEntry?.name ?? route.handler.split(".")[0];
    const controllerId = add(
      `${feature}-controller`,
      `${cap(feature)} Controller`,
      "controller",
      `Handles ${feature} requests (e.g. ${route.handler}).`,
      controllerEntry ? [route.file, controllerEntry.file] : [route.file]
    );
    routeControllerIds.set(feature, controllerId);
    link(routesId, controllerId, "delegates to");

    // auth middleware on this route?
    const guarded = /auth|protect|verify/i.test(route.handler);
    if (guarded || m.authIndicators.jwtLibraryUsed) {
      const authId = add(
        "auth-middleware",
        "Auth Middleware",
        "auth",
        "Validates JWTs / sessions before protected handlers run.",
        []
      );
      link(routesId, authId, "guards");
    }
  }

  // services
  for (const svc of m.services.slice(0, 30)) {
    const feature = featureOf(svc.file);
    const svcId = add(
      `${slug(svc.name)}-svc`,
      cap(svc.name),
      "service",
      `Business logic for ${feature}.`,
      [svc.file]
    );
    const ctrl = routeControllerIds.get(feature);
    if (ctrl) link(ctrl, svcId, "calls");
  }

  // models + database
  for (const model of m.models.slice(0, 25)) {
    const modelId = add(
      `${slug(model.name)}-model`,
      `${cap(model.name)} Model`,
      "model",
      `Mongoose model "${model.name}"${model.collection ? ` (collection: ${model.collection})` : ""}${
        model.fields.length ? `, fields: ${model.fields.slice(0, 8).join(", ")}` : ""
      }.`,
      [model.file]
    );
    const owningService =
      m.services.find((s) => s.file === model.file) ??
      m.services.find((s) => featureOf(s.file) === featureOf(model.file));
    const dbId = add(
      "mongodb-database",
      "MongoDB Database",
      "database",
      "Persistence layer storing documents via Mongoose."
    );
    if (owningService) link(`${slug(owningService.name)}-svc`, modelId, "uses");
    link(modelId, dbId, "persists to");
  }

  // external integrations (http clients / known SDKs)
  const externalDeps = Object.keys(m.dependencies).filter((d) =>
    /^(axios|node-fetch|got|stripe|openai|@google\/generativeai|twilio|aws-sdk|nodemailer|firebase)/i.test(d)
  );
  if (externalDeps.length > 0) {
    const extId = add(
      "external-services",
      "External Services",
      "integration",
      `Third-party APIs/SDKs used directly: ${externalDeps.slice(0, 6).join(", ")}.`
    );
    for (const [, comp] of components) {
      if (comp.type === "service") link(comp.id, extId, "integrates with");
    }
  }

  // connect frontend to nothing else? at minimum server exists
  if (components.size <= 1) {
    add(
      "core-codebase",
      "Core Codebase",
      "other",
      "No strong backend signals detected; showing the scanned code as a single component."
    );
  }

  // fallback links so the graph is never fully disconnected
  if (connections.length === 0 && components.size > 1) {
    const ids = [...components.keys()];
    for (let i = 0; i < ids.length - 1; i++) connections.push({ from: ids[i], to: ids[i + 1], label: "relates to" });
  }

  return {
    components: [...components.values()],
    connections
  };
}

function slug(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "core"
  );
}

function cap(input: string): string {
  const clean = input.replace(/[-_]/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
