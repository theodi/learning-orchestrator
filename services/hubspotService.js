const axios = require("axios");

const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;
const HUBSPOT_BASE_URL = "https://api.hubapi.com";
const crypto = require('crypto');


const headers = {
  Authorization: `Bearer ${HUBSPOT_API_KEY}`,
  "Content-Type": "application/json",
};

/**
 * Fetch all HubSpot products
 */
async function fetchProductsFromHubSpot() {
  const baseUrl = `${HUBSPOT_BASE_URL}/crm/v3/objects/products`;
  const allProducts = [];
  let after = null;
  let hasMore = true;

  try {
    while (hasMore) {
      const url = `${baseUrl}?limit=100${after ? `&after=${after}` : ""}`;
      const response = await axios.get(url, { headers });

      const results = response.data.results || [];
      allProducts.push(
        ...results.map((product) => ({
          id: product.id,
          name: product.properties.name,
        }))
      );

      after = response.data.paging?.next?.after;
      hasMore = !!after;
    }

    return allProducts;
  } catch (error) {
    console.error("Error fetching HubSpot products:", error.response?.data || error.message);
    throw error;
  }
}

/**
 * Fetch all HubSpot companies
 */
let cachedCompanies = null;
let lastFetched = 0;

async function searchCompaniesByName(term) {
  const now = Date.now();
  const cacheKey = `search:${term.toLowerCase()}`;
  const cacheDuration = 1000 * 60 * 10; // 10 minutes

  // Use an in-memory cache object
  global.companySearchCache = global.companySearchCache || {};
  const cached = global.companySearchCache[cacheKey];

  if (cached && now - cached.fetched < cacheDuration) {
    return cached.data;
  }

  const url = `${HUBSPOT_BASE_URL}/crm/v3/objects/companies/search`;

  const payload = {
    filterGroups: [
      {
        filters: [
          {
            propertyName: "name",
            operator: "CONTAINS_TOKEN",
            value: term
          }
        ]
      }
    ],
    properties: ["name"],
    limit: 100
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${HUBSPOT_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const results = response.data.results.map(company => ({
      id: company.id,
      name: company.properties.name,
    }));

    // Cache the result
    global.companySearchCache[cacheKey] = {
      fetched: now,
      data: results
    };

    return results;
  } catch (error) {
    console.error("Error searching companies:", error.response?.data || error.message);
    return [];
  }
}


async function fetchCompaniesFromHubSpotBatch(after = null) {
  const baseUrl = `${HUBSPOT_BASE_URL}/crm/v3/objects/companies?limit=100${after ? `&after=${after}` : ''}`;

  try {
    const response = await axios.get(baseUrl, { headers });

    const companies = response.data.results.map(company => ({
      id: company.id,
      name: company.properties.name,
    }));

    return {
      companies,
      nextAfter: response.data.paging?.next?.after || null
    };
  } catch (error) {
    console.error("Error fetching companies:", error.response?.data || error.message);
    return { companies: [], nextAfter: null };
  }
}



/**
 * Fetch deal by ID (or extend to fetch multiple deals)
 */
async function fetchDealById(dealId) {
  const url = `${HUBSPOT_BASE_URL}/crm/v3/objects/deals/${dealId}?properties=dealname,amount,closedate`;

  try {
    const response = await axios.get(url, { headers });
    return response.data;
  } catch (error) {
    console.error(`Error fetching deal ${dealId}:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Create a HubSpot contact
 */
async function createContact({ firstName, lastName, email, phone }) {
  const url = `${HUBSPOT_BASE_URL}/crm/v3/objects/contacts`;

  const data = {
    properties: {
      firstname: firstName,
      lastname: lastName,
      email,
      phone,
    },
  };

  try {
    const response = await axios.post(url, data, { headers });
    return response.data;
  } catch (error) {
    console.error("Error creating HubSpot contact:", error.response?.data || error.message);
    throw error;
  }
}

/**
 * Process HubSpot webhook payload
 */
function handleWebhook(req) {
  const event = req.body;
  console.log("Received HubSpot Webhook Event:", JSON.stringify(event, null, 2));

  // Example: return useful event info
  return {
    objectType: event.objectType,
    objectId: event.objectId,
    eventType: event.subscriptionType,
    timestamp: event.occurredAt,
  };
}

//HubSpot signature
function verifyWebhookSignature(req, secret) {
  const signature = req.headers['x-hubspot-signature-v3'];
  const requestBody = JSON.stringify(req.body);
  const requestUri = req.originalUrl;

  const sourceString = `${requestUri}${requestBody}`;
  const computedSignature = crypto
    .createHmac('sha256', secret)
    .update(sourceString)
    .digest('hex');

  return signature === computedSignature;
}


module.exports = {
  fetchProductsFromHubSpot,
  fetchCompaniesFromHubSpotBatch,
  fetchDealById,
  createContact,
  handleWebhook,
  searchCompaniesByName
};
