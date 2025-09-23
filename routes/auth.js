import express from 'express';
import passport from '../passport.js';
import { ensureAuthenticated } from '../middleware/auth.js';
import AuthController from '../controllers/AuthController.js';

const router = express.Router();
const authController = new AuthController();

// Authentication route for Google (enable state to mitigate CSRF)
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'], state: true })
);

// Authentication route for Django
router.get('/django',
  passport.authenticate('django')
);

// Callback endpoint for Google authentication
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/error' }),
  (req, res) => authController.googleCallback(req, res)
);

// Callback endpoint for Django authentication
router.get('/django/callback',
  passport.authenticate('django', { failureRedirect: '/error' }),
  (req, res) => authController.djangoCallback(req, res)
);

// Profile page
router.get('/profile', ensureAuthenticated, (req, res) => authController.profile(req, res));

// Logout
router.get('/logout', ensureAuthenticated, (req, res) => authController.logout(req, res));

// Get current user
router.get('/me', ensureAuthenticated, (req, res) => authController.getCurrentUser(req, res));

export default router;