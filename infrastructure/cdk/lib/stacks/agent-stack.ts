import { ArnFormat, Duration, RemovalPolicy, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import {
  AgentRuntimeArtifact,
  ProtocolType,
  Runtime,
  RuntimeAuthorizerConfiguration,
  type RuntimeEndpoint,
} from 'aws-cdk-lib/aws-bedrockagentcore';
import type { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import type { Bucket } from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

import {
  AWS_REGION,
  CANONICAL_MODEL_ID,
  PROJECT_TAG,
  type DeploymentEnvironment,
} from '../../src/config.js';
import { OAUTH_RESOURCE_SERVER, OAUTH_SCOPE_NAMES } from './identity-stack.js';

const OAUTH_SCOPES = OAUTH_SCOPE_NAMES.map((scopeName) => `${OAUTH_RESOURCE_SERVER}/${scopeName}`);

export interface AgentStackProps extends StackProps {
  readonly environment: DeploymentEnvironment;
  readonly userPool: IUserPool;
  readonly machineClient: IUserPoolClient;
  readonly userClient: IUserPoolClient;
  readonly operationalTable: Table;
  readonly ledgerTable: Table;
  readonly evidenceBucket: Bucket;
}

export class AgentStack extends Stack {
  readonly repository: Repository;
  readonly runtime: Runtime;
  readonly endpoint: RuntimeEndpoint;

  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);
    const retain = props.environment === 'COMPETITION';
    const runtimeName = `SceneReady${props.environment}Mcp`;
    this.repository = new Repository(this, 'McpRepository', {
      repositoryName: `sceneready-${props.environment.toLowerCase()}-mcp`,
      imageScanOnPush: true,
      removalPolicy: retain ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      emptyOnDelete: !retain,
    });
    const role = new Role(this, 'RuntimeRole', {
      assumedBy: new ServicePrincipal('bedrock-agentcore.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': Stack.of(this).account },
          ArnLike: {
            'aws:SourceArn': Stack.of(this).formatArn({
              service: 'bedrock-agentcore',
              resource: 'runtime',
              resourceName: `${runtimeName}*`,
              arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
            }),
          },
        },
      }),
      description: 'SceneReady AgentCore runtime read and model invocation',
      maxSessionDuration: Duration.hours(8),
    });
    props.operationalTable.grantReadData(role);
    props.ledgerTable.grantReadData(role);
    props.evidenceBucket.grantRead(role);
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
          'bedrock:Converse',
          'bedrock:ConverseStream',
        ],
        resources: [
          Stack.of(this).formatArn({
            service: 'bedrock',
            resource: 'inference-profile',
            resourceName: CANONICAL_MODEL_ID,
            arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
          }),
          `arn:${Stack.of(this).partition}:bedrock:${AWS_REGION}::foundation-model/anthropic.claude-sonnet-5`,
        ],
      }),
    );
    this.runtime = new Runtime(this, 'McpRuntime', {
      runtimeName,
      description: 'SceneReady MCP runtime',
      executionRole: role,
      agentRuntimeArtifact: AgentRuntimeArtifact.fromEcrRepository(this.repository, 'local'),
      protocolConfiguration: ProtocolType.MCP,
      authorizerConfiguration: RuntimeAuthorizerConfiguration.usingCognito(
        props.userPool,
        [props.machineClient, props.userClient],
        undefined,
        [...OAUTH_SCOPES],
      ),
      requestHeaderConfiguration: { allowlistedHeaders: ['Mcp-Session-Id'] },
      environmentVariables: {
        AWS_REGION,
        SCENEREADY_MODEL_ID: CANONICAL_MODEL_ID,
      },
    });
    this.endpoint = this.runtime.addEndpoint(`SceneReady${props.environment}McpEndpoint`, {
      description: 'SceneReady MCP endpoint',
    });
    Tags.of(this).add('Project', PROJECT_TAG);
    Tags.of(this).add('sceneready:environment', props.environment);
  }
}
