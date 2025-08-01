import { FastifyInstance } from "fastify";
import {
    createCategorySchema,
    getCategoriesSchema,
    getCategorySchema,
    updateCategorySchema
} from "../schemas/catrgory.schema";
import {
    createCategory,
    getCategories,
    getCategory,
    updateCategory,
    toggleCategoryStatus,
    getActiveCategories,
    getCategoriesStats
} from "../controllers/category.controller";

export default async function (fastify: FastifyInstance) {

    // Create category
    fastify.post(
        '/',
        {
            schema: createCategorySchema,
            preHandler: [fastify.authenticate],
        },
        (req, rep) => createCategory(req as any, rep)

    );

    // Get all categories with optional filtering
    fastify.get(
        '/',
        {
            schema: getCategoriesSchema,
            preHandler: [fastify.authenticate],
        },
        (req, rep) => getCategories(req as any, rep)

    );

    // Get active categories only (public endpoint or with different auth)
    fastify.get(
        '/active',
        {
            preHandler: [fastify.authenticate], // Remove if this should be public
        },
        getActiveCategories
    );

    // Get categories statistics
    fastify.get(
        '/stats',
        {
            preHandler: [fastify.authenticate],
        },
        getCategoriesStats
    );

    // Get category by ID
    fastify.get(
        '/:id',
        {
            schema: getCategorySchema,
            preHandler: [fastify.authenticate],
        },
        (req, rep) => getCategory(req as any, rep)

    );

    // Update category
    fastify.put(
        '/:id',
        {
            schema: updateCategorySchema,
            preHandler: [fastify.authenticate],
        },
        (req, rep) => updateCategory(req as any, rep)
    );

    // Toggle category status (alternative to PUT for just status changes)
    fastify.patch(
        '/categories/:id/toggle',
        {
            preHandler: [fastify.authenticate],
        },
        (req, rep) => toggleCategoryStatus(req as any, rep)
    );
}