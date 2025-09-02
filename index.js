import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
//Loads the config fomr config.env to process.env (turn off prior to deployment)
import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import axios from 'axios';
import express from 'express';
import session from 'express-session';
import passport from './passport.js'; // Import the passport module
import authRoutes from './routes/auth.js'; // Import the authentication routes module

import { ensureAuthenticated } from './middleware/auth.js';
import { connectDB } from './config/database.js';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.set('view engine', 'ejs');

// Session configuration
app.use(session({
  resave: false,
  saveUninitialized: false, // Only create sessions for authenticated users
  secret: process.env.SESSION_SECRET,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Only use HTTPS in production
    httpOnly: true, // Prevent XSS access to cookies
    sameSite: 'lax', // Allow cross-site requests for OAuth callbacks
    maxAge: 24 * 60 * 60 * 1000 // 24 hour session timeout
  },
  name: 'odi-session' // Change default session cookie name
}));

// Initialize Passport.js
app.use(passport.initialize());
app.use(passport.session());

app.use(function(req, res, next) {
  res.locals.user = req.session.passport ? req.session.passport.user : req.session.user;
  next();
});

app.use((req, res, next) => {
  // Read package.json file
  fs.readFile(path.join(__dirname, 'package.json'), 'utf8', (err, data) => {
      if (err) {
          console.error('Error reading package.json:', err);
          return next();
      }

      try {
          const packageJson = JSON.parse(data);
          // Extract version from package.json
          var software = {};
          software.version = packageJson.version;
          software.homepage = packageJson.homepage;
          software.versionLink = packageJson.homepage + "/releases/tag/v" + packageJson.version;
          res.locals.software = software;
      } catch (error) {
          console.error('Error parsing package.json:', error);
      }
      next();
  });
});

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); // HTTP 1.1.
  res.setHeader('Pragma', 'no-cache'); // HTTP 1.0.
  res.setHeader('Expires', '0'); // Proxies.
  next();
});

// Security headers and middleware
app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Remove server information
  res.removeHeader('X-Powered-By');
  
  next();
});

/* Setup public directory
 * Everything in her does not require authentication */

app.use(express.static(__dirname + '/public'));

// Use authentication routes
app.use('/auth', authRoutes);

// Basic rate limiting for authentication endpoints
app.use('/auth', (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  // Simple in-memory rate limiting (for development)
  if (!req.app.locals.rateLimit) {
    req.app.locals.rateLimit = new Map();
  }
  
  const clientData = req.app.locals.rateLimit.get(clientIP) || { count: 0, resetTime: now + 15 * 60 * 1000 };
  
  if (now > clientData.resetTime) {
    clientData.count = 1;
    clientData.resetTime = now + 15 * 60 * 1000;
  } else {
    clientData.count++;
  }
  
  req.app.locals.rateLimit.set(clientIP, clientData);
  
  if (clientData.count > 100) { // 100 requests per 15 minutes
    return res.status(429).json({ error: 'Too many requests' });
  }
  
  next();
});

// Basic input sanitization middleware
app.use((req, res, next) => {
  // Sanitize query parameters
  if (req.query) {
    Object.keys(req.query).forEach(key => {
      if (typeof req.query[key] === 'string') {
        req.query[key] = req.query[key].trim().replace(/[<>]/g, '');
      }
    });
  }
  
  // Sanitize body parameters (for non-file uploads)
  if (req.body && req.headers['content-type'] !== 'multipart/form-data') {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = req.body[key].trim().replace(/[<>]/g, '');
      }
    });
  }
  
  next();
});

app.get('/', function(req, res) {
  const page = {
    title: "ODI Forecast Helper",
    link: "/"
  };
  res.locals.page = page;
  res.render('pages/home');
});

/* Setup private directory, everything in here requires authentication */

app.use('/private', ensureAuthenticated);
app.use('/private', express.static(__dirname + '/private'));

// Import Routes
import forecastRoutes from "./routes/forecast.js";
app.use("/forecast", ensureAuthenticated, forecastRoutes);

import hubspotRoutes from "./routes/hubspot.js";
app.use("/hubspot", ensureAuthenticated, hubspotRoutes);

import calendarRoutes from "./routes/calendar.js";
app.use("/calendar", ensureAuthenticated, calendarRoutes);

import courseBookingsRoutes from "./routes/courseBookings.js";
app.use("/course-bookings", ensureAuthenticated, courseBookingsRoutes);

// Webhooks (public, authenticated by API key inside controller)
import webhooksRoutes from "./routes/webhooks.js";
app.use("/webhooks", webhooksRoutes);

//Keep this at the END!
app.get('*', function(req, res, next){
  const page = {
    title: "404 Not Found"
  };
  res.locals.page = page;
  const error = new Error("Not Found");
  error.status = 404;
  next(error);
});

// Error handling middleware
app.use((err, req, res, next) => {
  // Default status code for unhandled errors
  console.log(err);
  let statusCode = 500;
  let errorMessage = "Internal Server Error";
  // Check if the error has a specific status code and message
  if (err.status) {
      statusCode = err.status;
      errorMessage = err.message;
  }
  const page = {
    title: "Error"
  };
  res.locals.page = page;

  // Log the error stack trace
  //console.error(err.stack);

  // Content negotiation based on request Accept header
  const acceptHeader = req.get('Accept');

  if (acceptHeader === 'application/json') {
      // Respond with JSON
      res.status(statusCode).json({ message: errorMessage });
  } else {
      // Respond with HTML (rendering an error page)
      res.status(statusCode).render('errors/error', { statusCode, errorMessage });
  }
});


/* Run server */

const port = process.env.PORT || 3080;

// Connect to MongoDB before starting the server
const startServer = async () => {
  try {
    await connectDB();
    app.listen(port, () => console.log('App listening on port ' + port));
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();