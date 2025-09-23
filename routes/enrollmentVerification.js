import express from 'express';
import EnrollmentController from '../controllers/EnrollmentController.js';

const router = express.Router();
const enrollmentController = new EnrollmentController();

// Public verification route using deal_id and email as query params
router.get('/', (req, res) => enrollmentController.verifyEnrollmentByDeal(req, res));

export default router;
