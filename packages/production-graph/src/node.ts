export const GRAPH_NODE_TYPES = [
  'EVIDENCE',
  'RESOURCE',
  'PERSON',
  'ACTIVITY',
  'GATE',
  'DELIVERABLE',
  'DECISION',
  'LOCATION',
] as const;

export type GraphNodeType = (typeof GRAPH_NODE_TYPES)[number];

export interface ProductionGraphNode {
  readonly id: string;
  readonly type: GraphNodeType;
}

export function isGraphNodeType(value: unknown): value is GraphNodeType {
  return typeof value === 'string' && (GRAPH_NODE_TYPES as readonly string[]).includes(value);
}

export function createGraphNode(id: string, type: GraphNodeType): ProductionGraphNode {
  return Object.freeze({ id, type });
}
