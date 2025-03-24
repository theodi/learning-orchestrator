const express = require("express");
const router = express.Router();
const axios = require("axios");
const Ajv = require('ajv');
const path = require('path');
const fs = require('fs');

const { ensureAuthenticated } = require('../middleware/auth');

// Fetch data from Forecast API
async function getForecastData(type) {
  const apiKey = process.env.FORECAST_API_KEY;
  const apiUrl = `https://api.forecast.it/api/v1/${type}`;

  try {
    const response = await axios.get(apiUrl, {
      headers: { "X-FORECAST-API-KEY": apiKey },
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching Forecast ${type}:`, error.response?.data || error.message);
    throw error;
  }
}

// Function to get a list of schema files from the 'schemas' directory
function getSchemaFiles() {
    const schemasDirectory = path.join(__dirname, '../schemas');
    const files = fs.readdirSync(schemasDirectory);
    return files.map((file) => path.parse(file).name);
}

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

router.get('/', ensureAuthenticated, function(req, res) {
    const page = {
        title: "Browse"
      };
    res.locals.page = page;

    res.render('pages/forecast/browse')
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

router.get('/schemas', (req, res) => {
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

router.get('/schemas/:schemaType', (req, res) => {
    const { schemaType } = req.params;
    const schemaFilePath = path.join(__dirname, '../schemas', `${schemaType}.json`);
    res.json(require(schemaFilePath));
});

// POST /forecast/import → Import data into Forecast
router.post("/import", async (req, res) => {
  const { type } = req.query;
  const apiKey = process.env.FORECAST_API_KEY;
  const apiUrl = `https://api.forecast.it/api/v3/${type}s`;

  try {
    const response = await axios.post(apiUrl, req.body, {
      headers: {
        "Content-Type": "application/json",
        "X-FORECAST-API-KEY": apiKey,
      },
    });

    res.status(response.status).json({ success: true, data: response.data });
  } catch (error) {
    console.error("Error importing data into Forecast:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to import data into Forecast",
      details: error.response?.data || error.message,
    });
  }
});

router.get('/import', ensureAuthenticated, function(req, res) {
    const page = {
        title: "Import"
      };
    res.locals.page = page;
  res.render('pages/forecast/import');
});

// GET /forecast/:type → Fetch Forecast Data
router.get("/:type", async (req, res) => {
  const { type } = req.params;
  const validTypes = ["labels", "projects", "tasks", "persons"];

  if (!validTypes.includes(type)) {
    const error = new Error("Not Found");
    error.status = 404;
    next(error);
  }

  try {
    const data = await getForecastData(type);
    const acceptHeader = req.get("accept");

    if (acceptHeader.includes("text/csv")) {
      res.set("Content-Type", "text/csv");
      res.send(data.map(row => Object.values(row).join(",")).join("\n"));
    } else if (acceptHeader.includes("application/json")) {
      res.json(data);
    } else {
      const page = {
          title: type
        };
      res.locals.page = page;
      res.locals.type = type;
      res.render("pages/forecast/datatable", { data, type });
    }
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;