import { eq, and } from 'drizzle-orm';
import { products } from '../models/schema';
import { notFound } from '../utils/errors';
import { generateId, parseJsonSafe } from '../utils/helpers';
import { getFastifyInstance } from '../shared/fastify-instance';

// Get all products
export async function getAllProducts(includeInactive = false) {
    const fastify = getFastifyInstance()

    // let query = fastify.db.query.products;
    let results = await fastify.db.query.products.findMany({

    });

    console.log('results ', results)
    return results.map(result => { return { ...result, images: JSON.parse(result.images) } })
}

export async function getProductById(id: string) {
    const fastify = getFastifyInstance();

    const result = await fastify.db.query.products.findFirst({
        where: eq(products.id, id)
    });

    if (!result) return null;

    return {
        ...result,
        images: parseJsonSafe<string[]>(result.images, [])
    };
}


// Create product
export async function createProduct(data: {
    name: string;
    description: string;
    images: string[];
    rentPrice: number;
    buyPrice: number;
    deposit: number;
    isRentable?: boolean;
    categoryId: string;
    isPurchasable?: boolean;
    features?: { name: string; value: string; }[];
}) {
    const fastify = getFastifyInstance()

    const id =  await generateId('prod');


    console.log('came here ')
    await fastify.db.transaction(async (tx) => {
        const now = new Date().toISOString();

        await tx
            .insert(products)
            .values({
                id,
                name: data.name,
                description: data.description,
                images: JSON.stringify(data.images || []),
                rentPrice: data.rentPrice,
                buyPrice: data.buyPrice,
                deposit: data.deposit,
                isRentable: data.isRentable ?? true,
                isPurchasable: data.isPurchasable ?? true,
                createdAt: now,
                updatedAt: now,
                isActive: true,
                categoryId: data.categoryId
            })



    });
    return getProductById(id);
}

// Update product
export async function updateProduct(id: string, data: {
    name?: string;
    description?: string;
    images?: string[];
    rentPrice?: number;
    buyPrice?: number;
    deposit?: number;
    isRentable?: boolean;
    isPurchasable?: boolean;
    isActive?: boolean;
    existingImages: string[];
    categoryId:string;
}) {
    const fastify = getFastifyInstance();

    const product = await getProductById(id);
    if (!product) {
        throw notFound('Product');
    }

    const updateData: any = {
        updatedAt: new Date().toISOString()
    };



    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.images !== undefined) updateData.images = JSON.stringify([...data.images, ...data.existingImages]);
    if (data.rentPrice !== undefined) updateData.rentPrice = data.rentPrice;
    if (data.buyPrice !== undefined) updateData.buyPrice = data.buyPrice;
    if (data.deposit !== undefined) updateData.deposit = data.deposit;
    if (data.isRentable !== undefined) updateData.isRentable = data.isRentable;
    if (data.isPurchasable !== undefined) updateData.isPurchasable = data.isPurchasable;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;

    await fastify.db
        .update(products)
        .set(updateData)
        .where(eq(products.id, id));

    return getProductById(id);
}



