import express from 'express';
import { ensureAuthenticated } from '../middleware/auth.js';
import GoogleCalendarController from '../controllers/GoogleCalendarController.js';

const router = express.Router();
const googleCalendarController = new GoogleCalendarController();

// Test calendar service connection
router.get('/test', (req, res) => googleCalendarController.testConnection(req, res));

// Create training course calendar event
router.post('/events/training', (req, res) => googleCalendarController.createTrainingEvent(req, res));

export default router;
