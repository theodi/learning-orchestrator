// Base controller class

import { sendSuccess, sendError, sendValidationError } from '../utils/response.js';
import { validateRequiredFields } from '../utils/validation.js';

export class BaseController {
  constructor() {
    this.sendSuccess = sendSuccess;
    this.sendError = sendError;
    this.sendValidationError = sendValidationError;
    this.validateRequiredFields = validateRequiredFields;
  }

  // Standard CRUD operations
  async index(req, res) {
    try {
      const data = await this.service.getAll();
      return this.sendSuccess(res, data);
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  async show(req, res) {
    try {
      const { id } = req.params;
      const data = await this.service.getById(id);
      
      if (!data) {
        return this.sendError(res, 'Resource not found', 404);
      }
      
      return this.sendSuccess(res, data);
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  async create(req, res) {
    try {
      const data = await this.service.create(req.body);
      return this.sendSuccess(res, data, 'Created successfully', 201);
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const data = await this.service.update(id, req.body);
      
      if (!data) {
        return this.sendError(res, 'Resource not found', 404);
      }
      
      return this.sendSuccess(res, data, 'Updated successfully');
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  async delete(req, res) {
    try {
      const { id } = req.params;
      const deleted = await this.service.delete(id);
      
      if (!deleted) {
        return this.sendError(res, 'Resource not found', 404);
      }
      
      return this.sendSuccess(res, null, 'Deleted successfully');
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Helper methods
  handleValidation(req, res, requiredFields) {
    const validation = this.validateRequiredFields(req.body, requiredFields);
    
    if (!validation.isValid) {
      return this.sendValidationError(res, validation.missingFields);
    }
    
    return null; // Continue with the request
  }

  renderPage(req, res, view, data = {}) {
    const page = {
      title: data.title || 'Page',
      link: data.link || '/'
    };
    
    res.locals.page = page;
    res.locals.user = req.user;
    
    return res.render(view, data);
  }
}

export default BaseController;
