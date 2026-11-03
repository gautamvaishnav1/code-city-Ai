import { Injectable } from '@nestjs/common';
import * as path from 'node:path';
import {
  FileGraphAnalysis,
  GraphEdgeDraft,
  GraphNodeDraft,
  
} from './types/graph.types.js';
import { ResolvedGraph } from './types/file-analysis.types.js';

@Injectable()
export class GraphBuilderService {
  build(fileResults: FileGraphAnalysis[]): ResolvedGraph {
    const nodeMap = new Map<string, GraphNodeDraft>();
    const rawEdges: GraphEdgeDraft[] = [];

    for (const result of fileResults) {
      for (const node of result.nodes) {
        nodeMap.set(node.key, node);
      }

      for (const edge of result.edges) {
        rawEdges.push(edge);
      }
    }

    const fileNodeByPath = new Map<string, string>();
    const functionKeysByShortName = new Map<string, string[]>();
    const methodKeysByShortName = new Map<string, string[]>();
    const methodKeysByClassMethod = new Map<string, string[]>();

    for (const node of nodeMap.values()) {
      if (node.type === 'file' && node.path) {
        fileNodeByPath.set(node.path, node.key);
      }

      if (node.type === 'function') {
        this.pushMap(functionKeysByShortName, node.name, node.key);
      }

      if (node.type === 'method') {
        this.pushMap(methodKeysByShortName, node.name, node.key);

        const classMethod = node.qualifiedName?.split(':').pop();

        if (classMethod) {
          this.pushMap(methodKeysByClassMethod, classMethod, node.key);
        }
      }
    }

    const resolvedEdges: GraphEdgeDraft[] = [];

    for (const edge of rawEdges) {
      if (edge.type === 'imports' || edge.type === 'requires') {
        resolvedEdges.push(
          ...this.resolveImportEdge(edge, nodeMap, fileNodeByPath),
        );
        continue;
      }

      if (edge.type === 'calls') {
        resolvedEdges.push(
          this.resolveCallEdge(
            edge,
            nodeMap,
            functionKeysByShortName,
            methodKeysByShortName,
            methodKeysByClassMethod,
          ),
        );
        continue;
      }

      resolvedEdges.push(edge);
    }

    const dedupedEdges = new Map<string, GraphEdgeDraft>();

    for (const edge of resolvedEdges) {
      if (!edge.toKey) {
        continue;
      }

      const key = `${edge.fromKey}|${edge.toKey}|${edge.type}`;
      const existing = dedupedEdges.get(key);

      if (existing) {
        existing.weight = (existing.weight || 1) + 1;
      } else {
        dedupedEdges.set(key, {
          ...edge,
          weight: edge.weight || 1,
        });
      }
    }

    return {
      nodes: Array.from(nodeMap.values()),
      edges: Array.from(dedupedEdges.values()),
    };
  }

  private resolveImportEdge(
    edge: GraphEdgeDraft,
    nodeMap: Map<string, GraphNodeDraft>,
    fileNodeByPath: Map<string, string>,
  ): GraphEdgeDraft[] {
    const specifier = edge.meta?.specifier || edge.toName;

    if (!specifier) {
      return [];
    }

    const isRelative = Boolean(edge.meta?.relative);

    if (!isRelative) {
      const packageKey = `package:${specifier}`;

      if (!nodeMap.has(packageKey)) {
        nodeMap.set(packageKey, {
          key: packageKey,
          type: 'external_package',
          name: specifier,
        });
      }

      return [
        {
          ...edge,
          toKey: packageKey,
          resolved: true,
        },
      ];
    }

    const fromPath = this.getPathFromFileNodeKey(edge.fromKey);

    if (!fromPath) {
      return [
        {
          ...edge,
          toKey: this.createUnresolvedNode(nodeMap, specifier),
          resolved: false,
        },
      ];
    }

    const candidates = this.resolveRelativeCandidates(fromPath, specifier);

    for (const candidate of candidates) {
      const fileKey = fileNodeByPath.get(candidate);

      if (fileKey) {
        return [
          {
            ...edge,
            toKey: fileKey,
            resolved: true,
          },
        ];
      }
    }

    return [
      {
        ...edge,
        toKey: this.createUnresolvedNode(nodeMap, `${fromPath}?import=${specifier}`),
        resolved: false,
      },
    ];
  }

  private resolveCallEdge(
    edge: GraphEdgeDraft,
    nodeMap: Map<string, GraphNodeDraft>,
    functionKeysByShortName: Map<string, string[]>,
    methodKeysByShortName: Map<string, string[]>,
    methodKeysByClassMethod: Map<string, string[]>,
  ): GraphEdgeDraft {
    const targetName = edge.toName;

    if (!targetName) {
      return {
        ...edge,
        type: 'unresolved_calls',
        toKey: this.createUnresolvedNode(nodeMap, 'empty_call'),
        resolved: false,
      };
    }

    if (targetName.includes('.')) {
      const classMethod = targetName.split('.').slice(-2).join('.');
      const classMethodCandidates = methodKeysByClassMethod.get(classMethod);

      if (classMethodCandidates && classMethodCandidates.length === 1) {
        return {
          ...edge,
          toKey: classMethodCandidates[0],
          resolved: true,
        };
      }
    }

    const shortName = targetName.includes('.')
      ? targetName.split('.').pop() || targetName
      : targetName;

    const functionCandidates = functionKeysByShortName.get(shortName);

    if (functionCandidates && functionCandidates.length === 1) {
      return {
        ...edge,
        toKey: functionCandidates[0],
        resolved: true,
      };
    }

    const methodCandidates = methodKeysByShortName.get(shortName);

    if (methodCandidates && methodCandidates.length === 1) {
      return {
        ...edge,
        toKey: methodCandidates[0],
        resolved: true,
      };
    }

    return {
      ...edge,
      type: 'unresolved_calls',
      toKey: this.createUnresolvedNode(nodeMap, targetName),
      resolved: false,
    };
  }

  private createUnresolvedNode(
    nodeMap: Map<string, GraphNodeDraft>,
    name: string,
  ): string {
    const key = `unresolved:${name}`;

    if (!nodeMap.has(key)) {
      nodeMap.set(key, {
        key,
        type: 'unresolved',
        name,
      });
    }

    return key;
  }

  private getPathFromFileNodeKey(key: string): string | null {
    if (!key.startsWith('file:')) {
      return null;
    }

    return key.replace('file:', '');
  }

  private resolveRelativeCandidates(
    fromPath: string,
    specifier: string,
  ): string[] {
    const base = path.posix.join(path.posix.dirname(fromPath), specifier);

    const extensions = ['', '.ts', '.tsx', '.js', '.jsx'];
    const candidates: string[] = [];

    for (const ext of extensions) {
      candidates.push(`${base}${ext}`);
    }

    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
      candidates.push(path.posix.join(base, `index${ext}`));
    }

    return candidates;
  }

  private pushMap(
    map: Map<string, string[]>,
    key: string,
    value: string,
  ) {
    const current = map.get(key) || [];

    if (!current.includes(value)) {
      current.push(value);
    }

    map.set(key, current);
  }
}