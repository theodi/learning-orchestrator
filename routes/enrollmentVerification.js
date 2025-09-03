import express from 'express';
import EnrollmentController from '../controllers/EnrollmentController.js';

const router = express.Router();
const enrollmentController = new EnrollmentController();

// Public verification routes (no authentication required)
// Verify enrollment token
router.get('/:token', (req, res) => enrollmentController.verifyEnrollment(req, res));

// Complete pending enrollment
router.post('/:token/complete', (req, res) => enrollmentController.completeEnrollment(req, res));

// Resend enrollment email (public, but requires valid token)
router.post('/:token/resend-email', (req, res) => enrollmentController.resendEmailByToken(req, res));

export default router;
