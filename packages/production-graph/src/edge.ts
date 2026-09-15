export const GRAPH_EDGE_TYPES = [
  'REQUIRES',
  'BLOCKS',
  'AFFECTS',
  'DEGRADES',
  'SCHEDULED_BEFORE',
  'FALLBACK_FOR',
] as const;

export type GraphEdgeType = (typeof GRAPH_EDGE_TYPES)[number];

export interface ProductionGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly type: GraphEdgeType;
}

export function isGraphEdgeType(value: unknown): value is GraphEdgeType {
  return typeof value === 'string' && (GRAPH_EDGE_TYPES as readonly string[]).includes(value);
}

export function createGraphEdge(
  from: string,
  to: string,
  type: GraphEdgeType,
): ProductionGraphEdge {
  return Object.freeze({ from, to, type });
}

export function graphEdgeKey(edge: ProductionGraphEdge): string {
  return `${edge.from}\u0000${edge.type}\u0000${edge.to}`;
}
