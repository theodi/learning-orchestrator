import express from 'express';
import EnrollmentController from '../controllers/EnrollmentController.js';

const router = express.Router();
const enrollmentController = new EnrollmentController();

// Browse enrollments
router.get('/', (req, res) => enrollmentController.browse(req, res));

// New enrollment form
router.get('/new', (req, res) => enrollmentController.newEnrollment(req, res));

// Process bulk enrollment
router.post('/', (req, res) => enrollmentController.createEnrollment(req, res));

// Get all enrollments with filtering
router.get('/all', (req, res) => enrollmentController.getAllEnrollments(req, res));

// Get enrollments for a specific course
router.get('/course/:courseId', (req, res) => enrollmentController.getCourseEnrollments(req, res));



// Resend enrollment email
router.post('/:enrollmentId/resend-email', (req, res) => enrollmentController.resendEmail(req, res));

export default router;
