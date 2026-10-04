#!/usr/bin/env node
import { App } from 'aws-cdk-lib';

import { AWS_REGION, readSceneReadyAwsConfig } from '../src/config.js';
import { AgentStack } from '../lib/stacks/agent-stack.js';
import { DataStack } from '../lib/stacks/data-stack.js';
import { IdentityStack } from '../lib/stacks/identity-stack.js';

const app = new App();
const requested = app.node.tryGetContext('environment');
const environment = readSceneReadyAwsConfig(typeof requested === 'string' ? requested : 'DEV');
const data = new DataStack(app, `SceneReady${environment.environment}Data`, {
  environment: environment.environment,
  env: { region: AWS_REGION },
  description: 'SceneReady encrypted operational state, ledger, outbox, and evidence.',
});
const identity = new IdentityStack(app, `SceneReady${environment.environment}Identity`, {
  environment: environment.environment,
  env: { region: AWS_REGION },
  description: 'SceneReady Cognito identity, machine client, and PKCE user client.',
});
new AgentStack(app, `SceneReady${environment.environment}Agent`, {
  environment: environment.environment,
  env: { region: AWS_REGION },
  description: 'SceneReady AgentCore MCP runtime.',
  userPool: identity.userPool,
  machineClient: identity.machineClient,
  userClient: identity.userClient,
  operationalTable: data.operationalTable,
  ledgerTable: data.ledgerTable,
  evidenceBucket: data.evidenceBucket,
});
