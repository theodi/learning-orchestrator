// authRoutes.js

const express = require('express');
const passport = require('../passport'); // Require the passport module

const { ensureAuthenticated } = require('../middleware/auth');

const router = express.Router();

// Authentication route for Google
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Authentication route for Django
router.get('/django',
  passport.authenticate('django')
);

// Callback endpoint for Google authentication
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/error' }),
  async (req, res) => {
    req.session.authMethod = 'google';
    res.redirect('/auth/profile');
  }
);

// Callback endpoint for Django authentication
router.get('/django/callback',
  passport.authenticate('django', { failureRedirect: '/error' }),
  async (req, res) => {
    req.session.authMethod = 'django';
    await processLogin(req);
    res.redirect('/auth/profile');
  }
);

router.get('/profile', ensureAuthenticated, async (req, res) => {
  const page = {
    title: "Profile page",
    link: "/profile"
  };
  res.locals.page = page;
  res.render('pages/auth/profile');
});

module.exports = router;