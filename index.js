const path = require('path');
const fs = require('fs');
//Loads the config fomr config.env to process.env (turn off prior to deployment)
require("dotenv").config({ path: "./config.env" });

const axios = require('axios');
const express = require('express');
const session = require('express-session');
const passport = require('./passport'); // Require the passport module
const authRoutes = require('./routes/auth'); // Require the authentication routes module

const { ensureAuthenticated } = require('./middleware/auth');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');

// Session configuration
app.use(session({
  resave: false,
  saveUninitialized: true,
  secret: process.env.SESSION_SECRET,
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

/* Setup public directory
 * Everything in her does not require authentication */

app.use(express.static(__dirname + '/public'));

// Use authentication routes
app.use('/auth', authRoutes);

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
const forecastRoutes = require("./routes/forecast");
app.use("/forecast", ensureAuthenticated, forecastRoutes);

// Other routes
app.post('/webhooks/form', async (req, res) => {
  // Extract the API key from headers or query parameters
  const apiKey = req.headers['x-api-key'] || req.query.api_key;

  // Validate the API key
  if (!apiKey || apiKey !== process.env.WEBHOOK_API_KEY) {
    return res.status(403).json({ error: "Forbidden: Invalid API key" });
  }

  // Extract project ID from query parameters
  const { project_id } = req.query;

  // Validate project_id
  if (!project_id || isNaN(parseInt(project_id))) {
    return res.status(400).json({ error: "Invalid or missing project_id" });
  }

  // Extract HubSpot webhook payload
  const {
    hs_form_title,
    hs_form_id,
    role,
    email,
    label,
    last_name,
    first_name,
    organisation
  } = req.body;

  // Validate required fields
  if (!hs_form_title || !hs_form_id || !first_name || !last_name || !email) {
    return res.status(400).json({ error: "Missing required fields in webhook payload" });
  }

  // Construct the link using hs_form_id
  const portalId = "748510"; // Replace with your actual HubSpot portal ID
  const formSubmissionLink = `https://app.hubspot.com/submissions/${portalId}/form/${hs_form_id}/submissions`;

  // Prepare the task data for the Forecast API
  const taskData = {
    title: `${first_name} ${last_name} | ${hs_form_title}`,
    description: `
      <strong>Form:</strong> ${hs_form_title}<br/>
      <strong>Name:</strong> ${first_name} ${last_name}<br/>
      <strong>Email:</strong> ${email}<br/>
      <strong>Organisation:</strong> ${organisation}<br/>
      <strong>Role:</strong> ${role || "Not provided"}<br/>
      <strong>Label:</strong> ${label || "Not provided"}<br/>
      <strong>Submission Link:</strong> <a href="${formSubmissionLink}" target="_blank">${formSubmissionLink}</a>
    `.trim(),
    project_id: parseInt(project_id), // Convert to integer
    approved: true // Default to approved
  };

  try {
    // Send the task data to the Forecast API
    const forecastApiKey = process.env.FORECAST_API_KEY;
    const apiUrl = 'https://api.forecast.it/api/v3/tasks';

    const response = await axios.post(apiUrl, taskData, {
      headers: {
        'Content-Type': 'application/json',
        'X-FORECAST-API-KEY': forecastApiKey,
      },
    });

    // Respond with success
    res.status(response.status).json({ success: true, data: response.data });
  } catch (error) {
    console.error('Error creating task in Forecast:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to create task in Forecast', details: error.response?.data || error.message });
  }
});

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
app.listen(port , () => console.log('App listening on port ' + port));