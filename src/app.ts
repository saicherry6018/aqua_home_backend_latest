import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import * as dotenv from 'dotenv';


// Import plugins
import dbPlugin from './plugins/db';
import authPlugin from './plugins/auth';
import razorpayPlugin from './plugins/razorpay';
import s3Plugin from './plugins/s3';
import firebasePlugin from './plugins/firebase';
// import sesPlugin from './plugins/ses';
// import whatsappPlugin from './plugins/whatsapp';

// Import routes
import authRoutes from './routes/auth.route';
// import userRoutes from './routes/user';
import productRoutes from './routes/products.routes';
import serviceRequestRoutes from './routes/servicerequests.route';
import installationRequestRoutes from './routes/installationrequests.route';
import franchiseRoutes from './routes/franchise.route';
// import notificationRoutes from './routes/notification';
// import dashboardRoutes from './routes/dashboard';
import serviceAgentRoutes from './routes/serviceagent.route';
// import homescreenRoutes from './routes/homescreen';
import multipart, { ajvFilePlugin } from '@fastify/multipart';
import categoryRoute from './routes/category.route';

// Load environment variables
dotenv.config();

export const app = fastify({
    // logger: {
    //     level: process.env.LOG_LEVEL || 'info'
    // },
    logger: {
        level: process.env.LOG_LEVEL || 'info',
        transport: process.env.NODE_ENV === 'development' ? {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        } : undefined,
      },
    bodyLimit: 30 * 1024 * 1024,
    ajv: {
        customOptions: {},
        plugins: [
            (ajv: any) => ajvFilePlugin(ajv) // ✅ RETURN the ajv instance
        ]
    }
});

// Register CORS first
app.register(cors, {
    origin: true,
    credentials: true,
});


// Register multipart BEFORE swagger
app.register(multipart, {
    // attachFieldsToBody: true
});

// Register JWT
app.register(jwt, {
    secret: process.env.JWT_SECRET || 'your-jwt-secret',
});

// Register custom plugins
app.register(dbPlugin);
app.register(authPlugin);
app.register(firebasePlugin);
// app.register(sesPlugin);
// app.register(whatsappPlugin);
app.register(razorpayPlugin);
app.register(s3Plugin);

// Register Swagger AFTER multipart
app.register(swagger, {
    openapi: {
        info: {
            title: 'PuriFiler API Documentation',
            description: 'API documentation for the PuriFiler Water Purifier Rental/Sales Management System',
            version: '1.0.0',
        },
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
        },
        security: [
            {
                bearerAuth: [],
            },
        ],
    },
});

app.register(swaggerUi, {
    routePrefix: '/documentation',
    uiConfig: {
        docExpansion: 'list',
        deepLinking: false,
    },
});

// Register routes
app.register(authRoutes, { prefix: '/api/auth' });
// app.register(userRoutes, { prefix: '/api/users' });
app.register(productRoutes, { prefix: '/api/products' });
app.register(categoryRoute, { prefix: '/api/categories' });
// app.register(orderRoutes, { prefix: '/api/orders' });
// app.register(rentalRoutes, { prefix: '/api/rentals' });
app.register(serviceRequestRoutes, { prefix: '/api/service-requests' });
app.register(franchiseRoutes, { prefix: '/api/franchises' });
// app.register(notificationRoutes, { prefix: '/api/notifications' });
// app.register(dashboardRoutes, { prefix: '/api/dashboard' });
app.register(serviceAgentRoutes, { prefix: '/api/agents' });
app.register(installationRequestRoutes, { prefix: '/api/installation-requests' });
// app.register(homescreenRoutes, { prefix: '/api/homescreen' });

// Add health check route
app.get('/health', {
    schema: {
        description: 'Health check endpoint',
        tags: ['health'],
        response: {
            200: {
                type: 'object',
                properties: {
                    status: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                },
            },
        },
    },
}, async () => {
    return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
    };
});

app.setErrorHandler((error, request, reply) => {
    app.log.error(error);

    // Handle validation errors
    if (error.validation) {
        return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: error.message,
        });
    }

    // Handle JWT errors
    if (error.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER') {
        return reply.status(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'No authorization header was found',
        });
    }

    if (error.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') {
        return reply.status(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'Token has expired',
        });
    }

    // Custom errors
    if ((error as any).statusCode) {
        return reply.status((error as any).statusCode).send({
            statusCode: (error as any).statusCode,
            error: (error as any).error || 'Error',
            message: error.message,
        });
    }

    // Default error
    reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An internal server error occurred',
    });
});