import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import AWS from 'aws-sdk';

declare module 'fastify' {
  interface FastifyInstance {
    s3: AWS.S3;
    uploadToS3: (file: Buffer, key: string, contentType: string) => Promise<string>;
    getSignedUrl: (key: string) => Promise<string>;
  }
}

export default fp(async function (fastify: FastifyInstance) {
  // Check if AWS credentials are available
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION;
  const bucketName = process.env.S3_BUCKET_NAME;

  if (!accessKeyId || !secretAccessKey || !region || !bucketName) {
    fastify.log.warn('AWS S3 configuration missing. S3 plugin not initialized.');
    return;
  }

  try {
    // Configure AWS SDK
    AWS.config.update({
      accessKeyId,
      secretAccessKey,
      region,
    });

    // Create S3 instance
    const s3 = new AWS.S3();

    // Decorate Fastify instance with S3
    fastify.decorate('s3', s3);

    // Helper method to upload files to S3
    fastify.decorate('uploadToS3', async (file: Buffer, key: string, contentType: string): Promise<string> => {
      const params = {
        Bucket: bucketName,
        Key: key,
        Body: file,
        ContentType: contentType,
        ACL: 'public-read', // Make the file publicly accessible
      };

      const result = await s3.upload(params).promise();
      return result.Location;
    });

    // Helper method to get a signed URL for private files
    fastify.decorate('getSignedUrl', async (key: string): Promise<string> => {
      const params = {
        Bucket: bucketName,
        Key: key,
        Expires: 60 * 5, // URL expires in 5 minutes
      };

      return s3.getSignedUrlPromise('getObject', params);
    });

    fastify.log.info('AWS S3 plugin registered');
  } catch (err) {
    fastify.log.error('Error initializing AWS S3:', err);
    throw err;
  }
});