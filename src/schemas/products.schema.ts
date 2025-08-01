import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ErrorResponseSchema } from './auth.schema';


// Product Schema
export const ProductSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    images: z.array(z.string()),
    rentPrice: z.number(),
    buyPrice: z.number(),
    deposit: z.number(),
    isRentable: z.boolean(),
    isPurchasable: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    isActive: z.boolean(),
    categoryId:z.string()
});

//-------------------------------------------------------------------
//-------------------------------------------------------------------
export const CreateProductRequestSchema = z.object({
    name: z.string().min(3, "Name must be at least 3 characters long"),
    description: z.string().min(10, "Description must be at least 10 characters long"),
    images: z.array(z.string()).default([]),
    rentPrice: z.number().min(0, "Rent price must be non-negative"),
    buyPrice: z.number().min(0, "Buy price must be non-negative"),
    deposit: z.number().min(0, "Deposit must be non-negative"),
    isRentable: z.boolean().default(true),
    isPurchasable: z.boolean().default(true),
    features: z.array(
        z.object({
            name: z.string(),
            value: z.string(),
        })
    ).optional(),
});

export const UpdateProductRequestSchema = z.object({
    name: z.string().min(3, "Name must be at least 3 characters long").optional(),
    description: z.string().min(10, "Description must be at least 10 characters long").optional(),
    images: z.array(z.string()).optional(),
    rentPrice: z.number().min(0, "Rent price must be non-negative").optional(),
    buyPrice: z.number().min(0, "Buy price must be non-negative").optional(),
    deposit: z.number().min(0, "Deposit must be non-negative").optional(),
    isRentable: z.boolean().optional(),
    isPurchasable: z.boolean().optional(),
    isActive: z.boolean().optional(),
    existingImages: z.string().optional(),
    categoryId:z.string(),
    features: z.array(
        z.object({
            name: z.string(),
            value: z.string(),
        })
    ).optional(),
});


//-------------------------------------------------------------------
//-------------------------------------------------------------------


export const GetAllProductsQuerySchema = z.object({
    isActive: z.boolean().optional(),
});
export const GetProductByIdParamsSchema = z.object({
    id: z.string(),
});

// Update Product Schema
export const UpdateProductParamsSchema = z.object({
    id: z.string(),
});
// Update Product Feature Schema



// Upload Product Image Schema
export const UploadProductImageParamsSchema = z.object({
    id: z.string(),
});

export const DeleteProductParamsSchema = z.object({
    id: z.string(),
});





//-------------------------------------------------------------------
//-------------------------------------------------------------------

export const GetAllProductsResponseSchema = z.object({
    products: z.array(ProductSchema),
});
export const GetProductByIdResponseSchema = z.object({
    product: ProductSchema,
});


export const CreateProductResponseSchema = z.object({
    message: z.string(),
    product: ProductSchema,
});

export const UpdateProductResponseSchema = z.object({
    message: z.string(),
    product: ProductSchema,
});
export const DeleteProductResponseSchema = z.object({
    message: z.string(),
    id: z.string(),
});


export const UploadProductImageResponseSchema = z.object({
    message: z.string(),
    imageUrl: z.string(),
});


//-------------------------------------------------------------------
//-------------------------------------------------------------------


export const getAllProductsSchema = {
    querystring: zodToJsonSchema(GetAllProductsQuerySchema),
    response: {
        200: zodToJsonSchema(GetAllProductsResponseSchema),
        400: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["products"],
    summary: "Get all products",
    description: "Get a list of all products, optionally filtered by active status",
};

// Get Product by ID Schema



export const getProductByIdSchema = {
    params: zodToJsonSchema(GetProductByIdParamsSchema),
    response: {
        200: zodToJsonSchema(GetProductByIdResponseSchema),
        404: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["products"],
    summary: "Get product by ID",
    description: "Get a product by its ID",
};



export const createProductSchema = {
    consumes: ['multipart/form-data'],
    // 👇 Swagger doc only – this won't be validated at runtime
    body: {
        type: 'object',
        required: ['name', 'description', 'images', 'rentPrice', 'buyPrice', 'deposit'],
        properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            rentPrice: { type: 'string' },
            buyPrice: { type: 'string' },
            deposit: { type: 'string' },
            categoryId:{type :'string'},
            isRentable: { type: 'string', enum: ['true', 'false'] },
            isPurchasable: { type: 'string', enum: ['true', 'false'] },
            images: {
                type: 'array',
                items: { type: 'string', format: 'binary' },
            },
        },
    },
    // ❗️Response schemas are fine – no change needed
    response: {
        201: zodToJsonSchema(CreateProductResponseSchema),
        400: zodToJsonSchema(ErrorResponseSchema),
        403: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ['products'],
    summary: 'Create a new product',
    description: 'Create a new product (admin only)',
    security: [{ bearerAuth: [] }],

};



export const updateProductSchema = {
    params: zodToJsonSchema(UpdateProductParamsSchema),
    body: zodToJsonSchema(UpdateProductRequestSchema),
    response: {
        200: zodToJsonSchema(UpdateProductResponseSchema),
        400: zodToJsonSchema(ErrorResponseSchema),
        403: zodToJsonSchema(ErrorResponseSchema),
        404: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["products"],
    summary: "Update a product",
    description: "Update an existing product (admin only)",
    security: [{ bearerAuth: [] }],
};

export const deleteProductSchema = {
    params: zodToJsonSchema(DeleteProductParamsSchema),
    body: zodToJsonSchema(z.object({
        isActive: z.boolean()
    })),
    response: {
        200: zodToJsonSchema(DeleteProductResponseSchema),
        403: zodToJsonSchema(ErrorResponseSchema),
        404: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["products"],
    summary: "Delete a product",
    description: "Soft delete a product by setting isActive to false (admin only)",
    security: [{ bearerAuth: [] }],
};



export const uploadProductImageSchema = {
    params: zodToJsonSchema(UploadProductImageParamsSchema),
    consumes: ["multipart/form-data"],
    response: {
        200: zodToJsonSchema(UploadProductImageResponseSchema),
        400: zodToJsonSchema(ErrorResponseSchema),
        403: zodToJsonSchema(ErrorResponseSchema),
        404: zodToJsonSchema(ErrorResponseSchema),
    },
    tags: ["products"],
    summary: "Upload product image",
    description: "Upload an image for a product (admin only)",
    security: [{ bearerAuth: [] }],
};