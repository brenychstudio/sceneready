import { fingerprintProductionPack } from '@sceneready/production-pack';

import { graphEdgeKey, type ProductionGraphEdge } from './edge.js';
import type { ProductionGraphNode } from './node.js';

export const GRAPH_SCHEMA_VERSION = 'SR-GRAPH-v1';
export const GRAPH_REVISION = 1;
export const PRODUCTION_REVISION = 1;

export interface ProductionGraph {
  readonly schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  readonly productionId: string;
  readonly productionRevision: typeof PRODUCTION_REVISION;
  readonly graphRevision: typeof GRAPH_REVISION;
  readonly policyVersion: string;
  readonly fixtureVersion: string;
  readonly nodes: readonly ProductionGraphNode[];
  readonly edges: readonly ProductionGraphEdge[];
  readonly fingerprint: string;
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function compareGraphNodeOrder(
  left: ProductionGraphNode,
  right: ProductionGraphNode,
): number {
  return compareOrdinal(left.id, right.id);
}

export function compareGraphEdgeOrder(
  left: ProductionGraphEdge,
  right: ProductionGraphEdge,
): number {
  const fromOrder = compareOrdinal(left.from, right.from);
  if (fromOrder !== 0) {
    return fromOrder;
  }
  const typeOrder = compareOrdinal(left.type, right.type);
  if (typeOrder !== 0) {
    return typeOrder;
  }
  return compareOrdinal(left.to, right.to);
}

function assertGraphIntegrity(
  nodes: readonly ProductionGraphNode[],
  edges: readonly ProductionGraphEdge[],
): void {
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(`canonical JSON rejected: duplicate node id '${node.id}'`);
    }
    nodeIds.add(node.id);
  }

  const edgeKeys = new Set<string>();
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error(
        `canonical JSON rejected: dangling edge ${edge.from} -${edge.type}-> ${edge.to}`,
      );
    }
    const key = graphEdgeKey(edge);
    if (edgeKeys.has(key)) {
      throw new Error(
        `canonical JSON rejected: duplicate edge ${edge.from} -${edge.type}-> ${edge.to}`,
      );
    }
    edgeKeys.add(key);
  }
}

export function createProductionGraph(input: {
  readonly productionId: string;
  readonly policyVersion: string;
  readonly fixtureVersion: string;
  readonly nodes: readonly ProductionGraphNode[];
  readonly edges: readonly ProductionGraphEdge[];
}): ProductionGraph {
  const nodes = Object.freeze([...input.nodes].sort(compareGraphNodeOrder));
  const edges = Object.freeze([...input.edges].sort(compareGraphEdgeOrder));
  assertGraphIntegrity(nodes, edges);

  const fingerprintSubject = {
    edges,
    fixtureVersion: input.fixtureVersion,
    graphRevision: GRAPH_REVISION,
    nodes,
    policyVersion: input.policyVersion,
    productionId: input.productionId,
    productionRevision: PRODUCTION_REVISION,
    schemaVersion: GRAPH_SCHEMA_VERSION,
  };

  return Object.freeze({
    schemaVersion: GRAPH_SCHEMA_VERSION,
    productionId: input.productionId,
    productionRevision: PRODUCTION_REVISION,
    graphRevision: GRAPH_REVISION,
    policyVersion: input.policyVersion,
    fixtureVersion: input.fixtureVersion,
    nodes,
    edges,
    fingerprint: fingerprintProductionPack(fingerprintSubject),
  });
}
