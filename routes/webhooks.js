import express from "express";
import HubSpotController from '../controllers/HubSpotController.js';

const router = express.Router();
const hubspotController = new HubSpotController();

// HubSpot form webhook -> creates a Forecast task
router.post('/form', (req, res) => hubspotController.handleWebhookForm(req, res));

export default router;


