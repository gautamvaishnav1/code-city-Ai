
import { AnalysisContext } from '../types/file-analysis.types.js';
import { getNodeName, getParentClassName } from './babel-node.utils.js';
import {
  makeClassKey,
  makeFileKey,
  makeFunctionKey,
  makeMethodKey,
} from './graph-key.utils.js';

export function createBabelVisitor(ctx: AnalysisContext) {
  const {
    relativePath,
    fileKey,
    metrics,
    addNode,
    addEdge,
  } = ctx;

  function getEnclosingFunctionKey(nodePath: any): string | null {
    const fnPath = nodePath.getFunctionParent?.();

    if (!fnPath) {
      return null;
    }

    return getFunctionNodeKey(fnPath);
  }

  function getFunctionNodeKey(nodePath: any): string | null {
    const node = nodePath.node;

    if (node.type === 'ClassMethod') {
      const methodName = node.key?.name ?? node.key?.value;

      if (!methodName) {
        return null;
      }

      const className = getParentClassName(nodePath);

      return makeMethodKey(relativePath, className, String(methodName));
    }

    if (node.type === 'FunctionDeclaration') {
      const name = node.id?.name;

      return name ? makeFunctionKey(relativePath, name, node) : null;
    }

    if (
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      const parent = nodePath.parent;

      if (parent?.type === 'VariableDeclarator' && parent.id?.name) {
        return makeFunctionKey(relativePath, parent.id.name, node);
      }

      if (parent?.type === 'ObjectProperty') {
        const name = parent.key?.name ?? parent.key?.value;

        if (name) {
          return makeFunctionKey(relativePath, String(name), node);
        }
      }

      if (parent?.type === 'AssignmentExpression') {
        const left = parent.left;

        if (left.type === 'MemberExpression') {
          const objectName = getNodeName(left.object);
          const property = left.property?.name ?? left.property?.value;

          if (objectName === 'module' && property === 'exports') {
            return makeFunctionKey(relativePath, node.id?.name ?? null, node);
          }

          if (objectName === 'exports' && property) {
            return makeFunctionKey(relativePath, String(property), node);
          }
        }
      }

      if (node.id?.name) {
        return makeFunctionKey(relativePath, node.id.name, node);
      }

      return makeFunctionKey(relativePath, null, node);
    }

    return null;
  }

  function ensureClassNode(className: string): string {
    const classKey = makeClassKey(relativePath, className);

    addNode({
      key: classKey,
      type: 'class',
      name: className,
      path: relativePath,
      qualifiedName: `${relativePath}:${className}`,
      parentKey: fileKey,
    });

    addEdge({
      fromKey: fileKey,
      toKey: classKey,
      type: 'contains',
    });

    return classKey;
  }

  return {
    ImportDeclaration(nodePath: any) {
      const specifier = String(nodePath.node.source.value);

      metrics.imports.push(specifier);

      addEdge({
        fromKey: fileKey,
        toName: specifier,
        type: 'imports',
        meta: {
          specifier,
          relative:
            specifier.startsWith('.') || specifier.startsWith('/'),
        },
      });
    },

    ClassDeclaration(nodePath: any) {
      const name = nodePath.node.id?.name;

      if (!name) {
        return;
      }

      metrics.classes.push(name);

      if (nodePath.node.decorators?.length) {
        metrics.hasDecorator = true;
      }

      const classKey = makeClassKey(relativePath, name);

      addNode({
        key: classKey,
        type: 'class',
        name,
        path: relativePath,
        qualifiedName: `${relativePath}:${name}`,
        parentKey: fileKey,
        metrics: {
          line: nodePath.node.loc?.start?.line,
        },
      });

      addEdge({
        fromKey: fileKey,
        toKey: classKey,
        type: 'contains',
      });
    },

    ClassMethod(nodePath: any) {
      const methodName = nodePath.node.key?.name ?? nodePath.node.key?.value;

      if (!methodName) {
        return;
      }

      const className = getParentClassName(nodePath);

      metrics.functions.push(`${nodePath.node.kind}:${methodName}`);

      if (nodePath.node.decorators?.length) {
        metrics.hasDecorator = true;
      }

      let parentKey = fileKey;

      if (className) {
        parentKey = ensureClassNode(className);
      }

      const methodKey = makeMethodKey(
        relativePath,
        className,
        String(methodName),
      );

      const qualifiedName = className
        ? `${relativePath}:${className}.${methodName}`
        : `${relativePath}:${methodName}`;

      addNode({
        key: methodKey,
        type: 'method',
        name: String(methodName),
        path: relativePath,
        qualifiedName,
        parentKey,
        metrics: {
          line: nodePath.node.loc?.start?.line,
          kind: nodePath.node.kind,
        },
      });

      addEdge({
        fromKey: parentKey,
        toKey: methodKey,
        type: 'contains',
      });
    },

    FunctionDeclaration(nodePath: any) {
      const name = nodePath.node.id?.name;

      if (!name) {
        return;
      }

      metrics.functions.push(name);

      const functionKey = makeFunctionKey(relativePath, name, nodePath.node);

      addNode({
        key: functionKey,
        type: 'function',
        name,
        path: relativePath,
        qualifiedName: `${relativePath}:${name}`,
        parentKey: fileKey,
        metrics: {
          line: nodePath.node.loc?.start?.line,
        },
      });

      addEdge({
        fromKey: fileKey,
        toKey: functionKey,
        type: 'contains',
      });
    },

    FunctionExpression(nodePath: any) {
      const name = nodePath.node.id?.name;

      if (!name) {
        return;
      }

      metrics.functions.push(name);

      const functionKey = makeFunctionKey(relativePath, name, nodePath.node);

      addNode({
        key: functionKey,
        type: 'function',
        name,
        path: relativePath,
        qualifiedName: `${relativePath}:${name}`,
        parentKey: fileKey,
        metrics: {
          line: nodePath.node.loc?.start?.line,
        },
      });

      addEdge({
        fromKey: fileKey,
        toKey: functionKey,
        type: 'contains',
      });
    },

    VariableDeclarator(nodePath: any) {
      const init = nodePath.node.init;
      const name = nodePath.node.id?.name;

      if (!name || !init) {
        return;
      }

      if (
        init.type === 'ArrowFunctionExpression' ||
        init.type === 'FunctionExpression'
      ) {
        metrics.functions.push(name);

        const functionKey = makeFunctionKey(relativePath, name, init);

        addNode({
          key: functionKey,
          type: 'function',
          name,
          path: relativePath,
          qualifiedName: `${relativePath}:${name}`,
          parentKey: fileKey,
          metrics: {
            line: init.loc?.start?.line,
          },
        });

        addEdge({
          fromKey: fileKey,
          toKey: functionKey,
          type: 'contains',
        });
      }
    },

    AssignmentExpression(nodePath: any) {
      const left = nodePath.node.left;

      if (left.type !== 'MemberExpression') {
        return;
      }

      const objectName = getNodeName(left.object);
      const property = left.property?.name ?? left.property?.value;
      const right = nodePath.node.right;

      const isFunctionValue =
        right?.type === 'FunctionExpression' ||
        right?.type === 'ArrowFunctionExpression';

      if (!isFunctionValue) {
        return;
      }

      if (objectName === 'module' && property === 'exports') {
        metrics.exports.push('module.exports');

        const functionName = right.id?.name ?? 'module.exports';

        if (right.id?.name) {
          metrics.functions.push(right.id.name);
        }

        const functionKey = makeFunctionKey(
          relativePath,
          right.id?.name ?? null,
          right,
        );

        addNode({
          key: functionKey,
          type: 'function',
          name: functionName,
          path: relativePath,
          qualifiedName: `${relativePath}:${functionName}`,
          parentKey: fileKey,
          metrics: {
            line: right.loc?.start?.line,
          },
        });

        addEdge({
          fromKey: fileKey,
          toKey: functionKey,
          type: 'contains',
        });
      }

      if (objectName === 'exports' && property) {
        metrics.exports.push(String(property));
        metrics.functions.push(String(property));

        const functionKey = makeFunctionKey(
          relativePath,
          String(property),
          right,
        );

        addNode({
          key: functionKey,
          type: 'function',
          name: String(property),
          path: relativePath,
          qualifiedName: `${relativePath}:${property}`,
          parentKey: fileKey,
          metrics: {
            line: right.loc?.start?.line,
          },
        });

        addEdge({
          fromKey: fileKey,
          toKey: functionKey,
          type: 'contains',
        });
      }
    },

    IfStatement() {
      metrics.complexity++;
    },

    ForStatement() {
      metrics.complexity++;
    },

    ForInStatement() {
      metrics.complexity++;
    },

    ForOfStatement() {
      metrics.complexity++;
    },

    WhileStatement() {
      metrics.complexity++;
    },

    DoWhileStatement() {
      metrics.complexity++;
    },

    SwitchCase(nodePath: any) {
      if (nodePath.node.test) {
        metrics.complexity++;
      }
    },

    ConditionalExpression() {
      metrics.complexity++;
    },

    LogicalExpression(nodePath: any) {
      if (['&&', '||', '??'].includes(nodePath.node.operator)) {
        metrics.complexity++;
      }
    },

    TryStatement() {
      metrics.hasTryCatch = true;
    },

    CatchClause(nodePath: any) {
      metrics.hasTryCatch = true;
      metrics.complexity++;

      const body = nodePath.node.body?.body || [];

      const hasConsole = body.some((stmt: any) => {
        return (
          stmt.type === 'ExpressionStatement' &&
          stmt.expression?.type === 'CallExpression' &&
          stmt.expression.callee?.type === 'MemberExpression' &&
          stmt.expression.callee.object?.name === 'console'
        );
      });

      const hasThrow = body.some(
        (stmt: any) => stmt.type === 'ThrowStatement',
      );

      const hasReturn = body.some(
        (stmt: any) => stmt.type === 'ReturnStatement',
      );

      if (hasConsole && !hasThrow && !hasReturn) {
        metrics.hasSilentCatch = true;
      }
    },

    ThrowStatement() {
      metrics.hasThrow = true;
    },

    AwaitExpression() {
      metrics.hasAwait = true;
    },

    MemberExpression(nodePath: any) {
      const name = getNodeName(nodePath.node);

      if (name.startsWith('process.env')) {
        metrics.hasProcessEnv = true;
      }
    },

    CallExpression(nodePath: any) {
      const callee = nodePath.node.callee;

      // require('mongoose')
      if (callee.type === 'Identifier' && callee.name === 'require') {
        const arg = nodePath.node.arguments[0];

        if (arg?.type === 'StringLiteral') {
          const specifier = arg.value;

          metrics.requires.push(specifier);
          metrics.imports.push(specifier);

          addEdge({
            fromKey: fileKey,
            toName: specifier,
            type: 'requires',
            meta: {
              specifier,
              relative:
                specifier.startsWith('.') ||
                specifier.startsWith('/'),
            },
          });
        }

        return;
      }

      // console.log / console.error
      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'console'
      ) {
        const property = callee.property?.name ?? callee.property?.value;

        if (property === 'log') {
          metrics.hasConsoleLog = true;
        }

        if (property === 'error') {
          metrics.hasConsoleError = true;
        }

        return;
      }

      // fetch(...)
      if (callee.type === 'Identifier' && callee.name === 'fetch') {
        metrics.hasExternalCall = true;
      }

      // axios/http/db-like calls
      if (callee.type === 'MemberExpression') {
        const property = callee.property?.name ?? callee.property?.value;
        const objectName = getNodeName(callee.object);
        const fullName = `${objectName}.${property}`;

        const httpMethods = [
          'get',
          'post',
          'put',
          'patch',
          'delete',
        ];

        const looksLikeHttpCall =
          httpMethods.includes(property) &&
          /axios|http|request|fetch/i.test(objectName);

        const looksLikeDbCall =
          /mongoose|mysql|pg|sequelize|typeorm|prisma|redis|mongo/i.test(
            fullName,
          );

        const looksLikeConnectCall =
          property === 'connect' ||
          property === 'query' ||
          property === 'execute' ||
          property === 'aggregate';

        if (
          looksLikeHttpCall ||
          looksLikeDbCall ||
          looksLikeConnectCall
        ) {
          metrics.hasExternalCall = true;
        }
      }

      // create call edge
      const callerKey = getEnclosingFunctionKey(nodePath) ?? fileKey;

      let targetName = '';

      if (callee.type === 'Identifier') {
        targetName = callee.name;
      }

      if (callee.type === 'MemberExpression') {
        targetName = getNodeName(callee);
      }

      if (!targetName) {
        return;
      }

      if (targetName.startsWith('console.')) {
        return;
      }

      addEdge({
        fromKey: callerKey,
        toName: targetName,
        type: 'calls',
      });
    },
  };
}