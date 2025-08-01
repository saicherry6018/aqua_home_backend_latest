import { FastifyReply, FastifyRequest } from 'fastify';

// Custom error class for API errors
export class ApiError extends Error {
  statusCode: number;
  error: string;

  constructor(statusCode: number, message: string, error?: string) {
    super(message);
    this.statusCode = statusCode;
    this.error = error || getErrorName(statusCode);
  }
}

// Get error name based on status code
export function getErrorName(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'Bad Request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not Found';
    case 409:
      return 'Conflict';
    case 422:
      return 'Unprocessable Entity';
    case 500:
      return 'Internal Server Error';
    default:
      return 'Error';
  }
}

// 400 - Bad Request
export function badRequest(message: string): ApiError {
  return new ApiError(400, message);
}

// 401 - Unauthorized
export function unauthorized(message = 'Authentication required'): ApiError {
  return new ApiError(401, message);
}

// 403 - Forbidden
export function forbidden(message = 'Access denied'): ApiError {
  return new ApiError(403, message);
}

// 404 - Not Found
export function notFound(entity: string): ApiError {
  return new ApiError(404, `${entity} not found`);
}

// 409 - Conflict
export function conflict(message: string): ApiError {
  return new ApiError(409, message);
}

// 422 - Unprocessable Entity
export function validationError(message: string): ApiError {
  return new ApiError(422, message);
}

// 500 - Internal Server Error
export function serverError(message = 'An unexpected error occurred'): ApiError {
  return new ApiError(500, message);
}

// Helper function to handle errors in controllers
export function handleError(error: any, request: FastifyRequest, reply: FastifyReply): void {
  request.log.error(error);
  
  if (error instanceof ApiError) {
    reply.status(error.statusCode).send({
      statusCode: error.statusCode,
      error: error.error,
      message: error.message,
    });
  } else {
    reply.status(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    });
  }
}