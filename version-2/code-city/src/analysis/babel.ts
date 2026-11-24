import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { parse } from '@babel/parser'
import * as traverseModule from '@babel/traverse'
import { FileGraph, FileMetrics, GraphEdge, GraphNode } from './types.js'

// visit the tree
const traverse = ((traverseModule as any).default ?? traverseModule) as (
  ast: any,
  visitor: any,
) => void
const MAX_BYTES = 1024 * 1024

/**
 *  reading one file from DISK
 * root :Root directory of the repo like SRC
 * absPath:Absolute path of the file analyze
 * */
export async function readFileGraph (
  root: string,
  absPath: string,
): Promise<FileGraph> {
  const rel = path.relative(root, absPath).split(path.sep).join('/')
  // store metadata like file's size and more
  const stat = fs.stat(absPath)

  if ((await stat).size > MAX_BYTES) {
    return {
      file: rel,
      status: 'skipped',
      nodes: [],
      edges: [],
      error: 'file larger than 1 MB',
      size: (await stat).size,
    }
  }
  // without UTF-8 babel return buffer but with this return string
  const code = await fs.readFile(absPath, 'utf-8')
  return buildGraph(rel, code, (await stat).size)
}

/**
 * the heart of analyze
 * Take source code and return its structural representation
 * @param rel -rel provides a path location
 * @param code code provide which function contain type
 * @param size size provide size of file
 * @returns
 */
export function buildGraph (rel: string, code: string, size: number): FileGraph {
  // fileKey will be give name of file
  const fileKey = `file:${rel}`
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  // Store Identifiers of node that have already added or not and using SET it always return unique values
  const seen = new Set<string>()
  // metrics measurements and characteristic of the file
  const metrics = emptyMetrics(code)

  const addNode = (n: GraphNode) => {
    // node is present or not or analyzed first or not check
    if (seen.has(n.key)) return
    // if not then add in node
    seen.add(n.key)
    nodes.push(n)
  }

  const addEdge = (e: GraphEdge) => edges.push(e)
  addNode({
    name: path.posix.basename(rel),
    key: fileKey,
    Type: 'file',
    path: rel,
    metrics: { loc: metrics.loc, size },
  })

  const fnKey = (name: string) => `function:${rel}:${name}`
  const clsKey = (name: string) => `class:${rel}:${name}`
  const mthKey = (c: string, m: string) => `method:${rel}:${c}:${m}`

  const classNameOF = (p: any): string | null =>
    p.findParent((x: any) => x.isClassDeclaration() || x.isClassExpression())
      ?.node?.id?.name ?? null

  const keyFunction = (fp: any): string => {
    const n = fp.node
    if (n.type === 'ClassMethod' || n.type === 'ObjectMethod') {
      const m = n.key?.name || n.key?.value
      const c = classNameOF(fp)
      if (m && c) return mthKey(c, String(m))
      if (m) return fnKey(String(m))
    }
    if (n.type === 'FunctionDeclaration' && n.id?.name) return fnKey(n.id.name)

    const p = fp.parent
    if (p?.type === 'VariableDeclarator' && p.id?.name) return fnKey(p.id.name)
    if (p?.type === 'ObjectProperty') {
      const k = p?.key?.name ?? p?.key?.value
      if (k) return fnKey(k)
    }
    if (
      p?.type === 'AssignmentExpression' &&
      p.left?.type === 'MemberExpression'
    ) {
      const prop = p.left?.property?.name ?? p.left.property?.value
      if (prop) return fnKey(String(prop))
    }
    if (n.id?.name) {
      return fnKey(n.id?.name)
    }
    return fnKey(`anon:${n.loc?.start?.line ?? 0}`)
  }

  const declareFunction = (
    key: string,
    name: string,
    line?: number,
    parent = fileKey,
  ) => {
    addNode({
      key: key,
      Type: 'function',
      name,
      path: rel,
      qualifiedName: name,
      parentKey: parent,
      metrics: { line },
    })

    addEdge({ fromKey: parent, toKey: key, type: 'contains' })
  }

  let ast: any
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      plugins: ['typescript', 'jsx', 'decorators-legacy'],
      errorRecovery: true,
    })
  } catch (error) {
    return {
      file: rel,
      status: 'parse_error',
      metrics,
      nodes,
      edges,
      error: error instanceof Error ? error.message : String(error),
      size,
    }
  }

  traverse(ast, {
    ImportDeclaration (p: any) {
      const spec = String(p.node.source.value)
      metrics.imports.push(spec)
      addEdge({ fromKey: fileKey, toName: spec, type: 'imports' })
    },

    ClassDeclaration (p: any) {
      // p.node.id.name will return class name if not exists return
      const name = p.node?.id?.name
      if (!name) return
      metrics.classes.push(name)
      addNode({
        key: clsKey(name),
        name,
        Type: 'class',
        path: rel,
        parentKey: fileKey,
        qualifiedName: name,
        metrics: { line: p.node.loc?.start?.line },
      })
      addEdge({ fromKey: fileKey, type: 'contains', toKey: clsKey(name) })
    },

    // this function for method inn class
    ClassMethod (p: any) {
      const m = p.node.key?.name ?? p.node.key?.value
      if (!m) return
      const c = classNameOF(p)
      metrics.functions.push(String(m))
      const key = c ? mthKey(c, String(m)) : fnKey(String(m))
      const parent = c ? clsKey(c) : fileKey
      addNode({
        key,
        Type: c ? 'method' : 'function',
        name: String(m),
        path: rel,
        qualifiedName: c ? `${c}.${m}` : String(m),
        parentKey: parent,
        metrics: { line: p.node.loc?.start?.line },
      })
      addEdge({ fromKey: parent, type: 'contains', toKey: key })
    },
    FunctionDeclaration (p: any) {
      // p.node.id?name is the name of function and if not then return
      const name = p.node.id?.name
      if (!name) return
      metrics.functions.push(name)
      
      const fp = p.getFunctionParent()
      const parent = fp ? keyFunction(fp) : fileKey
      console.log(fnKey(fileKey),name, p.node.loc.start?.line,parent,"##################################33")
      declareFunction(fnKey(fileKey), name, p.node.loc.start?.line,parent)
    },
    VariableDeclarator (p: any) {
      // console.log('VariableDeclaration', p.node.kind, p.node)
      const init = p.node.init
      const name = p.node.id?.name
      console.log('Varibal Decleation', init,name )
      if (!name || !init) return
      if (
        init.type !== 'ArrowFunctionExpression' &&
        init.type !== 'FunctionExpression'
      ) return
      metrics.functions.push(name)
      declareFunction(fnKey(name), name, init.loc?.start?.line)
    },
    AssignmentExpression (p: any) {
      const left = p.node.left
      const right = p.node.right
      if (left?.type !== 'MemberExpression') return
      if (
        right?.type !== 'FunctionExpression' &&
        right?.type !== 'ArrowFunctionExpression'
      )
        return

      const obj = left.object?.name
      const prop = left.property?.name ?? left.property?.value
      if (obj === 'module' && prop === 'export') {
        const name = right?.id?.name ?? 'module.exports'
        metrics.exports.push('module.exports')
        declareFunction(fnKey(name), name, right?.loc?.start?.line)
      } else if (obj === 'exports' && prop) {
        metrics.exports.push(String(prop))
        declareFunction(
          fnKey(String(prop)),
          String(prop),
          right?.loc?.start?.line,
        )
      }
    },
    CallExpression (p: any) {
      const callee = p.node.callee

      if (callee.type === 'Identifier' && callee.name === 'require') {
        const arg = p.node.arguments[0]

        if (arg.type === 'StringLiteral') {
          metrics.requires.push(arg.value)
          addEdge({ fromKey: fileKey, toName: arg.value, type: 'requires' })
        }
        return
      }
      const nameOf = (n: any): string => {
        if (!n) return ''
        if (n.type === 'Identifier') return n.name
        if (n.type === 'ThisExpression') return 'this'
        if (n.type === 'MemberExpression') {
          const o = nameOf(n.object)
          const pr = n.computed ? '' : nameOf(n.property)
          return o && pr ? `${o}.${pr}` : o || pr
        }
        return ''
      }
      const target = nameOf(callee)
      if (!target || target.startsWith('console.')) return

      const fp = p.getFunctionParent()
      let from = fileKey
      if (fp) {
        from = keyFunction(fp)
        if (!seen.has(from)) {
          declareFunction(
            from,
            from.split(':').pop()!,
            fp.node.loc?.start?.line,
          )
        }
      }
      addEdge({ fromKey: from, toName: target, type: 'calls' })
    },
  })
  return { file: rel, status: 'ok', metrics, nodes, edges, size }
}

function emptyMetrics(code: string): FileMetrics {
  return {
    loc: code.split('\n').length,
    complexity: 1,
    imports: [], requires: [], exports: [], classes: [], functions: [],
    hasTryCatch: false, hasThrow: false, hasAwait: false, hasProcessEnv: false,
    hasConsoleLog: false, hasConsoleError: false, hasSilentCatch: false,
    hasExternalCall: false, hasDecorator: false,
  };
}