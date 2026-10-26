import type { ProjectMetadata } from "../parser/parser.types";

/**
 * Builds the COMPACT metadata payload for the AI — never raw ASTs.
 * Optimized for minimal token usage while preserving architectural signal.
 */
export function compactMetadataForPrompt(metadata: ProjectMetadata): string {
  const lines: string[] = [];

  // ── project header (1 line) ──
  const p = metadata.project;
  lines.push(
    `REPO:${p.name} LANG:${p.primaryLanguage ?? "?"} ` +
    `FILES:${metadata.stats.filesConsidered} FNS:${metadata.stats.totalFunctions} ` +
    `CLASSES:${metadata.stats.totalClasses} ROUTES:${metadata.stats.totalRoutes} ` +
    `MODELS:${metadata.stats.totalModels}`
  );

  // ── ES6+ syntax profile (1 line) ──
  const sx = metadata.syntax;
  if (sx) {
    lines.push(
      `ES6+:${sx.es6PlusFiles}/${sx.totalFiles} ` +
      `ARROW:${sx.arrowFunctions} ASYNC:${sx.asyncAwait} ` +
      `TPL:${sx.templateLiterals} DESTRUCT:${sx.destructuring} ` +
      `MOD:${sx.modules}`
    );
  }

  // ── runtime signals (1 line) ──
  const sg = metadata.signals;
  if (sg) {
    lines.push(
      `SIG:await=${sg.awaitCalls} env=${sg.processEnvUsage} ` +
      `cerr=${sg.consoleErrorCalls} swallowed=${sg.swallowedErrors} ` +
      `require=${sg.requireCalls} cjs=${sg.cjsExports}`
    );
  }

  // ── dependencies (compressed to names only, 1 line) ──
  const deps = Object.keys(metadata.dependencies).slice(0, 50);
  lines.push(`DEPS:${deps.join(",")}`);

  // ── auth indicators (1 line) ──
  const ai = metadata.authIndicators;
  lines.push(
    `AUTH:jwt=${ai.jwtLibraryUsed} pw=${ai.passwordHashingUsed} ` +
    `passport=${ai.passportUsed} session=${ai.sessionUsed} oauth=${ai.oauthUsed}`
  );

  // ── routes: METHOD path -> handler (compact, up to 60) ──
  if (metadata.routes.length > 0) {
    const routeStrs = metadata.routes
      .slice(0, 60)
      .map((r) => `${r.method}:${r.path}>${r.handler.split("(")[0].trim()}`);
    lines.push(`ROUTES:${routeStrs.join(" | ")}`);
  }

  // ── models: name(fields) (up to 30) ──
  if (metadata.models.length > 0) {
    const modelStrs = metadata.models
      .slice(0, 30)
      .map((m) => `${m.name}(${m.fields.slice(0, 6).join(",")})`);
    lines.push(`MODELS:${modelStrs.join(" | ")}`);
  }

  // ── controllers + services: name@file (up to 25 each) ──
  if (metadata.controllers.length > 0) {
    const cStrs = metadata.controllers
      .slice(0, 25)
      .map((c) => `${c.name}@${shortPath(c.file)}`);
    lines.push(`CTRL:${cStrs.join(",")}`);
  }
  if (metadata.services.length > 0) {
    const sStrs = metadata.services
      .slice(0, 25)
      .map((s) => `${s.name}@${shortPath(s.file)}`);
    lines.push(`SVC:${sStrs.join(",")}`);
  }

  // ── key classes: name(extends)(methods) (up to 25) ──
  if (metadata.classes.length > 0) {
    const clStrs = metadata.classes
      .slice(0, 25)
      .map((c) => `${c.name}${c.extends ? `>${c.extends}` : ""}(${c.methods.slice(0, 5).join(",")})`);
    lines.push(`CLASS:${clStrs.join(" | ")}`);
  }

  // ── file roles summary (1 line) ──
  const roles: Record<string, number> = {};
  for (const f of metadata.files) roles[f.role] = (roles[f.role] ?? 0) + 1;
  const roleStrs = Object.entries(roles).map(([k, v]) => `${k}:${v}`);
  lines.push(`ROLES:${roleStrs.join(",")}`);

  // ── top imports: source only (up to 40, deduplicated) ──
  const seenImports = new Set<string>();
  const importSources: string[] = [];
  for (const imp of metadata.imports) {
    if (seenImports.has(imp.source) || importSources.length >= 40) continue;
    seenImports.add(imp.source);
    importSources.push(imp.source);
  }
  if (importSources.length > 0) {
    lines.push(`IMPORTS:${importSources.join(",")}`);
  }

  let text = lines.join("\n");

  // hard budget so we never blow the context window
  const MAX_CHARS = 32_000;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) + "\n...TRUNCATED";
  }
  return text;
}

/** Shorten a file path to its last 2 meaningful segments. */
function shortPath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

export const ARCHITECT_SYSTEM_PROMPT = `You are a senior software architect.
You receive a compact summary of a JavaScript/TypeScript codebase.
Format: line-oriented key:value pairs (REPO, ES6+, SIG, DEPS, AUTH, ROUTES, MODELS, CTRL, SVC, CLASS, ROLES, IMPORTS).

Key signals to use:
- ES6+: proportion of files using modern syntax (arrow functions, async/await, modules, etc.)
- SIG: runtime signals — await calls, process.env usage, console.error counts, swallowed errors (catch without rethrow), require() calls, CJS exports
- ROUTES: HTTP endpoints as METHOD:path>handler
- MODELS: Mongoose models with field names
- CTRL/SVC: controllers and services with file locations
- CLASS: key classes with extends and methods
- AUTH: which auth mechanisms are in use

Reason about the architecture and reply with ONLY valid JSON — no prose, no markdown fences.

Output JSON schema:
{
  "components": [
    {
      "id": "kebab-case-stable-id",
      "name": "Human Name",
      "type": "one of: frontend | routes | controller | service | model | database | middleware | auth | integration | config | external",
      "description": "One or two sentences describing this component's responsibility.",
      "files": ["optional/repo/relative/file.ts"]
    }
  ],
  "connections": [
    { "from": "<component id>", "to": "<component id>", "label": "short verb like calls / delegates to / persists to" }
  ]
}

Rules:
- Group related files into meaningful components (e.g. "auth-routes", "auth-controller", "user-model").
- Frontend: emit ONE component per UI surface / screen / route group. NEVER lump the whole UI into a single
  "Frontend App" component. Give each its own type "frontend". If React/Vue/JSX files were
  detected you MUST emit at least 2 frontend components (aim for one per major screen or view).
  Use type "frontend" (not "page", "view", "component" or "ui") for all of them.
- Include an external component for third-party APIs when clear from DEPS/IMPORTS.
- Every connection's from/to MUST be ids present in "components".
- Produce between 4 and 25 components. Keep ids STABLE and semantic (they drive a 3D map).
- Use SIG.swallowedErrors and SIG.cerr to flag potential error-handling concerns in descriptions.
- Return ONLY the JSON object.`;

export function architectUserPrompt(metadataJson: string): string {
  return `Analyze this codebase summary and produce the architecture JSON.\n\n${metadataJson}`;
}

export const CHAT_SYSTEM_PROMPT = `You are Software World Guide, an assistant that explains the
architecture of an analyzed repository to developers standing inside a 3D map of it.
You get the validated architecture JSON (components + connections).
Answer the user's question in 2-5 short sentences.
Then output a final line EXACTLY in this format:
TARGET_COMPONENT: <component-id-or-NONE>
PATH: <comma-separated component ids describing a walk through the map, or NONE>`;
