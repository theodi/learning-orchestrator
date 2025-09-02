import express from "express";
import CourseBookingController from '../controllers/CourseBookingController.js';

const router = express.Router();
const courseBookingController = new CourseBookingController();

// List all course bookings (datatable)
router.get('/', (req, res) => courseBookingController.index(req, res));

// Show new booking form
router.get('/new', (req, res) => courseBookingController.new(req, res));

// Create new booking
router.post('/', (req, res) => courseBookingController.create(req, res));

// Show individual booking
router.get('/:id', (req, res) => courseBookingController.show(req, res));

// Show edit form for existing booking
router.get('/:id/edit', (req, res) => courseBookingController.edit(req, res));

// Update existing booking
router.put('/:id', (req, res) => courseBookingController.update(req, res));


export default router;
