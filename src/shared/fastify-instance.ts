import { FastifyInstance } from 'fastify';

let instance: FastifyInstance;

export const setFastifyInstance = (fastify: FastifyInstance) => {
    console.log('fastify setted up')
    instance = fastify;
};

export const getFastifyInstance = (): FastifyInstance => {
    if (!instance) throw new Error('Fastify instance not initialized');
    return instance;
};
