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

// Get learner enrollment/access matrix for a deal (authenticated)
router.get('/deals/:id/learner-status', (req, res) => hubspotController.getDealLearnerMatrix(req, res));

// Send learner reminder email
router.post('/deals/:id/remind-learner', (req, res) => hubspotController.sendLearnerReminder(req, res));

// Get deal email/notes history
router.get('/deals/:id/email-history', (req, res) => hubspotController.getDealEmailHistory(req, res));

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

// Get courses (products with type "Learning Course")
router.get("/courses", (req, res) => hubspotController.getCourses(req, res));

// Show course creation form (place BEFORE :id route)
router.get("/courses/new", (req, res) => hubspotController.showCreateCourse(req, res));

// Show course edit form (place BEFORE :id route)
router.get("/courses/:id/edit", (req, res) => hubspotController.showEditCourse(req, res));

// Get single course (must come AFTER the more specific routes)
router.get("/courses/:id", (req, res) => hubspotController.getCourse(req, res));

// Create new course
router.post("/courses", (req, res) => hubspotController.createCourse(req, res));

// Update existing course
router.put("/courses/:id", (req, res) => hubspotController.updateCourse(req, res));

// Handle edit form submission (POST for compatibility)
router.post("/courses/:id/edit", (req, res) => hubspotController.updateCourse(req, res));

export default router;