// // import traverse from "@babel/traverse"
// import traverse, * as traverseModule from '@babel/traverse'
// import { parse } from '@babel/parser'
// import { FileAnalysis } from "../types/file-analysis.types.js"

//  export function analyzeSource (relativePath: string, code: string): FileAnalysis {
//     const metrics = this.createEmptyMetrics(code)
//     let ast
//     try {
//       ast = parse(code, {
//         sourceType: 'unambiguous',
//         plugins: ['typescript', 'jsx', 'decorators-legacy'],
//         errorRecovery: true,
//       })
//     } catch (error) {
//       return {
//         file: relativePath,
//         status: 'parse_error',
//         error: error instanceof Error ? error.message : String(error),
//       }
//     }
//     try {
//       traverse(ast, {
//         importDeclaration: (nodePath: any) => {
//           metrics.imports.push(String(nodePath.node.source.value))
//         },
//         ClassDeclaration: (nodePath: any) => {
//           if (nodePath.node.id?.name) {
//             metrics.classes.push(nodePath.node.id.name)
//           }
//           if (nodePath.node.decorators?.length) {
//             metrics.hasDecorator = true
//           }
//         },
//         ClassMethod: (nodePath: any) => {
//           const name = nodePath.node.key?.name ?? nodePath.node.key?.value
//           if (name) {
//             metrics.functions.push(`${nodePath.node.kind}:${name}`)
//           }
//           if (nodePath.node.decorators?.length) {
//             metrics.hasDecorator = true
//           }
//         },
//         FunctionDeclaration: (nodePath: any) => {
//           if (nodePath.node.id?.name) {
//             metrics.functions.push(nodePath.node.id.name)
//           }
//         },
//         IfStatement: () => {
//           metrics.complexity++
//         },

//         ForStatement: () => {
//           metrics.complexity++
//         },

//         ForInStatement: () => {
//           metrics.complexity++
//         },
//         ForOfStatement: () => {
//           metrics.complexity++
//         },

//         WhileStatement: () => {
//           metrics.complexity++
//         },

//         DoWhileStatement: () => {
//           metrics.complexity++
//         },
//         SwitchCase: (nodePath: any) => {
//           if (nodePath.node.test) {
//             metrics.complexity++
//           }
//         },

//         ConditionalExpression: () => {
//           metrics.complexity++
//         },

//         LogicalExpression: (nodePath: any) => {
//           if (['&&', '||', '??'].includes(nodePath.node.operator)) {
//             metrics.complexity++
//           }
//         },

//         TryStatement: () => {
//           metrics.hasTryCatch = true
//         },

//         CatchClause: () => {
//           metrics.hasTryCatch = true
//           metrics.complexity++
//         },
//         CallExpression: (nodePath: any) => {
//           const callee = nodePath.node.callee

//           if (callee.type === 'Identifier' && callee.name === 'console') {
//             return
//           }

//           if (callee.type === 'Identifier' && callee.name === 'fetch') {
//             metrics.hasExternalCall = true
//           }

//           if (
//             callee.type === 'MemberExpression' &&
//             callee.object.type === 'Identifier' &&
//             callee.object.name === 'console'
//           ) {
//             metrics.hasConsoleLog = true
//           }
//           if (callee.type === 'MemberExpression') {
//             const property = callee.property?.name ?? callee.property?.value

//             const objectName = this.getNodeName(callee.object)

//             const httpMethods = ['get', 'post', 'put', 'patch', 'delete']

//             const looksLikeHttpCall =
//               httpMethods.includes(property) &&
//               /axios|http|request|fetch/i.test(objectName)

//             if (looksLikeHttpCall) {
//               metrics.hasExternalCall = true
//             }
//           }
//         },
//       })
//     } catch (error) {
//       return {
//         file: relativePath,
//         status: 'traverse_error',
//         error: error instanceof Error ? error.message : String(error),
//       }
//     }

//     return {
//       file: relativePath,
//       status: 'ok',
//       metrics,
//     }
//   }