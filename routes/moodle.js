import express from 'express';
import MoodleController from '../controllers/MoodleController.js';

const router = express.Router();
const moodleController = new MoodleController();

// Page shell and data endpoint with content negotiation
router.get('/courses', (req, res) => moodleController.getCourses(req, res));

export default router;


