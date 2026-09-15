import { parseOperationalScope, type ResolvedEvidenceSet } from '@sceneready/evidence';
import {
  GRAPH_SCHEMA_VERSION as PACK_GRAPH_SCHEMA_VERSION,
  type ProductionActivationManifest,
  type ProductionPack,
} from '@sceneready/production-pack';

import {
  createGraphEdge,
  graphEdgeKey,
  type GraphEdgeType,
  type ProductionGraphEdge,
} from './edge.js';
import { createProductionGraph, type ProductionGraph } from './graph.js';
import { createGraphNode, type GraphNodeType, type ProductionGraphNode } from './node.js';

export interface CompileProductionGraphInput {
  readonly pack: ProductionPack;
  readonly activation: ProductionActivationManifest;
  readonly evidence: ResolvedEvidenceSet;
}

function addUniqueNode(
  nodes: Map<string, ProductionGraphNode>,
  id: string,
  type: GraphNodeType,
): void {
  if (nodes.has(id)) {
    throw new Error(`canonical JSON rejected: duplicate node id '${id}'`);
  }
  nodes.set(id, createGraphNode(id, type));
}

function ensureNode(
  nodes: Map<string, ProductionGraphNode>,
  id: string,
  type: GraphNodeType,
): void {
  const existing = nodes.get(id);
  if (existing === undefined) {
    nodes.set(id, createGraphNode(id, type));
    return;
  }
  if (existing.type !== type) {
    throw new Error(`canonical JSON rejected: duplicate node id '${id}'`);
  }
}

function addEdge(
  edges: Map<string, ProductionGraphEdge>,
  from: string,
  to: string,
  type: GraphEdgeType,
): void {
  const edge = createGraphEdge(from, to, type);
  edges.set(graphEdgeKey(edge), edge);
}

function assertActivation(pack: ProductionPack, activation: ProductionActivationManifest): void {
  if (activation.productionId !== pack.production.id) {
    throw new Error('canonical JSON rejected: mixed productionIds');
  }
  if (activation.fixtureVersion !== pack.fixtureVersion) {
    throw new Error('canonical JSON rejected: fixtureVersion mismatch');
  }
  if (activation.policyVersion !== pack.policyVersion) {
    throw new Error('canonical JSON rejected: policyVersion mismatch');
  }
  if (activation.graphSchemaVersion !== PACK_GRAPH_SCHEMA_VERSION) {
    throw new Error('canonical JSON rejected: unsupported graph schema version');
  }
}

function assertEvidenceProduction(pack: ProductionPack, evidence: ResolvedEvidenceSet): void {
  for (const item of [...evidence.active, ...evidence.superseded]) {
    if (item.envelope.productionId !== pack.production.id) {
      throw new Error('canonical JSON rejected: mixed productionIds');
    }
  }
  for (const conflict of evidence.conflicts) {
    if (conflict.productionId !== pack.production.id) {
      throw new Error('canonical JSON rejected: mixed productionIds');
    }
  }
}

function conflictedEvidenceIds(evidence: ResolvedEvidenceSet): Set<string> {
  const ids = new Set<string>();
  for (const conflict of evidence.conflicts) {
    for (const evidenceId of conflict.evidenceIds) {
      ids.add(evidenceId);
    }
  }
  return ids;
}

function packEvidenceSubject(pack: ProductionPack, evidenceId: string): string | undefined {
  return pack.evidence.find((item) => item.id === evidenceId)?.subjectId;
}

function resolvedEvidenceTarget(
  pack: ProductionPack,
  evidenceId: string,
  scope: string,
): string | undefined {
  const fromPack = packEvidenceSubject(pack, evidenceId);
  if (fromPack !== undefined) {
    return fromPack;
  }
  return parseOperationalScope(scope)?.subjectId;
}

export function compileProductionGraph(input: CompileProductionGraphInput): ProductionGraph {
  const { pack, activation, evidence } = input;
  assertActivation(pack, activation);
  assertEvidenceProduction(pack, evidence);

  const nodes = new Map<string, ProductionGraphNode>();
  const edges = new Map<string, ProductionGraphEdge>();

  for (const person of pack.crew) {
    addUniqueNode(nodes, person.id, 'PERSON');
  }
  for (const location of pack.locations) {
    addUniqueNode(nodes, location.id, 'LOCATION');
  }
  for (const activity of pack.schedule) {
    addUniqueNode(nodes, activity.id, 'ACTIVITY');
  }
  for (const deliverable of pack.deliverables) {
    addUniqueNode(nodes, deliverable.id, 'DELIVERABLE');
  }
  for (const asset of pack.equipment) {
    addUniqueNode(nodes, asset.id, 'RESOURCE');
  }
  for (const path of pack.capturePaths) {
    addUniqueNode(nodes, path.id, 'RESOURCE');
  }
  for (const document of pack.rights) {
    addUniqueNode(nodes, document.id, 'RESOURCE');
  }
  for (const gate of pack.hardGates) {
    addUniqueNode(nodes, gate.id, 'GATE');
  }
  for (const reference of pack.evidence) {
    addUniqueNode(nodes, reference.id, 'EVIDENCE');
  }

  for (const item of [...evidence.active, ...evidence.superseded]) {
    ensureNode(nodes, item.envelope.evidenceId, 'EVIDENCE');
  }
  for (const conflict of evidence.conflicts) {
    for (const evidenceId of conflict.evidenceIds) {
      ensureNode(nodes, evidenceId, 'EVIDENCE');
    }
  }

  for (const activity of pack.schedule) {
    addEdge(edges, activity.id, activity.locationId, 'REQUIRES');
    for (const personId of activity.assignedPersonIds) {
      addEdge(edges, activity.id, personId, 'REQUIRES');
    }
    for (const equipmentId of activity.equipmentIds) {
      addEdge(edges, activity.id, equipmentId, 'REQUIRES');
    }
    for (const documentId of activity.documentIds) {
      addEdge(edges, activity.id, documentId, 'REQUIRES');
    }
    for (const predecessorId of activity.dependsOn) {
      addEdge(edges, predecessorId, activity.id, 'SCHEDULED_BEFORE');
    }
  }

  for (const deliverable of pack.deliverables) {
    for (const activityId of deliverable.requiredActivityIds) {
      addEdge(edges, deliverable.id, activityId, 'REQUIRES');
    }
    for (const personId of deliverable.requiredPersonIds) {
      addEdge(edges, deliverable.id, personId, 'REQUIRES');
    }
    for (const locationId of deliverable.requiredLocationIds) {
      addEdge(edges, deliverable.id, locationId, 'REQUIRES');
    }
    for (const equipmentId of deliverable.requiredEquipmentIds) {
      addEdge(edges, deliverable.id, equipmentId, 'REQUIRES');
    }
    for (const documentId of deliverable.requiredDocumentIds) {
      addEdge(edges, deliverable.id, documentId, 'REQUIRES');
      addEdge(edges, documentId, deliverable.id, 'BLOCKS');
    }
  }

  for (const document of pack.rights) {
    for (const deliverableId of document.coversDeliverableIds) {
      addEdge(edges, document.id, deliverableId, 'BLOCKS');
    }
    for (const personId of document.personIds) {
      addEdge(edges, document.id, personId, 'REQUIRES');
    }
    for (const locationId of document.locationIds) {
      addEdge(edges, document.id, locationId, 'REQUIRES');
    }
  }

  for (const path of pack.capturePaths) {
    for (const equipmentId of path.primaryEquipmentIds) {
      addEdge(edges, path.id, equipmentId, 'REQUIRES');
    }
    for (const equipmentId of path.backupEquipmentIds) {
      addEdge(edges, path.id, equipmentId, 'REQUIRES');
    }
    const paired = Math.min(path.primaryEquipmentIds.length, path.backupEquipmentIds.length);
    for (let index = 0; index < paired; index += 1) {
      const primary = path.primaryEquipmentIds[index];
      const backup = path.backupEquipmentIds[index];
      if (primary === undefined || backup === undefined) {
        continue;
      }
      addEdge(edges, backup, primary, 'FALLBACK_FOR');
    }
  }

  for (const asset of pack.equipment) {
    if (asset.operationalState !== 'DEGRADED' && asset.operationalState !== 'FAILED') {
      continue;
    }
    for (const path of pack.capturePaths) {
      if (
        path.primaryEquipmentIds.includes(asset.id) ||
        path.backupEquipmentIds.includes(asset.id)
      ) {
        addEdge(edges, asset.id, path.id, 'DEGRADES');
      }
    }
  }

  for (const gate of pack.hardGates) {
    for (const subjectId of gate.subjectIds) {
      addEdge(edges, gate.id, subjectId, 'REQUIRES');
    }
  }

  const withheld = conflictedEvidenceIds(evidence);
  for (const item of evidence.active) {
    if (withheld.has(item.envelope.evidenceId)) {
      continue;
    }
    const targetId = resolvedEvidenceTarget(pack, item.envelope.evidenceId, item.scope);
    if (targetId === undefined || !nodes.has(targetId)) {
      continue;
    }
    addEdge(edges, item.envelope.evidenceId, targetId, 'AFFECTS');
  }

  return createProductionGraph({
    productionId: pack.production.id,
    policyVersion: pack.policyVersion,
    fixtureVersion: pack.fixtureVersion,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  });
}
