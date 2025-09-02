// Auth controller

import BaseController from './BaseController.js';
import User from '../models/User.js';

export class AuthController extends BaseController {
  constructor() {
    super();
  }

  // Profile page
  async profile(req, res) {
    return this.renderPage(req, res, 'pages/auth/profile', {
      title: 'Profile Page',
      link: '/profile'
    });
  }

  // Google auth callback
  async googleCallback(req, res) {
    try {
      req.session.authMethod = 'google';
      res.redirect('/auth/profile');
    } catch (error) {
      res.redirect('/error');
    }
  }

  // Django auth callback
  async djangoCallback(req, res) {
    try {
      req.session.authMethod = 'django';
      // TODO: Implement processLogin if needed
      res.redirect('/auth/profile');
    } catch (error) {
      res.redirect('/error');
    }
  }

  // Logout
  async logout(req, res) {
    req.logout((err) => {
      if (err) {
        return this.sendError(res, 'Error during logout');
      }
      res.redirect('/');
    });
  }

  // Get current user
  async getCurrentUser(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Not authenticated', 401);
      }

      const user = new User(req.user);
      return this.sendSuccess(res, user.toJSON());
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }
}

export default AuthController;
