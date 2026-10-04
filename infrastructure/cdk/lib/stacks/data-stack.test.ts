import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { operationalPartitionKey } from '../naming.js';
import { DataStack } from './data-stack.js';

function templateFor(environment: 'DEV' | 'STAGING' | 'COMPETITION'): Template {
  const app = new App();
  const stack = new DataStack(app, 'Data', { environment });
  return Template.fromStack(stack);
}

function resourcesWithTag(template: Template, type: string, resource: string): number {
  const found = template.findResources(type, {
    Properties: {
      Tags: Match.arrayWith([Match.objectLike({ Key: 'sceneready:resource', Value: resource })]),
    },
  });
  return Object.keys(found).length;
}

describe('operational key namespace', () => {
  it('begins with the account, production, and namespace segments', () => {
    expect(operationalPartitionKey('acct', 'prod', 'LIVE')).toBe('ACCOUNT#acct#PROD#prod#NS#LIVE');
    expect(() => operationalPartitionKey('acct#1', 'prod', 'LIVE')).toThrow(/separator/);
  });
});

describe('data stack', () => {
  it('defines three encrypted on-demand tables, two queues, and one evidence bucket', () => {
    const template = templateFor('DEV');
    expect(resourcesWithTag(template, 'AWS::DynamoDB::Table', 'operational')).toBe(1);
    expect(resourcesWithTag(template, 'AWS::DynamoDB::Table', 'ledger')).toBe(1);
    expect(resourcesWithTag(template, 'AWS::DynamoDB::Table', 'outbox')).toBe(1);
    template.resourceCountIs('AWS::DynamoDB::Table', 3);
    template.resourceCountIs('AWS::SQS::Queue', 2);
    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      SSESpecification: { SSEEnabled: true },
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      KeySchema: Match.arrayWith([
        Match.objectLike({ AttributeName: 'pk', KeyType: 'HASH' }),
        Match.objectLike({ AttributeName: 'sk', KeyType: 'RANGE' }),
      ]),
    });
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: Match.anyValue(),
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResourceProperties('AWS::SQS::Queue', {
      SqsManagedSseEnabled: true,
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 5 }),
    });
  }, 30_000);

  it('retains ledger and evidence in competition and destroys them in dev and staging', () => {
    const competition = templateFor('COMPETITION');
    const dev = templateFor('DEV');
    const staging = templateFor('STAGING');
    expect(resourcesWithTag(competition, 'AWS::DynamoDB::Table', 'ledger')).toBe(1);
    const competitionLedger = competition.findResources('AWS::DynamoDB::Table', {
      Properties: {
        Tags: Match.arrayWith([Match.objectLike({ Key: 'sceneready:resource', Value: 'ledger' })]),
      },
    });
    expect(Object.values(competitionLedger)[0]).toMatchObject({
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
    const competitionBucket = competition.findResources('AWS::S3::Bucket');
    expect(Object.values(competitionBucket)[0]).toMatchObject({
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
    for (const template of [dev, staging]) {
      const ledger = template.findResources('AWS::DynamoDB::Table', {
        Properties: {
          Tags: Match.arrayWith([
            Match.objectLike({ Key: 'sceneready:resource', Value: 'ledger' }),
          ]),
        },
      });
      expect(Object.values(ledger)[0]).toMatchObject({ DeletionPolicy: 'Delete' });
      const bucket = template.findResources('AWS::S3::Bucket');
      expect(Object.values(bucket)[0]).toMatchObject({ DeletionPolicy: 'Delete' });
    }
  }, 30_000);
});
