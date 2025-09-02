import express from "express";
import { ensureAuthenticated } from '../middleware/auth.js';
import HubSpotController from '../controllers/HubSpotController.js';

const router = express.Router();
const hubspotController = new HubSpotController();

// Browse page
router.get('/', (req, res) => hubspotController.browse(req, res));

// Search companies
router.get('/companies/search', (req, res) => hubspotController.searchCompanies(req, res));

// Search contacts
router.get('/contacts/search', (req, res) => hubspotController.searchContacts(req, res));

// Get deal by ID
router.get('/deals/:id', (req, res) => hubspotController.getDeal(req, res));

// Get companies with pagination
router.get('/companies', (req, res) => hubspotController.getCompanies(req, res));

// Handle self-paced form submission
router.post('/self_paced', (req, res) => hubspotController.handleSelfPacedSubmission(req, res));

// AJAX: Create deal
router.post('/deals', (req, res) => hubspotController.createDealAjax(req, res));

// Create contact
router.post('/contacts', (req, res) => hubspotController.createContact(req, res));

// Get products
router.get("/products", (req, res) => hubspotController.getProducts(req, res));

// Get deals for product
router.get("/products/:productId/deals", (req, res) => hubspotController.getProductDeals(req, res));

export default router;