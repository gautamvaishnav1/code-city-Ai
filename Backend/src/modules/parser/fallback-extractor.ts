import type { FileFacts, FileRole, RuntimeSignals, SyntaxFacts } from "./parser.types";
import { detectFileRole } from "./ast-analyzer";

/**
 * Lightweight regex extractor used when Babel fails on a single file.
 * Guarantees that one broken file never stops repository analysis.
 */
export function extractWithFallback(filePath: string, code: string, error: unknown): FileFacts {
  const normalized = filePath.replace(/\\/g, "/");
  const imports = new Map<string, Set<string>>();
  const routes: FileFacts["routes"] = [];
  const functions: FileFacts["functions"] = [];
  const classes: FileFacts["classes"] = [];
  const models: FileFacts["models"] = [];
  const exports: FileFacts["exports"] = [];
  const authEvidence = new Set<string>();

  // imports
  const importRe =
    /(?:^|\n)\s*import\s+(?:([\w$*][\w$\s*,{}]*?)\s+from\s+)?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(code)) !== null) {
    const source = m[2] ?? m[3];
    if (!source) continue;
    const specifiers = (m[1] ?? "").trim();
    if (!imports.has(source)) imports.set(source, new Set());
    if (specifiers) {
      for (const part of specifiers.replace(/[{}]/g, "").split(",")) {
        const name = part.trim().replace(/^\*\s+as\s+/, "");
        if (name) imports.get(source)!.add(name);
      }
    }
    for (const label of authEvidenceFor(source.toLowerCase())) authEvidence.add(label);
  }

  // exports
  const exportRe =
    /(?:^|\n)\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*|class\s+|const\s+|let\s+|var\s+)([\w$]+)/g;
  while ((m = exportRe.exec(code)) !== null) {
    const isDefault = /\n\s*export\s+default/.test(m[0]);
    exports.push({ file: normalized, names: [m[1]], kind: isDefault ? "default" : "named" });
    if (/Controller$/i.test(m[1])) authEvidence.add(`controller export ${m[1]}`);
  }
  const moduleExportsRe = /module\.exports\s*=\s*{([^}]*)}/g;
  while ((m = moduleExportsRe.exec(code)) !== null) {
    const names = m[1]
      .split(",")
      .map((part) => part.trim().split(/[:\s]/)[0])
      .filter((n) => n && /^[\w$]+$/.test(n));
    if (names.length > 0) exports.push({ file: normalized, names, kind: "module" });
  }

  // functions
  const fnRe =
    /(?:^|\n)[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)\s*\(([^)]*)\)|(?:^|\n)[ \t]*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*(?::\s*[^=;]+)?=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g;
  let lineNo = 1;
  while ((m = fnRe.exec(code)) !== null) {
    const name = m[1] ?? m[3];
    if (!name) continue;
    lineNo = code.slice(0, m.index).split("\n").length;
    functions.push({
      name,
      file: normalized,
      line: lineNo,
      params: (m[2] ?? m[4] ?? "")
        .split(",")
        .map((p) => p.trim().split(/[:=\s]/)[0])
        .filter(Boolean)
        .slice(0, 8),
      isAsync: /async/.test(m[0]),
      exported: true,
      kind: m[1] ? "function" : "arrow"
    });
  }

  // classes + methods
  const classRe = /(?:^|\n)[ \t]*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([\w$]+)(?:\s+extends\s+([\w$.]+))?/g;
  while ((m = classRe.exec(code)) !== null) {
    lineNo = code.slice(0, m.index).split("\n").length;
    const start = m.index;
    const nextClass = code.slice(start + 10).search(/\nclass\s|\nexport class\s/);
    const bodyEnd = nextClass === -1 ? code.length : start + 10 + nextClass;
    const body = code.slice(start, bodyEnd);
    const methods = [...body.matchAll(/(?:^|\n)[ \t]+(?:async\s+)?([\w$]+)\s*\([^)]*\)\s*{/g)]
      .map((x) => x[1])
      .filter((n) => !["if", "for", "while", "switch", "catch"].includes(n))
      .slice(0, 60);
    classes.push({
      name: m[1],
      file: normalized,
      line: lineNo,
      extends: m[2] ?? null,
      methods,
      exported: true
    });
  }

  // express-style routes
  const routeRe =
    /\b(app|router|api|server|route|routers?)\s*\.\s*(get|post|put|patch|delete|all|use)\s*\(\s*["'`]([^"'`]*)["'"]\s*,\s*([\w$.]+)/g;
  while ((m = routeRe.exec(code)) !== null) {
    routes.push({
      method: m[2].toUpperCase() as FileFacts["routes"][number]["method"],
      path: m[3] || "/",
      handler: m[4],
      file: normalized
    });
    if (/auth/i.test(m[4])) authEvidence.add(`auth middleware "${m[4]}"`);
  }

  // mongoose models
  const modelRe = /mongoose\.model[<(]\s*["'](\w+)["']/g;
  while ((m = modelRe.exec(code)) !== null) {
    models.push({ name: m[1], file: normalized, collection: null, fields: [] });
  }

  // auth calls
  if (/\b(jwt|jsonwebtoken)\s*\.\s*(sign|verify)\s*\(/i.test(code))
    authEvidence.add("jwt.sign()/verify() call");
  if (/\b(bcryptjs?|argon2?)\s*\.\s*(hash|compare)/i.test(code))
    authEvidence.add("password hashing call");
  if (/passport\s*\.\s*authenticate/.test(code)) authEvidence.add("passport.authenticate() call");

  // lightweight regex-based syntax detection for fallback files
  const hasArrow = /=>\s*[{(]|=>\s*[\w$]/.test(code);
  const hasTemplate = /`[^`]*`/.test(code);
  const hasDestructure = /\{[^}]*\}\s*=|const\s*\{[^}]*\}/.test(code);
  const hasSpread = /\.\.\./.test(code);
  const hasAsyncAwait = /\basync\b|\bawait\b/.test(code);
  const hasClass = /\bclass\s+[\w$]/.test(code);
  const hasLetConst = /\b(let|const)\s+/.test(code);
  const hasModules = /\bimport\s+|\brequire\s*\(|\bmodule\.exports\b|\bexports\./.test(code);
  const syntax: SyntaxFacts = {
    hasArrowFunctions: hasArrow,
    hasTemplateLiterals: hasTemplate,
    hasDestructuring: hasDestructure,
    hasSpreadOperator: hasSpread,
    hasAsyncAwait,
    hasGenerators: /function\s*\*/.test(code),
    hasForOf: /for\s*\([^)]*\bof\b/.test(code),
    hasDefaultParams: /=\s*[^,)]+\)/.test(code),
    hasClasses: hasClass,
    hasGettersSetters: /\bget\s+[\w$]+\s*\(|\bset\s+[\w$]+\s*\(/.test(code),
    hasComputedProps: /\[[\w'"$]+\]\s*:/.test(code),
    hasLetConst,
    hasModules,
    isES6Plus: hasArrow || hasTemplate || hasDestructure || hasSpread || hasAsyncAwait || hasClass || hasLetConst || hasModules
  };

  const requireCount = (code.match(/\brequire\s*\(/g) ?? []).length;
  const cjsExportCount = (code.match(/\bmodule\.exports\b|\bexports\.\w+/g) ?? []).length;
  const awaitCount = (code.match(/\bawait\s+/g) ?? []).length;
  const processEnvCount = (code.match(/\bprocess\.env\b/g) ?? []).length;
  const consoleErrCount = (code.match(/\bconsole\.error\s*\(/g) ?? []).length;
  const consoleWarnCount = (code.match(/\bconsole\.warn\s*\(/g) ?? []).length;
  const consoleLogCount = (code.match(/\bconsole\.log\s*\(/g) ?? []).length;
  // rough: count catch blocks with empty or log-only bodies
  const catchBlocks = (code.match(/\bcatch\s*\([^)]*\)\s*\{/g) ?? []).length;
  const rethrows = (code.match(/\bcatch\s*\([^)]*\)\s*\{[^}]*\bthrow\b/g) ?? []).length;
  const swallowedErrors = Math.max(0, catchBlocks - rethrows);

  const signals: RuntimeSignals = {
    processEnvUsage: processEnvCount,
    consoleErrorCalls: consoleErrCount,
    consoleWarnCalls: consoleWarnCount,
    consoleLogCalls: consoleLogCount,
    awaitCalls: awaitCount,
    swallowedErrors,
    requireCalls: requireCount,
    cjsExports: cjsExportCount
  };

  return {
    path: normalized,
    lines: code.split("\n").length,
    bytes: Buffer.byteLength(code, "utf8"),
    role: detectFileRole(normalized, /\.(jsx|tsx)$/i.test(normalized)),
    syntax,
    signals,
    imports: [...imports.entries()].map(([source, specs]) => ({
      file: normalized,
      source,
      specifiers: [...specs]
    })),
    exports,
    functions,
    classes,
    routes,
    models,
    controllers:
      detectFileRole(normalized, false) === "controller"
        ? [
            {
              name: normalized.split("/").pop()?.replace(/\.[jt]sx?$/, "") ?? normalized,
              file: normalized,
              kind: "controller",
              type: "file",
              routeCount: routes.length
            }
          ]
        : [],
    services:
      detectFileRole(normalized, false) === "service"
        ? [
            {
              name: normalized.split("/").pop()?.replace(/\.[jt]sx?$/, "") ?? normalized,
              file: normalized,
              kind: "service",
              type: "file"
            }
          ]
        : [],
    authEvidence: [...authEvidence],
    parse: {
      ok: false,
      strategy: "fallback",
      durationMs: 0,
      error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)
    }
  };
}

function authEvidenceFor(source: string): string[] {
  const out: string[] = [];
  if (/^(jsonwebtoken|jwt-simple|jose|njwt)$/.test(source)) out.push('jwt library import');
  else if (/passport/.test(source)) out.push("passport import");
  else if (/^(bcrypt|bcryptjs|argon2)$/.test(source)) out.push("password hashing import");
  else if (/^(express-session|cookie-session)$/.test(source)) out.push("session import");
  else if (/oauth/.test(source)) out.push("oauth import");
  return out.map((l) => `${l} "${source}"`);
}
