import express from 'express';
import { ensureAuthenticated } from '../middleware/auth.js';
import SelfPacedBookingController from '../controllers/SelfPacedBookingController.js';

const router = express.Router();
const controller = new SelfPacedBookingController();

// New form
router.get('/new', ensureAuthenticated, (req, res) => controller.new(req, res));

// Create
router.post('/', ensureAuthenticated, (req, res) => controller.create(req, res));

export default router;


