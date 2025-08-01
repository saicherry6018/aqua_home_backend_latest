import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Base Category Schema
export const CategorySchema = z.object({
    id: z.string(),
    name: z.string(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

//-------------------------------------------------------------------
// REQUEST SCHEMAS
//-------------------------------------------------------------------

export const CreateCategoryRequestSchema = z.object({
    name: z.string().min(2, 'Category name must be at least 2 characters').max(100, 'Category name must not exceed 100 characters'),
});

export const UpdateCategoryRequestSchema = z.object({
    name: z.string().min(2, 'Category name must be at least 2 characters').max(100, 'Category name must not exceed 100 characters').optional(),
    isActive: z.boolean().optional(),
}).refine(data => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update"
});

export const GetCategoriesQuerySchema = z.object({
    isActive: z.enum(['true', 'false']).optional(),
    limit: z.string().regex(/^\d+$/).transform(Number).optional(),
    offset: z.string().regex(/^\d+$/).transform(Number).optional(),
});

//-------------------------------------------------------------------
// RESPONSE SCHEMAS
//-------------------------------------------------------------------

export const CreateCategoryResponseSchema = z.object({
    message: z.string(),
    category: CategorySchema,
});

export const UpdateCategoryResponseSchema = z.object({
    message: z.string(),
    category: CategorySchema,
});

export const GetCategoriesResponseSchema = z.object({
    categories: z.array(CategorySchema),
    total: z.number(),
});

export const GetCategoryResponseSchema = z.object({
    category: CategorySchema,
});

export const ErrorResponseSchema = z.object({
    statusCode: z.number(),
    error: z.string(),
    message: z.string(),
});

//-------------------------------------------------------------------
// FASTIFY SCHEMAS
//-------------------------------------------------------------------

export const createCategorySchema = {
    body: zodToJsonSchema(CreateCategoryRequestSchema),
    response: {
        201: zodToJsonSchema(CreateCategoryResponseSchema),
        400: zodToJsonSchema(ErrorResponseSchema),
        401: zodToJsonSchema(ErrorResponseSchema),
        409: zodToJsonSchema(ErrorResponseSchema), // Conflict for duplicate name
    },
    tags: ["categories"],
    summary: "Create a new category",
    description: "Create a new category with unique name",
    security: [{ bearerAuth: [] }],
};

export const getCategoriesSchema = {
    querystring: zodToJsonSchema(GetCategoriesQuerySchema),
    response: {
        200: zodToJsonSchema(GetCategoriesResponseSchema),
        400: zodToJsonSchema(ErrorResponseSchema),
        401: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["categories"],
    summary: "Get all categories with optional filtering",
    description: "Retrieve categories with optional filters for active status, limit, and offset",
    security: [{ bearerAuth: [] }],
};

export const getCategorySchema = {
    params: zodToJsonSchema(z.object({
        id: z.string(),
    })),
    response: {
        200: zodToJsonSchema(GetCategoryResponseSchema),
        400: zodToJsonSchema(ErrorResponseSchema),
        401: zodToJsonSchema(ErrorResponseSchema),
        404: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["categories"],
    summary: "Get category by ID",
    description: "Retrieve a specific category by its ID",
    security: [{ bearerAuth: [] }],
};

export const updateCategorySchema = {
    params: zodToJsonSchema(z.object({
        id: z.string(),
    })),
    body: zodToJsonSchema(UpdateCategoryRequestSchema),
    response: {
        200: zodToJsonSchema(UpdateCategoryResponseSchema),
        400: zodToJsonSchema(ErrorResponseSchema),
        401: zodToJsonSchema(ErrorResponseSchema),
        404: zodToJsonSchema(ErrorResponseSchema),
        409: zodToJsonSchema(ErrorResponseSchema), // Conflict for duplicate name
    },
    tags: ["categories"],
    summary: "Update category",
    description: "Update category name or toggle active status. Categories cannot be deleted.",
    security: [{ bearerAuth: [] }],
};