import type { ProductionGraphEdge } from './edge.js';
import { GRAPH_NODE_TYPES, type GraphNodeType, type ProductionGraphNode } from './node.js';
import type { ProductionGraph } from './graph.js';

export interface ProductionGraphIndexes {
  readonly nodesById: ReadonlyMap<string, ProductionGraphNode>;
  readonly nodesByType: ReadonlyMap<GraphNodeType, readonly ProductionGraphNode[]>;
  readonly outgoing: ReadonlyMap<string, readonly ProductionGraphEdge[]>;
  readonly incoming: ReadonlyMap<string, readonly ProductionGraphEdge[]>;
}

export function indexProductionGraph(graph: ProductionGraph): ProductionGraphIndexes {
  const nodesById = new Map<string, ProductionGraphNode>();
  for (const node of graph.nodes) {
    nodesById.set(node.id, node);
  }

  const nodesByType = new Map<GraphNodeType, ProductionGraphNode[]>();
  for (const type of GRAPH_NODE_TYPES) {
    nodesByType.set(type, []);
  }
  for (const node of graph.nodes) {
    const group = nodesByType.get(node.type);
    if (group === undefined) {
      continue;
    }
    group.push(node);
  }

  const outgoing = new Map<string, ProductionGraphEdge[]>();
  const incoming = new Map<string, ProductionGraphEdge[]>();
  for (const node of graph.nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }
  for (const edge of graph.edges) {
    outgoing.get(edge.from)?.push(edge);
    incoming.get(edge.to)?.push(edge);
  }

  const frozenByType = new Map<GraphNodeType, readonly ProductionGraphNode[]>();
  for (const type of GRAPH_NODE_TYPES) {
    frozenByType.set(type, Object.freeze([...(nodesByType.get(type) ?? [])]));
  }
  const frozenOutgoing = new Map<string, readonly ProductionGraphEdge[]>();
  const frozenIncoming = new Map<string, readonly ProductionGraphEdge[]>();
  for (const node of graph.nodes) {
    frozenOutgoing.set(node.id, Object.freeze([...(outgoing.get(node.id) ?? [])]));
    frozenIncoming.set(node.id, Object.freeze([...(incoming.get(node.id) ?? [])]));
  }

  return Object.freeze({
    nodesById,
    nodesByType: frozenByType,
    outgoing: frozenOutgoing,
    incoming: frozenIncoming,
  });
}
