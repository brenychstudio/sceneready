import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';

export class S3EvidenceStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async putBytes(key: string, body: Uint8Array): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/json',
      }),
    );
  }

  async getBytes(key: string): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    if (result.Body === undefined) {
      throw new Error('evidence object is empty');
    }
    return result.Body.transformToByteArray();
  }
}
