import { graphEdgeKey, type ProductionGraphEdge } from './edge.js';
import { compareCausalPaths, serializeCausalPath, type CausalPath } from './risk.js';

export { compareCausalPaths, serializeCausalPath };

export function causalEdgeId(edge: ProductionGraphEdge): string {
  return graphEdgeKey(edge);
}

export function concatCausalPaths(prefix: CausalPath, suffix: CausalPath): CausalPath {
  return {
    nodeIds: Object.freeze([...prefix.nodeIds, ...suffix.nodeIds.slice(1)]),
    edgeIds: Object.freeze([...prefix.edgeIds, ...suffix.edgeIds]),
  };
}

export function trivialCausalPath(nodeId: string): CausalPath {
  return {
    nodeIds: Object.freeze([nodeId]),
    edgeIds: Object.freeze([]),
  };
}
