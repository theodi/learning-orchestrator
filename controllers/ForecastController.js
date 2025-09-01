// Forecast controller

import BaseController from './BaseController.js';
import { ForecastService } from '../services/forecastService.js';
import { VALID_FORECAST_TYPES } from '../config/constants.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ForecastController extends BaseController {
  constructor() {
    super();
    this.service = new ForecastService();
  }

  // Browse page
  async browse(req, res) {
    return this.renderPage(req, res, 'pages/forecast/browse', {
      title: 'Browse Forecast Data'
    });
  }

  // Import page
  async importPage(req, res) {
    try {
      // Fetch projects for the dropdown
      const projects = await this.service.fetchProjects();
      return this.renderPage(req, res, 'pages/forecast/import', {
        title: 'Import Data',
        projects: projects
      });
    } catch (error) {
      console.error('Error fetching projects for import page:', error);
      return this.renderPage(req, res, 'pages/forecast/import', {
        title: 'Import Data',
        projects: []
      });
    }
  }

  // Get projects for dropdown
  async getProjects(req, res) {
    try {
      const projects = await this.service.fetchProjects();
      return this.sendSuccess(res, projects, 'Projects fetched successfully');
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Get persons with optional email filtering
  async getPersons(req, res) {
    try {
      const { email } = req.query;
      
      if (email) {
        // If email is provided, look up specific person(s) by email
        const emails = Array.isArray(email) ? email : [email];
        const result = await this.service.lookupPersonIdsByEmails(emails);
        return this.sendSuccess(res, result, 'Persons looked up successfully');
      } else {
        // If no email provided, return all persons
        const persons = await this.service.fetchUsers();
        return this.sendSuccess(res, persons, 'All persons fetched successfully');
      }
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Get specific person by ID
  async getPersonById(req, res) {
    try {
      const { id } = req.params;
      const persons = await this.service.fetchUsers();
      const person = persons.find(p => p.id === parseInt(id));
      
      if (!person) {
        return this.sendError(res, 'Person not found', 404);
      }
      
      return this.sendSuccess(res, person, 'Person fetched successfully');
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Get specific project by ID
  async getProjectById(req, res) {
    try {
      const { id } = req.params;
      const project = await this.service.getProject(id);
      return this.sendSuccess(res, project, 'Project fetched successfully');
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Get schemas
  async getSchemas(req, res) {
    try {
      const acceptHeader = req.headers.accept;
      const schemaFiles = this.getSchemaFiles();

      if (acceptHeader.includes('text/html')) {
        const htmlList = `<ul>${schemaFiles.map((file) => `<li>${file}</li>`).join('')}</ul>`;
        return res.status(200).send(htmlList);
      } else if (acceptHeader.includes('application/json')) {
        return res.status(200).json(schemaFiles);
      } else if (acceptHeader.includes('text/csv')) {
        const csvList = schemaFiles.join(',');
        return res.status(200).send(csvList);
      } else {
        return res.status(406).send('Not Acceptable. Supported formats: text/html, application/json, text/csv');
      }
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Get specific schema
  async getSchema(req, res) {
    try {
      const { schemaType } = req.params;
      const schemaFilePath = path.join(__dirname, '../schemas', `${schemaType}.json`);
      const schema = JSON.parse(fs.readFileSync(schemaFilePath, 'utf8'));
      return res.json(schema);
    } catch (error) {
      return this.sendError(res, 'Schema not found', 404);
    }
  }

  // Import data
  async importData(req, res) {
    try {
      const { type } = req.query;
      const data = await this.service.importData(type, req.body);
      return this.sendSuccess(res, data, 'Data imported successfully');
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Create a new task (RESTful)
  async createTask(req, res) {
    try {
      const data = await this.service.createTask(req.body);
      return this.sendSuccess(res, data, 'Task created successfully', 201);
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Get all tasks
  async getTasks(req, res) {
    try {
      const tasks = await this.service.fetchTasks();
      return this.sendSuccess(res, tasks, 'Tasks fetched successfully');
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Get task by ID
  async getTaskById(req, res) {
    try {
      const { id } = req.params;
      const task = await this.service.getTaskById(id);
      return this.sendSuccess(res, task, 'Task fetched successfully');
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Update task
  async updateTask(req, res) {
    try {
      const { id } = req.params;
      const task = await this.service.updateTask(id, req.body);
      return this.sendSuccess(res, task, 'Task updated successfully');
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Delete task
  async deleteTask(req, res) {
    try {
      const { id } = req.params;
      await this.service.deleteTask(id);
      return this.sendSuccess(res, null, 'Task deleted successfully');
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Get data by type
  async getDataByType(req, res) {
    try {
      const { type } = req.params;
      
      if (!VALID_FORECAST_TYPES.includes(type)) {
        return this.sendError(res, 'Invalid type', 404);
      }

      const data = await this.service.getDataByType(type);
      const acceptHeader = req.get('accept');

      if (acceptHeader.includes('text/csv')) {
        res.set('Content-Type', 'text/csv');
        return res.send(data.map(row => Object.values(row).join(',')).join('\n'));
      } else if (acceptHeader.includes('application/json')) {
        return res.json(data);
      } else {
        return this.renderPage(req, res, 'pages/forecast/datatable', {
          title: type,
          data,
          type
        });
      }
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Helper methods
  getSchemaFiles() {
    const schemasDirectory = path.join(__dirname, '../schemas');
    const files = fs.readdirSync(schemasDirectory);
    return files.map((file) => path.parse(file).name);
  }

  // AJAX: Create project + team + tasks for course delivery
  async createCourseProject(req, res) {
    try {
      const {
        client_name,
        course_name,
        course_date, // YYYY-MM-DD
        course_location,
        tutor_id,
        course_duration_hours,
        budget,
        description
      } = req.body;

      if (!client_name || !course_name || !course_date || !course_location || !tutor_id || !course_duration_hours) {
        return this.sendError(res, 'Missing required fields', 400);
      }

      // Project name and dates
      const projectName = `${client_name} - ${course_name} - ${course_date} (${course_location})`;
      const startDate = new Date(course_date);
      startDate.setDate(startDate.getDate() - 1); // day before
      const projectData = {
        name: projectName,
        description: description,
        start_date: startDate.toISOString().split('T')[0],
        end_date: course_date,
        approved: true,
        budget_type: 'FIXED_PRICE',
        budget: parseFloat(budget) || 0
      };

      // Create project
      const project = await this.service.createProject(projectData);

      const companyProjectId = project.custom_project_id || project.company_project_id || project.id;

      // Create tasks
      // 1) Deliver course on course_date
      const deliverTask = await this.service.createTask({
        project_id: project.id,
        title: 'Deliver course',
        start_date: course_date,
        end_date: course_date,
        assigned_persons: [parseInt(tutor_id, 10)],
        estimate: Math.round(parseFloat(course_duration_hours) * 60) // minutes
      });

      // 2) Prep and admin from day before to course_date
      const prepTask = await this.service.createTask({
        project_id: project.id,
        title: 'Prep and admin',
        start_date: projectData.start_date,
        end_date: course_date,
        assigned_persons: [parseInt(tutor_id, 10)],
        estimate: 120 // 2h default
      });

      return this.sendSuccess(res, {
        project,
        project_view_id: companyProjectId,
        tasks: { deliverTask, prepTask }
      });
    } catch (error) {
      return this.sendError(res, error.response?.data?.message || error.message);
    }
  }
}

export default ForecastController;
