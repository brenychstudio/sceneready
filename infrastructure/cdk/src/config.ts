export const AWS_REGION = 'eu-west-1' as const;

export const CANONICAL_MODEL_ID = 'eu.anthropic.claude-sonnet-5' as const;

export const PROJECT_TAG = 'SceneReady' as const;

export const DEPLOYMENT_ENVIRONMENTS = ['DEV', 'STAGING', 'COMPETITION'] as const;

export type DeploymentEnvironment = (typeof DEPLOYMENT_ENVIRONMENTS)[number];

export interface SceneReadyAwsConfig {
  readonly region: typeof AWS_REGION;
  readonly canonicalModelId: typeof CANONICAL_MODEL_ID;
  readonly projectTag: typeof PROJECT_TAG;
  readonly environment: DeploymentEnvironment;
}

export class PinnedModelError extends Error {
  readonly code = 'PINNED_BEDROCK_MODEL_UNAVAILABLE_OR_CHANGED' as const;

  constructor(requestedModelId: string) {
    super(`competition runtime rejected model substitution for ${requestedModelId}`);
    this.name = 'PinnedModelError';
  }
}

export function isDeploymentEnvironment(value: string): value is DeploymentEnvironment {
  return (DEPLOYMENT_ENVIRONMENTS as readonly string[]).includes(value);
}

export function assertNoModelSubstitution(requestedModelId: string): void {
  if (requestedModelId !== CANONICAL_MODEL_ID) {
    throw new PinnedModelError(requestedModelId);
  }
}

export function readSceneReadyAwsConfig(environment: string): SceneReadyAwsConfig {
  if (!isDeploymentEnvironment(environment)) {
    throw new Error(`unsupported SceneReady environment: ${environment}`);
  }
  return Object.freeze({
    region: AWS_REGION,
    canonicalModelId: CANONICAL_MODEL_ID,
    projectTag: PROJECT_TAG,
    environment,
  });
}

export function competitionConfig(
  requestedModelId: string = CANONICAL_MODEL_ID,
): SceneReadyAwsConfig {
  assertNoModelSubstitution(requestedModelId);
  return readSceneReadyAwsConfig('COMPETITION');
}
