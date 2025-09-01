import express from "express";
import { ensureAuthenticated } from '../middleware/auth.js';
import ForecastController from '../controllers/ForecastController.js';

const router = express.Router();
const forecastController = new ForecastController();

// Browse page
router.get('/', (req, res) => forecastController.browse(req, res));

// Import page
router.get('/import', (req, res) => forecastController.importPage(req, res));
router.get('/projects', (req, res) => forecastController.getProjects(req, res));
router.get('/persons', (req, res) => forecastController.getPersons(req, res));
router.get('/persons/:id', (req, res) => forecastController.getPersonById(req, res));

// RESTful task endpoints
router.get('/tasks', (req, res) => forecastController.getTasks(req, res));
router.post('/tasks', (req, res) => forecastController.createTask(req, res));
router.get('/tasks/:id', (req, res) => forecastController.getTaskById(req, res));
router.put('/tasks/:id', (req, res) => forecastController.updateTask(req, res));
router.delete('/tasks/:id', (req, res) => forecastController.deleteTask(req, res));

// RESTful: Create project + tasks for course
router.post('/projects/course', (req, res) => forecastController.createCourseProject(req, res));

// Get specific project by ID
router.get('/projects/:id', (req, res) => forecastController.getProjectById(req, res));

// Get schemas
router.get('/schemas', (req, res) => forecastController.getSchemas(req, res));

// Get specific schema
router.get('/schemas/:schemaType', (req, res) => forecastController.getSchema(req, res));

// Import data
router.post("/import", (req, res) => forecastController.importData(req, res));

// Get data by type
router.get("/:type", (req, res) => forecastController.getDataByType(req, res));

export default router;