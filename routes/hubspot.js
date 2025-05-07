const express = require("express");
const router = express.Router();
const axios = require("axios");
const { ensureAuthenticated } = require('../middleware/auth');
const { fetchForecastUsers } = require('../services/forecastService');
const { fetchProductsFromHubSpot } = require('../services/hubspotService');
const { fetchCompaniesFromHubSpotBatch } = require('../services/hubspotService');
const { searchCompaniesByName } = require('../services/hubspotService');
const { createContact } = require('../services/hubspotService');
const { fetchDealById } = require('../services/hubspotService');
const { handleWebhook, verifyWebhookSignature } = require('../services/hubspotService');



const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;
const HUBSPOT_WEBHOOK = process.env.HUBSPOT_WEBHOOK;

router.get('/', ensureAuthenticated, function(req, res) {
    const page = {
        title: "Browse"
      };
    res.locals.page = page;

    res.render('pages/hubspot/browse')
});

router.get('/form', ensureAuthenticated, async (req, res) => {
  try {
    //const { q } = req.query;
    //if (!q) return res.status(400).json({ error: "Missing query param `q`" });

    const products = await fetchProductsFromHubSpot();
    const tutors = await fetchForecastUsers();
    const companies = await fetchCompaniesFromHubSpotBatch();
    //const companies = await searchCompaniesByName(q);

    res.locals.page = { title: "HubSpot Form" };
    res.render('pages/hubspot/form', { products, tutors, companies });
  } catch (error) {
    console.error("Error loading form:", error.message);
    res.status(500).send("Failed to load form");
  }
});

router.get('/companies/search', ensureAuthenticated, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Missing query param `q`" });

  try {
    const companies = await searchCompaniesByName(q);
    res.json(companies);
  } catch (error) {
    console.error("Error searching companies:", error.message);
    res.status(500).json({ error: "Failed to search companies" });
  }
});





router.get('/hubspot/deals/:id', async (req, res) => {
  try {
    const deal = await fetchDealById(req.params.id);
    res.json(deal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/companies', ensureAuthenticated, async (req, res) => {
  const after = req.query.after || null;

  try {
    const result = await fetchCompaniesFromHubSpotBatch(after);
    res.json(result); // returns { companies: [...], nextAfter: 'abc123' }
  } catch (error) {
    console.error("Error fetching companies:", error.message);
    res.status(500).json({ error: "Failed to fetch companies" });
  }
});


// Handle form submission — POST /hubspot/form
router.post('/form', ensureAuthenticated, async (req, res) => {
  try {
    const {
      sub_client,
      course_location,
      course_name,
      course_datetime,
      course_duration,
      tutor_name,
      tutor_email,
      booking_ref,
      client_requestor,
      client_requestor_email,
      value,
      completed_by_name,
      completed_by_email,
      submission_timestamp
    } = req.body;

    //Basic field validation
    const requiredFields = {
      sub_client,
      course_location,
      course_name,
      course_datetime,
      course_duration,
      tutor_name,
      tutor_email,
      booking_ref,
      client_requestor,
      client_requestor_email,
      value,
      completed_by_name,
      completed_by_email,
      submission_timestamp
    };

    const missingFields = Object.entries(requiredFields)
      .filter(([key, val]) => !val || val.trim?.() === '')
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return res.status(400).render('pages/hubspot/error', {
        page: { title: "Validation Error" },
        message: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    //Prepare payload
    const payload = { ...requiredFields };

    //Send to Zapier
    const zapierWebhookUrl = HUBSPOT_WEBHOOK;
    let zapierResponse = null;

    try {
      zapierResponse = await axios.post(zapierWebhookUrl, payload);
    } catch (error) {
      // Fallback logging if Zapier fails
      console.error("Zapier webhook failed:", error.response?.data || error.message);
      fs.appendFileSync('logs/zapier-fallback.log', JSON.stringify({ payload, error: error.message, time: new Date() }) + '\n');
    }

    //Show form submission log 
    console.log(payload);

    //Show success page with submitted values
    res.render('pages/hubspot/success', {
      page: { title: "Form Submitted" },
      message: "Form submitted successfully!",
      data: payload // Pass the data to show in the view
    });

  } catch (err) {
    console.error("Unexpected error:", err.message);
    res.status(500).render('pages/hubspot/error', {
      page: { title: "Error" },
      message: "An unexpected error occurred while processing your submission."
    });
  }
});



router.post('/hubspot/create-contact', async (req, res) => {
  try {
    const contact = await createContact(req.body);
    res.json({ success: true, contact });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});



router.post('/hubspot/webhook', (req, res) => {
  const webhookSecret = process.env.HUBSPOT_WEBHOOK_SECRET;

  // Verify the request signature
  const isValid = verifyWebhookSignature(req, webhookSecret);

  if (!isValid) {
    console.warn('Invalid HubSpot webhook signature');
    return res.status(403).send('Forbidden: Invalid signature');
  }

  const event = handleWebhook(req);

  // Do something with the event...
  console.log('Valid webhook received:', event);

  res.status(200).send('Webhook received');
});

// GET /hubspot/courses → View list of courses in DataTable
router.get("/products", ensureAuthenticated, async (req, res) => {
  try {
    const data = await fetchProductsFromHubSpot();
    res.locals.page = { title: "HubSpot Products" };
    res.locals.type = "products";
    res.render("pages/forecast/datatable", { data, type: "products" });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch courses", details: error.message });
  }
});

router.get("/products/:productId/deals", ensureAuthenticated, async (req, res) => {
    const productId = req.params.productId;

    try {
      // Step 1: Search for line items referencing this product
      const searchResponse = await axios.post(
        "https://api.hubapi.com/crm/v3/objects/line_items/search",
        {
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "hs_product_id",
                  operator: "EQ",
                  value: productId
                }
              ]
            }
          ],
          properties: ["name", "hs_product_id", "price", "quantity"],
          limit: 100
        },
        {
          headers: {
            Authorization: `Bearer ${HUBSPOT_API_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );

      const lineItems = searchResponse.data.results || [];

      if (lineItems.length === 0) {
        return res.render("pages/forecast/datatable", {
          data: [],
          type: "deals",
          page: { title: `No deals found for product ${productId}` },
          hubspotPortalId: process.env.HUBSPOT_PORTAL_ID
        });
      }

      // Step 2: For each line item, get associated deals
      const dealIds = new Set();

      await Promise.all(
        lineItems.map(async (item) => {
          const assocRes = await axios.get(
            `https://api.hubapi.com/crm/v3/objects/line_items/${item.id}/associations/deals`,
            {
              headers: {
                Authorization: `Bearer ${HUBSPOT_API_KEY}`
              }
            }
          );
          assocRes.data.results.forEach(d => dealIds.add(d.id));
        })
      );

      // Step 3: Fetch deal details
      const deals = await Promise.all(
        Array.from(dealIds).map(async (id) => {
          const dealRes = await axios.get(
            `https://api.hubapi.com/crm/v3/objects/deals/${id}?properties=dealname,amount,closedate`,
            {
              headers: {
                Authorization: `Bearer ${HUBSPOT_API_KEY}`
              }
            }
          );
          return {
            id,
            ...dealRes.data.properties
          };
        })
      );

      res.locals.page = { title: `Deals for Product ${productId}` };
      res.locals.type = "deals";
      // Pass the portal id so the view can build links to HubSpot
      res.locals.hubspotPortalId = process.env.HUBSPOT_PORTAL_ID;
      res.render("pages/forecast/datatable", { data: deals, type: "deals" });

    } catch (error) {
      console.error("Error fetching deals for product:", error.response?.data || error.message);
      res.status(500).json({
        error: "Failed to fetch deals",
        details: error.response?.data || error.message
      });
    }
  });


module.exports = router;
