import { Duration, RemovalPolicy, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

import { PROJECT_TAG, type DeploymentEnvironment } from '../../src/config.js';
import { PARTITION_KEY, SORT_KEY, TTL_ATTRIBUTE } from '../naming.js';

export interface DataStackProps extends StackProps {
  readonly environment: DeploymentEnvironment;
}

function removalPolicy(environment: DeploymentEnvironment): RemovalPolicy {
  return environment === 'COMPETITION' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
}

export class DataStack extends Stack {
  readonly operationalTable: Table;
  readonly ledgerTable: Table;
  readonly outboxTable: Table;
  readonly evidenceBucket: Bucket;
  readonly executionQueue: Queue;
  readonly executionDlq: Queue;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const retainEvidence = props.environment === 'COMPETITION';
    const dataRemoval = removalPolicy(props.environment);
    const evidenceRemoval = retainEvidence ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    this.operationalTable = this.table('OperationalTable', 'operational', dataRemoval);
    this.ledgerTable = this.table('LedgerTable', 'ledger', evidenceRemoval);
    this.outboxTable = this.table('OutboxTable', 'outbox', dataRemoval);

    this.evidenceBucket = new Bucket(this, 'EvidenceBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: evidenceRemoval,
    });
    Tags.of(this.evidenceBucket).add('sceneready:resource', 'evidence');

    this.executionDlq = new Queue(this, 'ExecutionDlq', {
      encryption: QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14),
      removalPolicy: dataRemoval,
    });
    Tags.of(this.executionDlq).add('sceneready:resource', 'execution-dlq');
    this.executionQueue = new Queue(this, 'ExecutionQueue', {
      encryption: QueueEncryption.SQS_MANAGED,
      deadLetterQueue: { queue: this.executionDlq, maxReceiveCount: 5 },
      removalPolicy: dataRemoval,
    });
    Tags.of(this.executionQueue).add('sceneready:resource', 'execution-queue');

    Tags.of(this).add('Project', PROJECT_TAG);
    Tags.of(this).add('sceneready:environment', props.environment);
  }

  private table(id: string, resource: string, removal: RemovalPolicy): Table {
    const table = new Table(this, id, {
      partitionKey: { name: PARTITION_KEY, type: AttributeType.STRING },
      sortKey: { name: SORT_KEY, type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: TTL_ATTRIBUTE,
      removalPolicy: removal,
    });
    Tags.of(table).add('sceneready:resource', resource);
    return table;
  }
}
