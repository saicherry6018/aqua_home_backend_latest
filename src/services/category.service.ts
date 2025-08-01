import { and, eq, sql, desc, asc } from 'drizzle-orm';
import { categories } from '../models/schema';
import { v4 as uuidv4 } from 'uuid';
import { getFastifyInstance } from '../shared/fastify-instance';
import { badRequest, conflict, notFound, serverError } from '../utils/errors';
import { FastifyInstance } from 'fastify';

export interface CreateCategoryData {
    name: string;
}

export interface UpdateCategoryData {
    name?: string;
    isActive?: boolean;
}

export interface GetCategoriesFilters {
    isActive?: boolean;
    limit?: number;
    offset?: number;
}

export async function createCategory(data: CreateCategoryData) {
    try {
        const fastify = getFastifyInstance() as FastifyInstance;
        const db = fastify.db;

        // Check if category with same name already exists (case-insensitive)
        const existingCategory = await db.query.categories.findFirst({
            where: sql`LOWER(${categories.name}) = LOWER(${data.name})`
        });

        if (existingCategory) {
            throw conflict('Category with this name already exists');
        }

        const categoryId = uuidv4();
        const now = new Date().toISOString();

        const [newCategory] = await db.insert(categories).values({
            id: categoryId,
            name: data.name.trim(),
            isActive: true,
            createdAt: now,
            updatedAt: now,
        }).returning();

        return newCategory;
    } catch (error) {
        if (error.statusCode) {
            throw error;
        }
        throw serverError('Failed to create category: ' + error.message);
    }
}

export async function getAllCategories(filters: GetCategoriesFilters = {}) {
    try {
        const fastify = getFastifyInstance() as FastifyInstance;
        const db = fastify.db;

        let whereConditions = [];

        // Filter by active status if provided
        if (filters.isActive !== undefined) {
            whereConditions.push(eq(categories.isActive, filters.isActive));
        }

        // Build where clause
        const whereClause = whereConditions.length > 0 
            ? and(...whereConditions) 
            : undefined;

        // Get total count
        const totalResult = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(categories)
            .where(whereClause);
        
        const total = totalResult[0]?.count || 0;

        // Get categories with pagination
        let query = db
            .select()
            .from(categories)
            .where(whereClause)
            .orderBy(desc(categories.createdAt));

        if (filters.limit) {
            query = query.limit(filters.limit);
        }

        if (filters.offset) {
            query = query.offset(filters.offset);
        }

        const categoriesList = await query;

        return {
            categories: categoriesList,
            total
        };
    } catch (error) {
        throw serverError('Failed to fetch categories: ' + error.message);
    }
}

export async function getCategoryById(id: string) {
    try {
        const fastify = getFastifyInstance() as FastifyInstance;
        const db = fastify.db;

        const category = await db.query.categories.findFirst({
            where: eq(categories.id, id)
        });

        if (!category) {
            throw notFound('Category');
        }

        return category;
    } catch (error) {
        if (error.statusCode) {
            throw error;
        }
        throw serverError('Failed to fetch category: ' + error.message);
    }
}

export async function updateCategory(id: string, data: UpdateCategoryData) {
    try {
        const fastify = getFastifyInstance() as FastifyInstance;
        const db = fastify.db;

        // Check if category exists
        const existingCategory = await getCategoryById(id);

        // If updating name, check for duplicates (excluding current category)
        if (data.name && data.name.trim() !== existingCategory.name) {
            const duplicateCategory = await db.query.categories.findFirst({
                where: and(
                    sql`LOWER(${categories.name}) = LOWER(${data.name.trim()})`,
                    sql`${categories.id} != ${id}`
                )
            });

            if (duplicateCategory) {
                throw conflict('Category with this name already exists');
            }
        }

        const updateData: any = {
            updatedAt: new Date().toISOString()
        };

        if (data.name !== undefined) {
            updateData.name = data.name.trim();
        }

        if (data.isActive !== undefined) {
            updateData.isActive = data.isActive;
        }

        const [updatedCategory] = await db
            .update(categories)
            .set(updateData)
            .where(eq(categories.id, id))
            .returning();

        return updatedCategory;
    } catch (error) {
        if (error.statusCode) {
            throw error;
        }
        throw serverError('Failed to update category: ' + error.message);
    }
}

export async function toggleCategoryStatus(id: string) {
    try {
        const category = await getCategoryById(id);
        return await updateCategory(id, { isActive: !category.isActive });
    } catch (error) {
        if (error.statusCode) {
            throw error;
        }
        throw serverError('Failed to toggle category status: ' + error.message);
    }
}

export async function getActiveCategories() {
    return await getAllCategories({ isActive: true });
}

export async function getCategoriesCount() {
    try {
        const fastify = getFastifyInstance() as FastifyInstance;
        const db = fastify.db;

        const [total] = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(categories);

        const [active] = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(categories)
            .where(eq(categories.isActive, true));

        const [inactive] = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(categories)
            .where(eq(categories.isActive, false));

        return {
            total: total.count,
            active: active.count,
            inactive: inactive.count
        };
    } catch (error) {
        throw serverError('Failed to get categories count: ' + error.message);
    }
}