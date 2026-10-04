import { RemovalPolicy, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import {
  AccountRecovery,
  OAuthScope,
  ResourceServerScope,
  UserPool,
  type UserPoolClient,
} from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

import { PROJECT_TAG, type DeploymentEnvironment } from '../../src/config.js';

export const OAUTH_SCOPE_NAMES = [
  'service',
  'production.read',
  'replay.approve',
  'live.approve',
] as const;

export const OAUTH_RESOURCE_SERVER = 'sceneready';

const SCOPE_DESCRIPTIONS: Readonly<Record<(typeof OAUTH_SCOPE_NAMES)[number], string>> = {
  service: 'Call SceneReady service tools',
  'production.read': 'Read one production',
  'replay.approve': 'Approve a replay-scoped revision',
  'live.approve': 'Approve a live-scoped revision',
};

export interface IdentityStackProps extends StackProps {
  readonly environment: DeploymentEnvironment;
}

export class IdentityStack extends Stack {
  readonly userPool: UserPool;
  readonly machineClient: UserPoolClient;
  readonly userClient: UserPoolClient;

  constructor(scope: Construct, id: string, props: IdentityStackProps) {
    super(scope, id, props);
    const removalPolicy =
      props.environment === 'COMPETITION' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    this.userPool = new UserPool(this, 'Users', {
      selfSignUpEnabled: false,
      signInAliases: { username: true },
      passwordPolicy: { minLength: 12 },
      accountRecovery: AccountRecovery.NONE,
      removalPolicy,
    });
    const scopes = OAUTH_SCOPE_NAMES.map(
      (scopeName) =>
        new ResourceServerScope({
          scopeName,
          scopeDescription: SCOPE_DESCRIPTIONS[scopeName],
        }),
    );
    const resourceServer = this.userPool.addResourceServer('SceneReadyResource', {
      identifier: OAUTH_RESOURCE_SERVER,
      scopes,
    });
    const oauthScopes = scopes.map((scope) => OAuthScope.resourceServer(resourceServer, scope));
    this.machineClient = this.userPool.addClient('MachineClient', {
      generateSecret: true,
      oAuth: {
        flows: { clientCredentials: true },
        scopes: oauthScopes,
      },
    });
    this.userClient = this.userPool.addClient('UserClient', {
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: oauthScopes,
        callbackUrls: ['https://example.com/oauth/callback'],
        logoutUrls: ['https://example.com/oauth/logout'],
      },
      authFlows: { userPassword: false, userSrp: false, adminUserPassword: false },
    });
    this.userPool.addDomain('HostedDomain', {
      cognitoDomain: { domainPrefix: `sceneready-${props.environment.toLowerCase()}-oauth` },
    });
    Tags.of(this).add('Project', PROJECT_TAG);
    Tags.of(this).add('sceneready:environment', props.environment);
  }
}
