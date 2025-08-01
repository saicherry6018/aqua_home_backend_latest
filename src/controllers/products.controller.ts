
import { FastifyRequest, FastifyReply } from 'fastify';
import * as productService from '../services/products.service';
import { handleError, notFound, badRequest } from '../utils/errors';
import { UserRole } from '../types';

// Get all products
export async function getAllProducts(
  request: FastifyRequest<{ Querystring: { isActive?: boolean } }>,
  reply: FastifyReply
) {
  try {
    const { isActive } = request.query;
    const products = await productService.getAllProducts(false);

    return reply.code(200).send({ products });
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Get product by ID
export async function getProductById(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const product = await productService.getProductById(id);

    if (!product) {
      throw notFound('Product');
    }

    return reply.code(200).send({ product });
  } catch (error) {
    handleError(error, request, reply);
  }
}

export async function createProduct(request: FastifyRequest, reply: FastifyReply) {
  try {
    if (request.user.role !== UserRole.ADMIN) {
      throw badRequest('Not authorized to create products');
    }

    const parts = request.parts();
    const fields: Record<string, any> = {};
    const images: string[] = [];

    for await (const part of parts) {
      if (part.file) {
        // This is a file field (likely "images")
        const filename = `products/${Date.now()}-${part.filename}`;
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        const uploadedUrl = await request.server.uploadToS3(buffer, filename, part.mimetype);
        images.push(uploadedUrl);
      } else {
        // This is a regular field
        fields[part.fieldname] = part.value;
      }
    }

    const parsedData = {
      name: fields.name,
      description: fields.description,
      rentPrice: Number(fields.rentPrice),
      buyPrice: Number(fields.buyPrice),
      deposit: Number(fields.deposit),
      isRentable: fields.isRentable === 'true',
      isPurchasable: fields.isPurchasable === 'true',
      isActive: fields.isActive === 'true',
      features: [], // handle features if needed
      images: images,
      categoryId :fields.categoryId
    };

    console.log('parsedData', parsedData);

    const product = await productService.createProduct(parsedData);
    return reply.code(201).send({ message: 'Product created', product, statusCode: 201 });
  } catch (error) {
    console.error('error', error);
    handleError(error, request, reply);
  }
}


// Update product
export async function updateProduct(
  request: FastifyRequest<{
    Params: { id: string }
   
  }>,
  reply: FastifyReply
) {
  try {
    // Only admins can update products
    if (request.user.role !== UserRole.ADMIN) {
      throw badRequest('Not authorized to update products');
    }

    const { id } = request.params;
    const parts = request.parts();
    const fields: Record<string, any> = {};
    const images: string[] = [];

    for await (const part of parts) {
      if (part.file) {
        // This is a file field (likely "images")
        const filename = `products/${Date.now()}-${part.filename}`;
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        const uploadedUrl = await request.server.uploadToS3(buffer, filename, part.mimetype);
        images.push(uploadedUrl);
      } else {
        // This is a regular field
        fields[part.fieldname] = part.value;
      }
    }

    const parsedData = {
      name: fields.name,
      description: fields.description,
      rentPrice: Number(fields.rentPrice),
      buyPrice: Number(fields.buyPrice),
      deposit: Number(fields.deposit),
      isRentable: fields.isRentable === 'true',
      isPurchasable: fields.isPurchasable === 'true',
      isActive: fields.isActive === 'true',
      features: [], // handle features if needed
      images: images,
      categoryId:fields.categoryId,
      existingImages: fields.existingImages
      ? JSON.parse(fields.existingImages)
      : []
    };
    const product = await productService.updateProduct(id, parsedData);

    return reply.code(200).send({
      message: 'Product updated successfully',
      product
    });
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Delete product (soft delete by setting isActive to false)
export async function deleteProduct(
  request: FastifyRequest<{ Params: { id: string },Body:{isActive:boolean} }>,
  reply: FastifyReply
) {
  try {
    // Only admins can delete products
    if (request.user.role !== UserRole.ADMIN) {
      throw badRequest('Not authorized to delete products');
    }

    const { id } = request.params;
    console.log('body ',request.body)
    const {isActive} = request.body;

    console.log('id ',id)
    await productService.updateProduct(id, { isActive });

    return reply.code(200).send({
      message: 'Product deleted successfully',
      id
    });
  } catch (error) {
    handleError(error, request, reply);
  }
}

// Upload product image
export async function uploadProductImage(
  request: FastifyRequest<{
    Params: { id: string }
  }>,
  reply: FastifyReply
) {
  try {
    // Only admins can upload product images
    if (request.user.role !== UserRole.ADMIN) {
      throw badRequest('Not authorized to upload product images');
    }

    const { id } = request.params;

    // Get the file from the request
    const file = await request.file();
    if (!file) {
      throw badRequest('No file uploaded');
    }

    // Check file type
    const { mimetype } = file;
    if (!mimetype.includes('image')) {
      throw badRequest('Only image files are allowed');
    }

    // Upload to S3
    const buffer = await file.toBuffer();
    const filename = `products/${id}/${Date.now()}_${file.filename}`;
    const imageUrl = await request.server.uploadToS3(buffer, filename, mimetype);

    // Add the image to the product
    const product = await productService.getProductById(id);
    if (!product) {
      throw notFound('Product');
    }

    const images = product.images || [];
    images.push(imageUrl);

    await productService.updateProduct(id, { images });

    return reply.code(200).send({
      message: 'Product image uploaded successfully',
      imageUrl
    });
  } catch (error) {
    handleError(error, request, reply);
  }
}