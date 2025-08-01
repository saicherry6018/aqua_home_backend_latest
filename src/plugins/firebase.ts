import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import admin, { ServiceAccount } from 'firebase-admin';
import { pushSubscriptions } from '../models/schema';
import { eq } from 'drizzle-orm';
import * as dotenv from 'dotenv';

// import ServiceAccountJson from '../config/service-account.json'

dotenv.config();

declare module 'fastify' {
  interface FastifyInstance {
    firebase: admin.app.App;
    push: {
      /**
       * Send a push notification to all devices for a user
       * @param userId string
       * @param title string
       * @param message string
       * @param referenceId string | undefined
       * @param referenceType string | undefined
       */
      send: (userId: string, title: string, message: string, referenceId?: string, referenceType?: string) => Promise<void>;
    };
  }
}

const base64Cred = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if (!base64Cred) {
  throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set in environment variables");
}

const decoded = Buffer.from(base64Cred, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decoded);


if (!admin.apps.length && serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as ServiceAccount),
  });
}

export default fp(async function (fastify: FastifyInstance) {
  // Check if Firebase app is initialized
  if (!admin.apps.length) {
    fastify.log.warn('Firebase configuration missing or invalid. Firebase plugin not initialized.');
    return;
  }

  const app = admin.app();

  // Decorate Fastify instance with firebase
  fastify.decorate('firebase', app);
  fastify.log.info('Firebase plugin registered');

  // Add a hook to close the Firebase connection when the server is shutting down
  fastify.addHook('onClose', async () => {
    await app.delete();
    fastify.log.info('Firebase connection closed');
  });

  fastify.decorate('push', {
    /**
     * Send a push notification to all devices for a user
     * @param userId string
     * @param title string
     * @param message string
     * @param referenceId string | undefined
     * @param referenceType string | undefined
     */
    async send(userId: string, title: string, message: string, referenceId?: string, referenceType?: string) {
      if (!userId) return;
      const tokens = await fastify.db.query.pushSubscriptions.findMany({
        where: eq(pushSubscriptions.userId, userId),
      });
      if (!tokens.length) return;
      const payload = {
        notification: {
          title,
          body: message,
        },
        data: {
          ...(referenceId ? { referenceId } : {}),
          ...(referenceType ? { referenceType } : {}),
        },
      };
      const tokenList = tokens.map((t: any) => t.endpoint);
      try {
        await admin.messaging().sendToDevice(tokenList, payload);
      } catch (err) {
        fastify.log.error('FCM push error', err);
      }
    },
  });
});