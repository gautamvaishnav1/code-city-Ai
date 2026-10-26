import * as traverseModule from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import type {
  ClassFact,
  ComponentFact,
  ExportFact,
  FileFacts,
  FileRole,
  FunctionFact,
  ImportFact,
  ModelFact,
  RouteFact,
  RuntimeSignals,
  SyntaxFacts
} from "./parser.types";

type TraverseFn = (ast: t.File, visitor: Record<string, (path: any) => void>) => void;

// @babel/traverse ships CJS with `exports.default`; works under tsx(CJS) and vitest(ESM).
const traverse: TraverseFn = ((traverseModule as unknown as { default?: TraverseFn }).default ??
  (traverseModule as unknown as TraverseFn)) as TraverseFn;

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const KNOWN_ROUTER_NAMES = /^(app|router|api|server|routes?|routers?)$/i;
/** Names of middlewares that put a route behind auth. Exported so the API can
 *  recognise router-level guards (`router.use(requireAuth)`) too. */
export const AUTH_MIDDLEWARE_RE =
  /^(auth|authmiddleware|authenticate|authenticated|isauthenticated|isauth|ensureauthenticated|ensureloggedin|protect|requireauth|requiresauth|requireuser|isrefreshtokenvalid|verifytoken|verifyjwt|checkauth|withauth|authorize|authorise|isauthorized)$/i;

const CAPS = { functions: 300, classes: 100, imports: 200, exports: 200, routes: 200, models: 40 };

/* ------------------------------------------------------------------ */
/* Small AST helpers                                                   */
/* ------------------------------------------------------------------ */

function staticString(node: t.Node | null | undefined): string | null {
  if (!node) return null;
  if (node.type === "StringLiteral") return node.value;
  if (
    node.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
  }
  return null;
}

function memberExprDottedName(me: t.MemberExpression): string | null {
  const parts: string[] = [];
  let cur: t.Node = me;
  while (cur.type === "MemberExpression") {
    const m = cur as t.MemberExpression;
    const prop = propertyName(m);
    if (prop === null) return null;
    parts.unshift(prop);
    cur = m.object;
  }
  if (cur.type !== "Identifier") return null;
  parts.unshift(cur.name);
  return parts.join(".");
}

function propertyName(member: t.MemberExpression): string | null {
  const prop = member.property;
  if (!member.computed && prop.type === "Identifier") return prop.name;
  if (member.computed) return staticString(prop);
  return null;
}

function paramName(p: t.Node): string {
  switch (p.type) {
    case "Identifier":
      return p.name;
    case "AssignmentPattern":
      return paramName(p.left);
    case "RestElement":
      return `...${paramName(p.argument)}`;
    case "ObjectPattern":
      return "{object}";
    case "ArrayPattern":
      return "[array]";
    case "TSParameterProperty":
      return paramName(p.parameter);
    default:
      return "?";
  }
}

function paramNames(params: Array<t.Node>): string[] {
  return params.slice(0, 8).map(paramName);
}

function describeNode(node: t.Node | null | undefined): string {
  if (!node) return "<anonymous>";
  switch (node.type) {
    case "Identifier":
      return node.name;
    case "MemberExpression":
      return memberExprDottedName(node) ?? "<expression>";
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return "<inline>";
    case "CallExpression": {
      const c = node.callee;
      if (c.type === "Identifier") return `${c.name}(...)`;
      if (c.type === "MemberExpression") {
        const dotted = memberExprDottedName(c);
        return dotted ? `${dotted}(...)` : "<call>";
      }
      return "<call>";
    }
    case "ArrayExpression":
      return node.elements.map((e) => describeNode(e)).join(" + ") || "<list>";
    case "ConditionalExpression":
      return `${describeNode(node.consequent)} | ${describeNode(node.alternate)}`;
    case "StringLiteral":
      return node.value;
    default:
      return "<anonymous>";
  }
}

function joinPath(prefix: string, sub: string): string {
  const p = prefix === "" || prefix === "/" ? "" : prefix.replace(/\/+$/, "");
  let s = sub === "" ? "/" : sub.startsWith("/") ? sub : `/${sub}`;
  if (p === "") return s || "/";
  return s === "/" ? p : `${p}${s}`;
}

function objectKeys(obj: t.ObjectExpression): string[] {
  const keys: string[] = [];
  for (const prop of obj.properties) {
    if (prop.type === "ObjectProperty" || prop.type === "ObjectMethod") {
      const k = prop.key;
      if (k.type === "Identifier") keys.push(k.name);
      else if (k.type === "StringLiteral") keys.push(k.value);
    } else if (prop.type === "SpreadElement") {
      keys.push("...");
    }
  }
  return keys;
}

export function detectFileRole(path: string, hasJsx: boolean): FileRole {
  const p = path.replace(/\\/g, "/").toLowerCase();
  const segments = p.split("/");
  const base = segments[segments.length - 1] ?? "";
  if (/__tests__|\.test\.|\.spec\./.test(base)) return "test";
  if (/(^|\/)(controllers?)(\/|$)/.test(`/${p}`) || /\.controller\./.test(base)) return "controller";
  if (/(^|\/)((services?)|(usecases?))(\/|$)/.test(`/${p}`) || /\.(service|usecase)\./.test(base))
    return "service";
  if (/(^|\/)((models?)|(schemas?))(\/|$)/.test(`/${p}`) || /\.(model|schema)\./.test(base))
    return "model";
  if (/(^|\/)((routes?)|(routers?))(\/|$)/.test(`/${p}`) || /\.(routes?|router)\./.test(base))
    return "routes";
  if (/(^|\/)middlewares?(\/|$)/.test(`/${p}`) || /\.middleware\./.test(base)) return "middleware";
  if (/(^|\/)configs?(\/|$)/.test(`/${p}`) || /\.config\./.test(base)) return "config";
  if (hasJsx || /\.(jsx|tsx)$/.test(base)) return "component";
  if (segments.length <= 2 && /^(server|app|index|main)\.(js|mjs|cjs|ts)$/.test(base))
    return "entry";
  return "other";
}

const AUTH_LIB_EVIDENCE: Array<{ test: (source: string) => boolean; label: string }> = [
  { test: (s) => /^(jsonwebtoken|jwt-simple|jose|njwt|@auth0\/jwt)$/.test(s), label: "jwt library" },
  { test: (s) => /^@?passport(\b|-|\/)/.test(s) || s.startsWith("passport"), label: "passport" },
  { test: (s) => /^(bcrypt|bcryptjs|argon2|argon2js)$/.test(s), label: "password hashing" },
  {
    test: (s) => /^(express-session|cookie-session|connect-redis|client-sessions)$/.test(s),
    label: "session"
  },
  {
    test: (s) => /oauth/.test(s) || /^(google-auth-library|openid-client)$/.test(s),
    label: "oauth"
  }
];

function authEvidenceForSource(source: string): string[] {
  const out: string[] = [];
  for (const rule of AUTH_LIB_EVIDENCE) {
    if (rule.test(source.toLowerCase())) out.push(rule.label);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Main analyzer                                                       */
/* ------------------------------------------------------------------ */

interface MountInfo {
  owner: string; // var that .use() was called on
  target: string; // router var being mounted
  prefix: string;
}

/**
 * Traverses a Babel AST and produces OUR compact JSON for one file.
 * Babel only built the AST above; every bit of meaning extracted below is ours.
 */
export function analyzeAST(ast: t.File, filePath: string, code: string): FileFacts {
  const imports: ImportFact[] = [];
  const exports: ExportFact[] = [];
  const functions: FunctionFact[] = [];
  const classes: ClassFact[] = [];
  const models: ModelFact[] = [];
  const routesByOwner = new Map<string, RouteFact[]>();
  const mounts: MountInfo[] = [];
  const routerVars = new Set<string>();
  const schemaFieldsByName = new Map<string, string[]>();
  const authEvidence = new Set<string>();
  const exportedNames = new Set<string>();

  let jsxCount = 0;
  const modelSeen = new Set<string>();

  /* ---- ES6+ syntax detection ---- */
  const syntax: SyntaxFacts = {
    hasArrowFunctions: false,
    hasTemplateLiterals: false,
    hasDestructuring: false,
    hasSpreadOperator: false,
    hasAsyncAwait: false,
    hasGenerators: false,
    hasForOf: false,
    hasDefaultParams: false,
    hasClasses: false,
    hasGettersSetters: false,
    hasComputedProps: false,
    hasLetConst: false,
    hasModules: false,
    isES6Plus: false
  };

  /* ---- runtime / diagnostic signals ---- */
  const signals: RuntimeSignals = {
    processEnvUsage: 0,
    consoleErrorCalls: 0,
    consoleWarnCalls: 0,
    consoleLogCalls: 0,
    awaitCalls: 0,
    swallowedErrors: 0,
    requireCalls: 0,
    cjsExports: 0
  };

  const addRoutes = (owner: string, facts: RouteFact[]) => {
    const list = routesByOwner.get(owner) ?? [];
    for (const f of facts) if (list.length < CAPS.routes) list.push(f);
    routesByOwner.set(owner, list);
  };

  const recordImport = (source: string, specifiers: string[]) => {
    if (imports.length >= CAPS.imports) return;
    imports.push({ file: filePath, source, specifiers });
    for (const label of authEvidenceForSource(source.toLowerCase())) {
      authEvidence.add(`${label} import "${source}"`);
    }
  };

  const markExported = (...names: Array<string | null | undefined>) => {
    for (const n of names) if (n) exportedNames.add(n);
  };

  /* ---------------- visitors ---------------- */

  const visitImportDeclaration = (path: NodePath<t.ImportDeclaration>): void => {
    syntax.hasModules = true;
    const source = path.node.source.value as string;
    const specifiers = path.node.specifiers.map((spec) => {
      if (spec.type === "ImportDefaultSpecifier") return spec.local.name;
      if (spec.type === "ImportNamespaceSpecifier") return `* as ${spec.local.name}`;
      const imported =
        spec.imported.type === "Identifier" ? spec.imported.name : spec.imported.value;
      return imported === spec.local.name ? imported : `${imported} as ${spec.local.name}`;
    });
    recordImport(source, specifiers);
  };

  const visitRequireCall = (path: NodePath<t.CallExpression>): void => {
    const callee = path.node.callee;
    if (!(callee.type === "Identifier" && callee.name === "require")) return;
    signals.requireCalls++;
    syntax.hasModules = true;
    const arg = staticString(path.node.arguments[0]);
    if (arg === null) return;
    const parent = path.parent;
    const specifiers: string[] = [];
    if (parent.type === "VariableDeclarator") {
      const id = parent.id;
      if (id.type === "Identifier") specifiers.push(id.name);
      else if (id.type === "ObjectPattern") {
        for (const prop of id.properties) {
          if (prop.type === "ObjectProperty" && prop.key.type === "Identifier")
            specifiers.push(prop.key.name);
          else if (prop.type === "RestElement" && prop.argument.type === "Identifier")
            specifiers.push(`...${prop.argument.name}`);
        }
      }
    }
    recordImport(arg, specifiers);
  };

  const visitExportNamed = (path: NodePath<t.ExportNamedDeclaration>): void => {
    const decl = path.node.declaration;
    if (decl) {
      if (
        decl.type === "FunctionDeclaration" ||
        decl.type === "ClassDeclaration" ||
        decl.type === "TSDeclareFunction" ||
        decl.type === "TSEnumDeclaration" ||
        decl.type === "TSInterfaceDeclaration" ||
        decl.type === "TSTypeAliasDeclaration"
      ) {
        const names = decl.id ? [decl.id.name] : [];
        exports.push({ file: filePath, names, kind: "named" });
        markExported(...names);
      } else if (decl.type === "VariableDeclaration") {
        const names: string[] = [];
        for (const declarator of decl.declarations) {
          if (declarator.id.type === "Identifier") names.push(declarator.id.name);
        }
        exports.push({ file: filePath, names, kind: "named" });
        markExported(...names);
      }
    }
    const specNames = path.node.specifiers
      .map((s) => (s.exported.type === "Identifier" ? s.exported.name : s.exported.value))
      .filter(Boolean);
    if (specNames.length > 0) {
      exports.push({ file: filePath, names: specNames, kind: "named" });
      markExported(...specNames);
    }
  };

  const visitExportDefault = (path: NodePath<t.ExportDefaultDeclaration>): void => {
    const d = path.node.declaration;
    let name = "<anonymous>";
    if (d.type === "Identifier") name = d.name;
    else if ((d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") && d.id)
      name = d.id.name;
    exports.push({ file: filePath, names: [name], kind: "default" });
    markExported(name !== "<anonymous>" ? name : null);
  };

  const visitExportAll = (path: NodePath<t.ExportAllDeclaration>): void => {
    exports.push({
      file: filePath,
      names: [`* from ${(path.node.source?.value as string) ?? "?"}`],
      kind: "module"
    });
  };

  const visitModuleExportsAssignment = (path: NodePath<t.AssignmentExpression>): void => {
    const left = path.node.left;
    if (left.type !== "MemberExpression") return;
    const dotted = memberExprDottedName(left);
    if (!dotted) return;
    if (dotted === "module.exports") {
      signals.cjsExports++;
      syntax.hasModules = true;
      const right = path.node.right;
      if (right.type === "ObjectExpression") {
        const names = objectKeys(right).filter((k) => k !== "...");
        exports.push({ file: filePath, names, kind: "module" });
        markExported(...names);
      } else {
        const name = describeNode(right);
        exports.push({ file: filePath, names: [name], kind: "module" });
        markExported(name);
      }
    } else if (dotted.startsWith("module.exports.") || dotted.startsWith("exports.")) {
      signals.cjsExports++;
      syntax.hasModules = true;
      const name = dotted.split(".").pop() ?? "";
      if (name) {
        exports.push({ file: filePath, names: [name], kind: "named" });
        markExported(name);
      }
    }
  };

  const pushFunction = (
    name: string | null,
    node: t.FunctionDeclaration | t.ArrowFunctionExpression | t.FunctionExpression,
    line: number,
    kind: FunctionFact["kind"]
  ): void => {
    if (!name || functions.length >= CAPS.functions) return;
    functions.push({
      name,
      file: filePath,
      line,
      params: paramNames(node.params),
      isAsync: Boolean(node.async),
      exported: exportedNames.has(name),
      kind
    });
  };

  const visitFunction = (path: NodePath<any>): void => {
    const node: any = path.node;
    const isArrow = node.type === "ArrowFunctionExpression";
    let name: string | null;
    if (node.type === "FunctionDeclaration") name = node.id?.name ?? null;
    else {
      // assigned to variable / property?
      const parent = path.parent;
      if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier")
        name = parent.id.name;
      else if (parent.type === "AssignmentExpression" && parent.left.type === "Identifier")
        name = parent.left.name;
      else if (parent.type === "ClassProperty" && parent.key.type === "Identifier")
        name = parent.key.name;
      else name = null;
    }
    if (!name) return;
    const line = node.loc?.start?.line ?? 0;
    pushFunction(name, node, line, isArrow ? "arrow" : "function");
  };

  const visitClass = (path: NodePath<t.ClassDeclaration | t.ClassExpression>): void => {
    const node = path.node;
    let name: string | null = node.id?.name ?? null;
    if (!name && node.type === "ClassExpression") {
      const parent = path.parent;
      if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier")
        name = parent.id.name;
    }
    if (!name || classes.length >= CAPS.classes) return;
    const methods: string[] = [];
    if (node.body.type === "ClassBody") {
      for (const member of node.body.body) {
        if (methods.length >= 60) break;
        if (member.type === "ClassMethod" || member.type === "ClassPrivateMethod") {
          const key = member.key;
          if (key.type === "Identifier") methods.push(key.name);
          else if (key.type === "PrivateName") methods.push(`#${key.id.name}`);
        }
      }
    }
    const extendsName =
      node.superClass?.type === "Identifier"
        ? node.superClass.name
        : node.superClass?.type === "MemberExpression"
          ? memberExprDottedName(node.superClass)
          : null;
    classes.push({
      name,
      file: filePath,
      line: node.loc?.start?.line ?? 0,
      extends: extendsName ?? null,
      methods,
      exported: exportedNames.has(name)
    });
  };

  /* ---------------- express route detection ---------------- */

  const resolveRouteTarget = (
    calleeObj: t.Node
  ): { owner: string; basePath: string } | null => {
    let cur: t.Node = calleeObj;
    let baseSegments: string[] = [];
    for (let depth = 0; depth < 8; depth++) {
      if (cur.type === "Identifier") {
        return { owner: cur.name, basePath: joinSegments(baseSegments) };
      }
      if (cur.type === "CallExpression") {
        const c = cur.callee;
        if (c.type !== "MemberExpression") return null;
        const prop = propertyName(c);
        if (!prop) return null;
        // walk through chained calls: router.route("/u").get(a).post(b)
        if (prop === "route") {
          const seg = staticString(cur.arguments[0]);
          if (seg === null) return null;
          baseSegments.unshift(seg);
          cur = c.object;
          continue;
        }
        if (HTTP_METHODS.has(prop) || prop === "all") {
          // intermediate link in the chain — keep walking
          cur = c.object;
          continue;
        }
        return null;
      }
      if (cur.type === "MemberExpression") {
        const dotted = memberExprDottedName(cur);
        return dotted ? { owner: dotted, basePath: joinSegments(baseSegments) } : null;
      }
      return null;
    }
    return null;
  };

  const joinSegments = (segs: string[]): string =>
    segs.length === 0 ? "/" : joinPath(segs.slice(0, -1).join("/") || "/", segs[segs.length - 1]);

  const visitRouterCreation = (path: NodePath<t.VariableDeclarator>): void => {
    const init = path.node.init;
    if (!init || init.type !== "CallExpression") return;
    const id = path.node.id;
    if (id.type !== "Identifier") return;
    const callee = init.callee;
    if (callee.type === "Identifier" && callee.name === "Router") {
      routerVars.add(id.name);
      return;
    }
    if (callee.type === "MemberExpression") {
      const prop = propertyName(callee);
      const objName = callee.object.type === "Identifier" ? callee.object.name : null;
      if (objName === "express" && prop === "Router") routerVars.add(id.name);
      if (objName === "express" && prop === null) {
        // express()
        routerVars.add(id.name);
      }
    }
  };

  const visitRouteCall = (path: NodePath<t.CallExpression>): void => {
    const node = path.node;
    const callee = node.callee;
    if (callee.type !== "MemberExpression") return;
    const prop = propertyName(callee);
    if (!prop) return;
    const target = resolveRouteTarget(callee.object);

    if (HTTP_METHODS.has(prop) || prop === "all") {
      if (!target) return;
      const isRouterVar = routerVars.has(target.owner);
      const isKnownName = KNOWN_ROUTER_NAMES.test(target.owner);
      if (!isRouterVar && !isKnownName) return;

      const args = node.arguments;
      const rawPath = args.length > 0 ? staticString(args[0]) : null;
      const method = prop === "all" ? "ALL" : prop.toUpperCase();
      const handlerArgs = args.filter(
        (a) => !(a.type === "SpreadElement") && staticString(a) === null
      );
      const handler = handlerArgs.map((a) => describeNode(a)).join(", ") || "<anonymous>";

      // auth middleware evidence
      for (const a of handlerArgs) {
        if (a.type === "Identifier" && AUTH_MIDDLEWARE_RE.test(a.name)) {
          authEvidence.add(`middleware "${a.name}" on ${method} ${target.basePath}${rawPath ?? "/"}`);
        }
      }

      addRoutes(target.owner, [
        {
          method: method as RouteFact["method"],
          path: joinPath(target.basePath, rawPath ?? "/"),
          handler: handler,
          file: filePath
        }
      ]);
      return;
    }

    if (prop === "use" && target) {
      const isRouterVar = routerVars.has(target.owner);
      const isKnownName = KNOWN_ROUTER_NAMES.test(target.owner);
      if (!isRouterVar && !isKnownName) return;

      const args = node.arguments;
      const firstStr = staticString(args[0]);
      const startIdx = firstStr !== null ? 1 : 0;
      const prefix = firstStr !== null ? firstStr : "/";

      for (let i = startIdx; i < args.length; i++) {
        const a = args[i];
        if (a.type === "SpreadElement") continue;
        // app.use("/x", someRouter)
        if (a.type === "Identifier") {
          if (routerVars.has(a.name) && a.name !== target.owner) {
            mounts.push({ owner: target.owner, target: a.name, prefix });
            addRoutes(target.owner, [
              { method: "MOUNT", path: joinPath(target.basePath, prefix), handler: a.name, file: filePath }
            ]);
            continue;
          }
          // middleware by identifier
          addRoutes(target.owner, [
            {
              method: "USE",
              path: joinPath(target.basePath, prefix),
              handler: a.name,
              file: filePath
            }
          ]);
          if (AUTH_MIDDLEWARE_RE.test(a.name)) {
            authEvidence.add(`middleware "${a.name}" mounted at ${prefix}`);
          }
        } else {
          const described = describeNode(a);
          addRoutes(target.owner, [
            { method: "USE", path: joinPath(target.basePath, prefix), handler: described, file: filePath }
          ]);
          if (/passport\.authenticate/i.test(described)) authEvidence.add("passport.authenticate()");
        }
      }
    }
  };

  /* ---------------- mongoose models ---------------- */

  const fieldsFromSchemaArg = (arg: t.Node | null | undefined): string[] => {
    if (!arg) return [];
    if (arg.type === "ObjectExpression") return objectKeys(arg).slice(0, 60);
    if (arg.type === "NewExpression") return fieldsFromSchemaArg(arg.arguments[0]);
    if (arg.type === "Identifier") return schemaFieldsByName.get(arg.name) ?? [];
    if (arg.type === "CallExpression" && arg.arguments.length > 0)
      return fieldsFromSchemaArg(arg.arguments[0]);
    return [];
  };

  const visitSchemaNew = (path: NodePath<t.NewExpression>): void => {
    const callee = path.node.callee;
    let isSchema = false;
    if (callee.type === "Identifier" && callee.name === "Schema") isSchema = true;
    if (callee.type === "MemberExpression" && propertyName(callee) === "Schema") {
      const obj = callee.object;
      if (obj.type === "Identifier" && obj.name === "mongoose") isSchema = true;
    }
    if (!isSchema) return;
    const parent = path.parent;
    if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
      schemaFieldsByName.set(parent.id.name, fieldsFromSchemaArg(path.node));
    }
  };

  const visitModelCall = (path: NodePath<t.CallExpression>): void => {
    const callee = path.node.callee;
    if (callee.type !== "MemberExpression") return;
    if (propertyName(callee) !== "model") return;
    const obj = callee.object;
    const objIsMongooseLike =
      (obj.type === "Identifier" &&
        /^(mongoose|db|conn|connection)$/i.test(obj.name)) ||
      (obj.type === "MemberExpression" && memberExprDottedName(obj)?.endsWith("mongoose"));
    if (!objIsMongooseLike) return;

    const nameArg = staticString(path.node.arguments[0]);
    if (!nameArg) return;
    const key = `${filePath}:${nameArg}`;
    if (modelSeen.has(key) || models.length >= CAPS.models) return;

    let collection: string | null = null;
    const third = path.node.arguments[2];
    const thirdStr = staticString(third);
    if (thirdStr !== null) collection = thirdStr;
    else if (third && third.type === "ObjectExpression") {
      for (const prop of third.properties) {
        if (
          prop.type === "ObjectProperty" &&
          prop.key.type === "Identifier" &&
          prop.key.name === "collection"
        ) {
          collection = staticString(prop.value);
        }
      }
    }

    modelSeen.add(key);
    models.push({
      name: nameArg,
      file: filePath,
      collection,
      fields: fieldsFromSchemaArg(path.node.arguments[1])
    });
  };

  /* ---------------- jwt/bcrypt call evidence ---------------- */

  const visitAuthCalls = (path: NodePath<t.CallExpression>): void => {
    const callee = path.node.callee;
    if (callee.type !== "MemberExpression") return;
    const obj = callee.object;
    if (obj.type !== "Identifier") return;
    const prop = propertyName(callee);
    if (!prop) return;
    const nameLower = obj.name.toLowerCase();
    if (
      (nameLower === "jwt" || nameLower === "jsonwebtoken") &&
      ["sign", "verify", "decode"].includes(prop)
    ) {
      authEvidence.add(`${obj.name}.${prop}() call`);
    }
    if (
      /^(bcrypt|bcryptjs)$/.test(nameLower) &&
      ["hash", "compare", "hashsync", "comparesync", "hashpassword", "verifypassword"].includes(
        prop.toLowerCase()
      )
    ) {
      authEvidence.add(`${obj.name}.${prop}() call`);
    }
    if (nameLower.startsWith("passport") && prop === "authenticate") {
      authEvidence.add("passport.authenticate() call");
    }
  };

  /* ---------------- ES6+ syntax detection visitors ---------------- */

  const visitArrowFunction = (path: NodePath<t.ArrowFunctionExpression>): void => {
    syntax.hasArrowFunctions = true;
    // default params?
    if (path.node.params.some((p) => p.type === "AssignmentPattern")) {
      syntax.hasDefaultParams = true;
    }
  };

  const visitTemplateLiteral = (path: NodePath<t.TemplateLiteral>): void => {
    syntax.hasTemplateLiterals = true;
  };

  const visitVariableDeclaratorSyntax = (path: NodePath<t.VariableDeclarator>): void => {
    const id = path.node.id;
    if (id.type === "ObjectPattern" || id.type === "ArrayPattern") {
      syntax.hasDestructuring = true;
    }
    // let/const detection via parent
    const parent = path.parent;
    if (parent.type === "VariableDeclaration" && parent.kind !== "var") {
      syntax.hasLetConst = true;
    }
    // default params on arrow/function assigned to variable
    const init = path.node.init;
    if (
      init &&
      (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") &&
      init.params.some((p) => p.type === "AssignmentPattern")
    ) {
      syntax.hasDefaultParams = true;
    }
  };

  const visitSpreadElement = (path: NodePath<t.SpreadElement | t.RestElement>): void => {
    syntax.hasSpreadOperator = true;
  };

  const visitAwaitExpression = (path: NodePath<t.AwaitExpression>): void => {
    syntax.hasAsyncAwait = true;
    signals.awaitCalls++;
  };

  const visitForOfStatement = (path: NodePath<t.ForOfStatement>): void => {
    syntax.hasForOf = true;
  };

  const visitObjectMethod = (path: NodePath<t.ObjectMethod>): void => {
    const node = path.node;
    if (node.kind === "get" || node.kind === "set") syntax.hasGettersSetters = true;
    if (node.computed) syntax.hasComputedProps = true;
    if (node.generator) syntax.hasGenerators = true;
  };

  const visitClassMethod = (path: NodePath<t.ClassMethod>): void => {
    const node = path.node;
    if (node.kind === "get" || node.kind === "set") syntax.hasGettersSetters = true;
    if (node.computed) syntax.hasComputedProps = true;
    if (node.generator) syntax.hasGenerators = true;
  };

  const visitClassDeclarationSyntax = (
    path: NodePath<t.ClassDeclaration | t.ClassExpression>
  ): void => {
    syntax.hasClasses = true;
  };

  /* ---------------- runtime / diagnostic signal visitors ---------------- */

  const visitProcessEnv = (path: NodePath<t.MemberExpression>): void => {
    const dotted = memberExprDottedName(path.node);
    if (dotted === "process.env" || dotted?.startsWith("process.env.")) {
      signals.processEnvUsage++;
    }
  };

  const visitConsoleCall = (path: NodePath<t.CallExpression>): void => {
    const callee = path.node.callee;
    if (callee.type !== "MemberExpression") return;
    if (callee.object.type !== "Identifier" || callee.object.name !== "console") return;
    const method = propertyName(callee);
    if (method === "error") signals.consoleErrorCalls++;
    else if (method === "warn") signals.consoleWarnCalls++;
    else if (method === "log") signals.consoleLogCalls++;
  };

  /** Detect catch blocks that swallow errors (no throw / rethrow inside). */
  const visitTryStatement = (path: NodePath<t.TryStatement>): void => {
    const handler = path.node.handler;
    if (!handler) return;
    const body = handler.body.body;
    // empty catch or catch that only logs without re-throwing = swallowed
    let hasRethrow = false;
    let hasLogOnly = true;
    for (const stmt of body) {
      if (stmt.type === "ThrowStatement") {
        hasRethrow = true;
        hasLogOnly = false;
        break;
      }
      // allow console.error/warn/log but still counts as swallowed if no rethrow
      if (
        !(
          stmt.type === "ExpressionStatement" &&
          stmt.expression.type === "CallExpression" &&
          stmt.expression.callee.type === "MemberExpression" &&
          stmt.expression.callee.object.type === "Identifier" &&
          stmt.expression.callee.object.name === "console"
        )
      ) {
        hasLogOnly = false;
      }
    }
    if (!hasRethrow && (body.length === 0 || hasLogOnly)) {
      signals.swallowedErrors++;
    }
  };

  /* ---------------- run traversal ---------------- */

  traverse(ast, {
    ImportDeclaration: visitImportDeclaration,
    TSImportEqualsDeclaration: (path: NodePath<t.TSImportEqualsDeclaration>) => {
      syntax.hasModules = true;
      const ref = path.node.moduleReference;
      if (ref.type === "TSExternalModuleReference" && typeof ref.expression.value === "string") {
        recordImport(ref.expression.value, [path.node.id.name]);
      }
    },
    CallExpression: (path: NodePath<t.CallExpression>) => {
      visitRequireCall(path);
      visitAuthCalls(path);
      visitModelCall(path);
      visitConsoleCall(path);
    },
    ExportNamedDeclaration: (path) => {
      syntax.hasModules = true;
      visitExportNamed(path);
    },
    ExportDefaultDeclaration: (path) => {
      syntax.hasModules = true;
      visitExportDefault(path);
    },
    ExportAllDeclaration: (path) => {
      syntax.hasModules = true;
      visitExportAll(path);
    },
    AssignmentExpression: visitModuleExportsAssignment,
    VariableDeclarator: (path: NodePath<t.VariableDeclarator>) => {
      visitRouterCreation(path);
      visitVariableDeclaratorSyntax(path);
    },
    NewExpression: visitSchemaNew,
    FunctionDeclaration: (path: NodePath<t.FunctionDeclaration>) => visitFunction(path),
    FunctionExpression: (path: NodePath<t.FunctionExpression>) => visitFunction(path),
    ArrowFunctionExpression: (path: NodePath<t.ArrowFunctionExpression>) => {
      visitFunction(path);
      visitArrowFunction(path);
    },
    ClassDeclaration: (path: NodePath<t.ClassDeclaration>) => {
      visitClass(path);
      visitClassDeclarationSyntax(path);
    },
    ClassExpression: (path: NodePath<t.ClassExpression>) => {
      visitClass(path);
      visitClassDeclarationSyntax(path);
    },
    JSXOpeningElement: () => {
      jsxCount++;
    },
    // ES6+ syntax visitors
    TemplateLiteral: visitTemplateLiteral,
    SpreadElement: visitSpreadElement,
    RestElement: visitSpreadElement,
    AwaitExpression: visitAwaitExpression,
    ForOfStatement: visitForOfStatement,
    ObjectMethod: visitObjectMethod,
    ClassMethod: visitClassMethod,
    // runtime signal visitors
    MemberExpression: visitProcessEnv,
    TryStatement: visitTryStatement
  });

  // Route calls need the full picture of router vars -> second pass.
  traverse(ast, {
    CallExpression: visitRouteCall
  });

  /* ---------------- finalize ---------------- */

  // Compose mount prefixes (single-file chains like app.use("/api", api); api.use("/v1", v1)).
  const emitted: RouteFact[] = [];
  const mountedTargets = new Set(mounts.map((m) => m.target));

  const resolvePrefix = (ownerVar: string, seen = new Set<string>()): string => {
    if (seen.has(ownerVar)) return "/";
    seen.add(ownerVar);
    const m = mounts.find((x) => x.target === ownerVar);
    if (!m) return "/";
    const upstream = mounts.some((x) => x.target === m.owner)
      ? resolvePrefix(m.owner, seen)
      : "/";
    return joinPath(upstream, m.prefix);
  };

  for (const [owner, facts] of routesByOwner.entries()) {
    if (mountedTargets.has(owner)) continue; // emitted with composed prefixes below
    emitted.push(...facts);
  }
  for (const target of mountedTargets) {
    const prefix = resolvePrefix(target);
    const facts = routesByOwner.get(target) ?? [];
    for (const f of facts) {
      if (f.method === "MOUNT") {
        emitted.push(f);
        continue;
      }
      emitted.push({ ...f, path: f.method === "USE" && f.path === "/" ? prefix : joinPath(prefix, f.path) });
    }
  }

  const role = detectFileRole(filePath, jsxCount > 0);
  const baseName = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
  const stem = baseName.replace(/\.(jsx?|tsx?|mjs|cjs)$/i, "");

  // compute isES6Plus: any ES6+ feature beyond plain ES5
  syntax.isES6Plus =
    syntax.hasArrowFunctions ||
    syntax.hasTemplateLiterals ||
    syntax.hasDestructuring ||
    syntax.hasSpreadOperator ||
    syntax.hasAsyncAwait ||
    syntax.hasGenerators ||
    syntax.hasForOf ||
    syntax.hasDefaultParams ||
    syntax.hasClasses ||
    syntax.hasGettersSetters ||
    syntax.hasComputedProps ||
    syntax.hasLetConst ||
    syntax.hasModules;

  // controllers & services classification
  const controllers: ComponentFact[] = [];
  const services: ComponentFact[] = [];
  const classify = (
    facts: Array<FunctionFact | ClassFact>,
    kind: ComponentFact["kind"],
    suffix: RegExp,
    roleMatches: boolean,
    out: ComponentFact[]
  ) => {
    for (const f of facts) {
      if (suffix.test(f.name) || roleMatches) {
        const isClass = "methods" in f;
        out.push({
          name: f.name,
          file: filePath,
          kind,
          type: isClass ? "class" : "function",
          routeCount:
            kind === "controller" ? emitted.filter((r) => r.handler.includes(f.name)).length : undefined
        });
      }
    }
  };
  classify(functions, "controller", /Controller$/i, role === "controller", controllers);
  classify(classes, "controller", /Controller$/i, role === "controller", controllers);
  classify(functions, "service", /Service$/i, role === "service", services);
  classify(classes, "service", /Service$/i, role === "service", services);
  if (role === "controller" && controllers.every((c) => c.type !== "file")) {
    controllers.push({
      name: stem,
      file: filePath,
      kind: "controller",
      type: "file",
      routeCount: emitted.length
    });
  }
  if (role === "service" && services.every((s) => s.type !== "file")) {
    services.push({ name: stem, file: filePath, kind: "service", type: "file" });
  }

  return {
    path: filePath.replace(/\\/g, "/"),
    lines: code.split("\n").length,
    bytes: Buffer.byteLength(code, "utf8"),
    role,
    syntax,
    signals,
    imports,
    exports,
    functions,
    classes,
    routes: emitted,
    models,
    controllers,
    services,
    authEvidence: [...authEvidence],
    parse: {
      ok: true,
      strategy: "babel",
      durationMs: 0
    }
  };
}
