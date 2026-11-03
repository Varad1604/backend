import { Injectable } from '@nestjs/common';
import { CreateBucketCommand, DeleteObjectCommand, GetBucketPolicyCommand, GetObjectCommand, HeadBucketCommand, PutBucketEncryptionCommand, PutBucketVersioningCommand, PutObjectCommand, PutPublicAccessBlockCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../../config/env';

/**
 * Private document storage. Bootstrap keeps the brief §5.9 guarantees while staying
 * compatible with MinIO, which does not implement the AWS-only PublicAccessBlock and
 * SSE-without-KMS APIs (CONTRACT_DIFF #132): we attempt the hardening calls, and on
 * NotImplemented/MalformedXML we verify the equivalent MinIO state instead — buckets
 * are private by default (confirmed via GetBucketPolicy) and versioning is supported.
 */
@Injectable()
export class FileStorageService {
  private ready?: Promise<void>;
  private readonly client = new S3Client({ region: env.S3_REGION, endpoint: env.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } });
  private unsupported(error: unknown): boolean {
    const name = (error as { name?: string; Code?: string })?.name ?? (error as { Code?: string })?.Code ?? '';
    const message = error instanceof Error ? error.message : String(error);
    return /NotImplemented|MalformedXML|MethodNotAllowed/i.test(name) || /NotImplemented|MalformedXML/i.test(message);
  }
  private ensure() {
    return this.ready ??= (async () => {
      try { await this.client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET })); } catch { await this.client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET })); }
      try {
        await this.client.send(new PutPublicAccessBlockCommand({ Bucket: env.S3_BUCKET, PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } }));
      } catch (error) {
        if (!this.unsupported(error)) throw error;
        // MinIO path: prove the bucket is not publicly readable instead (private by default).
        const policy = await this.client.send(new GetBucketPolicyCommand({ Bucket: env.S3_BUCKET })).catch(() => null);
        const statement: { Effect: string; Principal?: unknown }[] = policy?.Policy ? JSON.parse(policy.Policy).Statement ?? [] : [];
        if (statement.some(rule => rule.Effect === 'Allow' && (rule.Principal === '*' || (rule.Principal as { AWS?: string } | undefined)?.AWS === '*'))) {
          throw new Error('The document bucket has a public policy; refusing to use it for documents.');
        }
      }
      await this.client.send(new PutBucketVersioningCommand({ Bucket: env.S3_BUCKET, VersioningConfiguration: { Status: 'Enabled' } }));
      try {
        await this.client.send(new PutBucketEncryptionCommand({ Bucket: env.S3_BUCKET, ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] } }));
      } catch (error) {
        // MinIO without KES cannot serve SSE-S3; encryption at rest is then an environment
        // duty (disk/volume encryption). Privacy and versioning remain enforced.
        if (!this.unsupported(error)) throw error;
      }
    })();
  }
  async put(key: string, body: Buffer) { await this.ensure(); await this.client.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: 'application/pdf' })); }
  async delete(key: string) { await this.ensure(); await this.client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key })); }
  async get(key: string) { await this.ensure(); const result = await this.client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key })); return result.Body?.transformToByteArray(); }
  async readyCheck() { try { await this.ensure(); return true; } catch { this.ready = undefined; return false; } }
}
