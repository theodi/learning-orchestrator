// Response utility functions for consistent API responses

import { HTTP_STATUS } from '../config/constants.js';

export class ApiResponse {
  static success(data, message = 'Success', statusCode = HTTP_STATUS.OK) {
    return {
      success: true,
      message,
      data,
      statusCode,
    };
  }

  static error(message = 'Error', statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR, details = null) {
    return {
      success: false,
      message,
      statusCode,
      details,
    };
  }

  static validationError(errors, message = 'Validation failed') {
    return {
      success: false,
      message,
      statusCode: HTTP_STATUS.BAD_REQUEST,
      errors,
    };
  }
}

export const sendSuccess = (res, data, message = 'Success', statusCode = HTTP_STATUS.OK) => {
  return res.status(statusCode).json(ApiResponse.success(data, message, statusCode));
};

export const sendError = (res, message = 'Error', statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR, details = null) => {
  return res.status(statusCode).json(ApiResponse.error(message, statusCode, details));
};

export const sendValidationError = (res, errors, message = 'Validation failed') => {
  return res.status(HTTP_STATUS.BAD_REQUEST).json(ApiResponse.validationError(errors, message));
};

export default {
  ApiResponse,
  sendSuccess,
  sendError,
  sendValidationError,
};
