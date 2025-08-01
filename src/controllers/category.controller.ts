import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as categoryService from '../services/category.service';
import { handleError } from "../utils/errors";

export async function createCategory(
    request: FastifyRequest<{ 
        Body: { name: string } 
    }>,
    reply: FastifyReply
) {
    try {
        const { name } = request.body;
        
        const category = await categoryService.createCategory({ name });

        return reply.code(201).send({
            message: 'Category created successfully',
            category
        });
    } catch (error) {
        handleError(error, request, reply);
    }
}

export async function getCategories(
    request: FastifyRequest<{
        Querystring: { 
            isActive?: string;
            limit?: string;
            offset?: string;
        }
    }>,
    reply: FastifyReply
) {
    try {
        const { isActive, limit, offset } = request.query;
        
        const filters: any = {};
        
        if (isActive !== undefined) {
            filters.isActive = isActive === 'true';
        }
        
        if (limit !== undefined) {
            filters.limit = parseInt(limit);
        }
        
        if (offset !== undefined) {
            filters.offset = parseInt(offset);
        }

        const result = await categoryService.getAllCategories(filters);

        return reply.code(200).send(result);
    } catch (error) {
        handleError(error, request, reply);
    }
}

export async function getCategory(
    request: FastifyRequest<{
        Params: { id: string }
    }>,
    reply: FastifyReply
) {
    try {
        const { id } = request.params;
        
        const category = await categoryService.getCategoryById(id);

        return reply.code(200).send({ category });
    } catch (error) {
        handleError(error, request, reply);
    }
}

export async function updateCategory(
    request: FastifyRequest<{
        Params: { id: string };
        Body: {
            name?: string;
            isActive?: boolean;
        }
    }>,
    reply: FastifyReply
) {
    try {
        const { id } = request.params;
        const updateData = request.body;
        
        const category = await categoryService.updateCategory(id, updateData);

        return reply.code(200).send({
            message: 'Category updated successfully',
            category
        });
    } catch (error) {
        handleError(error, request, reply);
    }
}

export async function toggleCategoryStatus(
    request: FastifyRequest<{
        Params: { id: string }
    }>,
    reply: FastifyReply
) {
    try {
        const { id } = request.params;
        
        const category = await categoryService.toggleCategoryStatus(id);

        return reply.code(200).send({
            message: `Category ${category.isActive ? 'activated' : 'deactivated'} successfully`,
            category
        });
    } catch (error) {
        handleError(error, request, reply);
    }
}

export async function getActiveCategories(
    request: FastifyRequest,
    reply: FastifyReply
) {
    try {
        const result = await categoryService.getActiveCategories();

        return reply.code(200).send(result);
    } catch (error) {
        handleError(error, request, reply);
    }
}

export async function getCategoriesStats(
    request: FastifyRequest,
    reply: FastifyReply
) {
    try {
        const stats = await categoryService.getCategoriesCount();

        return reply.code(200).send(stats);
    } catch (error) {
        handleError(error, request, reply);
    }
}