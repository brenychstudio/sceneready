import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { IdentityStack } from './identity-stack.js';

function templateFor(environment: 'DEV' | 'COMPETITION'): Template {
  const app = new App();
  return Template.fromStack(new IdentityStack(app, 'Identity', { environment }));
}

describe('identity stack', () => {
  it('defines the four SceneReady scopes, a confidential machine client, and a PKCE user client', () => {
    const template = templateFor('DEV');
    template.resourceCountIs('AWS::Cognito::UserPoolResourceServer', 1);
    template.hasResourceProperties('AWS::Cognito::UserPoolResourceServer', {
      Identifier: 'sceneready',
      Scopes: Match.arrayWith([
        Match.objectLike({ ScopeName: 'service' }),
        Match.objectLike({ ScopeName: 'production.read' }),
        Match.objectLike({ ScopeName: 'replay.approve' }),
        Match.objectLike({ ScopeName: 'live.approve' }),
      ]),
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: true,
      AllowedOAuthFlows: ['client_credentials'],
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AllowedOAuthFlows: ['code'],
      CallbackURLs: ['https://example.com/oauth/callback'],
    });
    const json = JSON.stringify(template.toJSON());
    for (const scope of ['/service', '/production.read', '/replay.approve', '/live.approve']) {
      expect(json).toContain(scope);
    }
    expect(json).not.toContain('localStorage');
    expect(json).not.toMatch(/ClientSecret"\s*:\s*"[^$]/);
  }, 30_000);
});
