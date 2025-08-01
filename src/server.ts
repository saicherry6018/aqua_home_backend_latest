import { app } from './app';
import { setFastifyInstance } from './shared/fastify-instance';

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';

    setFastifyInstance(app);
    await app.listen({ port, host });

    app.log.info(`Server is running at http://${host}:${port}`);
    app.log.info(`Documentation available at http://${host}:${port}/documentation`);
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
