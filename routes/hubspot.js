import express from "express";
import { ensureAuthenticated } from '../middleware/auth.js';
import HubSpotController from '../controllers/HubSpotController.js';

const router = express.Router();
const hubspotController = new HubSpotController();

// Browse page
router.get('/', (req, res) => hubspotController.browse(req, res));

// Form page
router.get('/form', (req, res) => hubspotController.formPage(req, res));

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

// Handle form submission
router.post('/form', (req, res) => hubspotController.handleFormSubmission(req, res));

// AJAX: Create deal
router.post('/ajax/create-deal', (req, res) => hubspotController.createDealAjax(req, res));

// Create contact
router.post('/hubspot/create-contact', (req, res) => hubspotController.createContact(req, res));

// Handle webhook
router.post('/hubspot/webhook', (req, res) => hubspotController.handleWebhook(req, res));

// Get products
router.get("/products", (req, res) => hubspotController.getProducts(req, res));

// Get deals for product
router.get("/products/:productId/deals", (req, res) => hubspotController.getProductDeals(req, res));

export default router;