import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../models/schema';

declare module 'fastify' {
  interface FastifyInstance {
    db: any;
  }
}

export default fp(async function (fastify: FastifyInstance) {
  const dbUrl = process.env.TURSO_DB_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!dbUrl) {
    throw new Error('TURSO_DB_URL environment variable is not set');
  }

  try {
    const client = createClient({
      url: dbUrl,
      authToken: authToken,
    });

    // Initialize Drizzle ORM with the client
    const db = drizzle(client, { schema });

    // Add the database client to the Fastify instance
    fastify.decorate('db', db);

    console.log(await db.select().from(schema.users))

    // Add a hook to close the database connection when the server is shutting down
    fastify.addHook('onClose', async () => {
      await client.close();
      fastify.log.info('Database connection closed');
    });

    fastify.log.info('Database connection established');
  } catch (err) {
    fastify.log.error('Error connecting to database:', err);
    throw err;
  }
});