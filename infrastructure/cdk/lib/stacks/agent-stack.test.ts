import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { AgentStack } from './agent-stack.js';
import { DataStack } from './data-stack.js';
import { IdentityStack } from './identity-stack.js';

const FORBIDDEN_ACTIONS = [
  'dynamodb:PutItem',
  'dynamodb:UpdateItem',
  'dynamodb:DeleteItem',
  'dynamodb:TransactWriteItems',
  'dynamodb:BatchWriteItem',
  'sqs:SendMessage',
  'sqs:ReceiveMessage',
  'sqs:DeleteMessage',
  'kms:Sign',
  's3:PutObject',
  's3:DeleteObject',
] as const;

function templateFor(environment: 'DEV' | 'COMPETITION'): Template {
  const app = new App();
  const env = { region: 'eu-west-1' };
  const data = new DataStack(app, 'Data', { environment, env });
  const identity = new IdentityStack(app, 'Identity', { environment, env });
  return Template.fromStack(
    new AgentStack(app, 'Agent', {
      environment,
      env,
      userPool: identity.userPool,
      machineClient: identity.machineClient,
      userClient: identity.userClient,
      operationalTable: data.operationalTable,
      ledgerTable: data.ledgerTable,
      evidenceBucket: data.evidenceBucket,
    }),
  );
}

describe('agent stack', () => {
  it('defines an ECR image, an MCP runtime, and a read-only execution role', () => {
    const template = templateFor('DEV');
    template.resourceCountIs('AWS::ECR::Repository', 1);
    template.resourceCountIs('AWS::BedrockAgentCore::Runtime', 1);
    template.resourceCountIs('AWS::BedrockAgentCore::RuntimeEndpoint', 1);
    template.resourceCountIs('AWS::DynamoDB::Table', 0);
    template.resourceCountIs('AWS::SQS::Queue', 0);
    template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      ProtocolConfiguration: 'MCP',
      RequestHeaderConfiguration: { RequestHeaderAllowlist: ['Mcp-Session-Id'] },
    });
    const json = JSON.stringify(template.toJSON());
    for (const scope of [
      'sceneready/service',
      'sceneready/production.read',
      'sceneready/replay.approve',
      'sceneready/live.approve',
    ]) {
      expect(json).toContain(scope);
    }
    expect(json).toContain('openid-configuration');
    expect(json).toContain('dynamodb:GetItem');
    expect(json).toContain('bedrock:InvokeModel');
    expect(json).toContain('s3:GetObject');
    expect(json).toContain('eu.anthropic.claude-sonnet-5');
    for (const action of FORBIDDEN_ACTIONS) {
      expect(json).not.toContain(action);
    }
    expect(json).not.toMatch(/arn:aws:iam::\d{12}:/);
  }, 60_000);

  it('retains the image repository only for competition', () => {
    const competition = templateFor('COMPETITION');
    const dev = templateFor('DEV');
    expect(Object.values(competition.findResources('AWS::ECR::Repository'))[0]).toMatchObject({
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
    expect(Object.values(dev.findResources('AWS::ECR::Repository'))[0]).toMatchObject({
      DeletionPolicy: 'Delete',
      UpdateReplacePolicy: 'Delete',
    });
  }, 60_000);
});
