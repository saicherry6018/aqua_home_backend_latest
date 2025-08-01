// src/types/fastify.d.ts
import 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    firebase: import('firebase-admin').app.App;
    notification?: {
      send: (...args: any[]) => Promise<void>;
      processPendingNotifications: () => Promise<void>;
    };
    email?: {
      send: (...args: any[]) => Promise<void>;
    };
    whatsapp?: {
      send: (...args: any[]) => Promise<void>;
    };
  }
}
