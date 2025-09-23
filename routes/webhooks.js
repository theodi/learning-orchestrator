import express from "express";
import HubSpotController from '../controllers/HubSpotController.js';
import EnrollmentController from '../controllers/EnrollmentController.js';

const router = express.Router();
const hubspotController = new HubSpotController();
const enrollmentController = new EnrollmentController();

// HubSpot form webhook -> creates a Forecast task
router.post('/form', (req, res) => hubspotController.handleWebhookForm(req, res));

// Authenticated: deal learner status (HubSpot → us)
router.post('/deal-learner-status', (req, res) => hubspotController.getDealLearnerStatus(req, res));

// Authenticated: trigger learner reminder emails for a deal (HubSpot workflow)
router.post('/deal-send-reminders', (req, res) => hubspotController.sendDealLearnerReminders(req, res));


export default router;


