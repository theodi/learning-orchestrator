//Loads the config fomr config.env to process.env (turn off prior to deployment)
require("dotenv").config({ path: "./config.env" });
// index.js

/*  EXPRESS */

const express = require('express');
const app = express();
const session = require('express-session');
const Ajv = require('ajv');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
app.set('view engine', 'ejs');

app.use(session({
  resave: false,
  saveUninitialized: true,
  secret: 'SECRET'
}));
app.use(express.json());

//Put the user object in a global veriable so it can be accessed from templates
app.use(function(req, res, next) {
  try {
    res.locals.user = req.session.passport.user;
    next();
  } catch (error) {
    res.locals.user = req.session.user;
    next();
  }
});

/* Setup public directory
 * Everything in her does not require authentication */

app.use(express.static(__dirname + '/public'));

app.get('/', function(req, res) {
  if (req.session.passport) {
    res.redirect("/profile");
  } else {
    res.locals.pageTitle ="ODI Template (NodeJS + Express + OAuth)";
    res.render('pages/auth');
  }
});

/*  PASSPORT SETUP  */

const passport = require('passport');

app.use(passport.initialize());
app.use(passport.session());

app.set('view engine', 'ejs');

app.post('/logout', function(req, res, next){
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

app.get('/error', (req, res) => res.send("error logging in"));

passport.serializeUser(function(user, cb) {
  cb(null, user);
});

passport.deserializeUser(function(obj, cb) {
  cb(null, obj);
});

/*  Google AUTH  */

const GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: "http://localhost:3080/auth/google/callback"
  },
  function(accessToken, refreshToken, profile, done) {
        return done(null, profile);
  }
));

app.get('/auth/google',
  passport.authenticate('google', { scope : ['profile', 'email'] }));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/error' }),
  function(req, res) {
    //console.log(req.user);
    // Successful authentication, redirect success.
    // Redirects to the profile page, CHANGE THIS to redirect to another page, e.g. a tool that is protected
    res.redirect('/profile');
  });


/* Setup function to handle authentications */

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated())
    return next();
  else
    unauthorised(res);
}

function unauthorised(res) {
  res.locals.pageTitle ="401 Unauthorised";
  return res.status(401).render("errors/401");
}

/* Setup private directory, everything in here requires authentication */

app.use('/private', ensureAuthenticated);
app.use('/private', express.static(__dirname + '/private'));

/* Define all the pages */

// Function to get a list of schema files from the 'schemas' directory
function getSchemaFiles() {
  const schemasDirectory = path.join(__dirname, 'schemas');
  const files = fs.readdirSync(schemasDirectory);
  return files.map((file) => path.parse(file).name);
}

app.get('/schemas', (req, res) => {
  const acceptHeader = req.headers.accept;
  const schemaFiles = getSchemaFiles();

  if (acceptHeader.includes('text/html')) {
    // Respond with HTML list
    const htmlList = `<ul>${schemaFiles.map((file) => `<li>${file}</li>`).join('')}</ul>`;
    return res.status(200).send(htmlList);
  } else if (acceptHeader.includes('application/json')) {
    // Respond with JSON array
    return res.status(200).json(schemaFiles);
  } else if (acceptHeader.includes('text/csv')) {
    // Respond with CSV list
    const csvList = schemaFiles.join(',');
    return res.status(200).send(csvList);
  } else {
    // Unsupported accept header
    return res.status(406).send('Not Acceptable. Supported formats: text/html, application/json, text/csv');
  }
});

app.get('/schemas/:schemaType', (req, res) => {
  const { schemaType } = req.params;
  const schemaFilePath = path.join(__dirname, 'schemas', `${schemaType}.json`);
  console.log(schemaFilePath);
  res.json(require(schemaFilePath));
});

/* Require user to be logged in */

app.get('/profile', function(req, res) {
  if (!req.isAuthenticated()) {
    res.locals.pageTitle ="401 Unauthorised";
    return res.status(401).render("errors/401");
  }
  res.locals.pageTitle ="Profile page";

  res.render('pages/profile')
});


app.get('/browse', function(req, res) {
  if (!req.isAuthenticated()) {
    res.locals.pageTitle ="401 Unauthorised";
    return res.status(401).render("errors/401");
  }
  res.locals.pageTitle ="Browse";

  res.render('pages/browse')
});

// Function to respond with JSON data
function respondWithJson(req, res, data) {
  res.json(data);
}

// Function to respond with CSV data
function respondWithCsv(req, res, data) {
  stringify(data, { header: true }, (err, csvString) => {
    if (err) {
      res.status(500).json({ error: 'Internal Server Error' });
    } else {
      res.set('Content-Type', 'text/csv');
      res.send(csvString);
    }
  });
}

// Function to get data from the Forecast API
async function getForecastData(type) {
  const apiKey = process.env.FORECAST_API_KEY;
  const apiUrl = `https://api.forecast.it/api/v1/${type}`;
  const response = await axios.get(apiUrl, {
    headers: {
      'X-FORECAST-API-KEY': apiKey,
    },
  });
  console.log(response.data);
  return response.data;
}

app.get('/import', function(req, res) {
  if (!req.isAuthenticated()) {
    res.locals.pageTitle ="401 Unauthorised";
    return res.status(401).render("errors/401");
  }
  res.locals.pageTitle ="Import";
  res.render('pages/import');
});

// POST request handler for /import?type=task endpoint
app.post('/import', async (req, res) => {
  if (!req.isAuthenticated()) {
    res.locals.pageTitle ="401 Unauthorised";
    return res.status(401).render("errors/401");
  }
  const { type } = req.query;
  const apiKey = process.env.FORECAST_API_KEY;
  //Fix this. needs to be based upon the schema type!
  const apiUrl = 'https://api.forecast.it/api/v3/tasks';

  try {
    // Send the JSON data to the forecast.it API using Axios
    const response = await axios.post(apiUrl, req.body, {
      headers: {
        'Content-Type': 'application/json',
        'X-FORECAST-API-KEY': apiKey,
      },
    });

    // Return the response from the API to the frontend
    res.status(response.status).json({ success: true, data: response.data });
  } catch (error) {
    // Return the error details if the API call fails
    response = error.response;
    console.log(response.status);
    console.log(response.data.message);
    res.status(response.status).json({ success: false, error: response.data.message });
  }
});

// Function to validate JSON against the schema
function validateJSONAgainstSchema(data) {
  const validate = ajv.compile(jsonSchema);
  const isValid = validate(data);
  return isValid ? null : validate.errors;
}

function loadSchema(type) {
  const schemaPath = path.join(__dirname, 'schemas', `${type}.json`);
  try {
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');
    return JSON.parse(schemaContent);
  } catch (error) {
    throw new Error(`Failed to load schema for type: ${type}`);
  }
}

function validateJSONAgainstSchema(data, schema) {
  const validate = ajv.compile(schema);
  const isValid = validate(data);
  return isValid ? null : validate.errors;
}

app.post('/import', (req, res) => {
  if (!req.isAuthenticated()) {
    res.locals.pageTitle ="401 Unauthorised";
    return res.status(401).render("errors/401");
  }
  try {
    const { type, data } = req.body;

    if (!type || !data) {
      return res.status(400).send('Type and/or data missing in the request body.');
    }

    // Load the JSON schema based on the type parameter
    const jsonSchema = loadSchema(type);

    // Validate JSON against the schema
    const validationErrors = validateJSONAgainstSchema(data, jsonSchema);

    if (validationErrors) {
      return res.status(400).json({ errors: validationErrors });
    }

    // At this point, the JSON is valid, and you can do further processing with data
    // For example, you might save it to a database or perform additional operations.

    return res.status(200).send('JSON data imported successfully.');
  } catch (error) {
    console.error('Error processing the JSON data:', error);
    return res.status(500).send('Internal Server Error.');
  }
});

// GET request handler for /:type endpoint (e.g., /tasks, /projects, /labels)
app.get('/:type', async (req, res) => {
  if (!req.isAuthenticated()) {
    res.locals.pageTitle ="401 Unauthorised";
    return res.status(401).render("errors/401");
  }
  const { type } = req.params;
  try {
    const data = await getForecastData(type);

    // Check the accept header for content negotiation
    const acceptHeader = req.get('accept');
    if (acceptHeader.includes('text/csv')) {
      // Respond with CSV data
      respondWithCsv(req, res, data);
    } else if (acceptHeader.includes('application/json')) {
      // Respond with JSON data
      respondWithJson(req, res, data);
    } else {
      // Render the EJS page with DataTables table
      res.locals.type = type;
      res.locals.pageTitle = type;
      res.render('pages/datatable', { data, type });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//Keep this at the END!
app.get('*', function(req, res){
  res.locals.pageTitle ="404 Not Found";
  return res.status(404).render("errors/404");
});

/* Run server */

const port = process.env.PORT || 3080;
app.listen(port , () => console.log('App listening on port ' + port));
