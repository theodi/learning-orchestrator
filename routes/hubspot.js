const express = require("express");
const router = express.Router();
const axios = require("axios");
const { ensureAuthenticated } = require('../middleware/auth');

const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;

async function fetchProductsFromHubSpot() {
    const baseUrl = "https://api.hubapi.com/crm/v3/objects/products";
    const allProducts = [];
    let after = null;
    let hasMore = true;

    try {
      while (hasMore) {
        const url = `${baseUrl}?limit=100${after ? `&after=${after}` : ''}`;

        const response = await axios.get(url, {
          headers: {
            Authorization: `Bearer ${HUBSPOT_API_KEY}`,
            "Content-Type": "application/json",
          },
        });

        const results = response.data.results || [];
        allProducts.push(...results.map(product => ({
          id: product.id,
          name: product.properties.name,
        })));

        // Check if there's more
        if (response.data.paging && response.data.paging.next && response.data.paging.next.after) {
          after = response.data.paging.next.after;
        } else {
          hasMore = false;
        }
      }

      return allProducts;

    } catch (error) {
      console.error("Error fetching HubSpot products:", error.response?.data || error.message);
      throw error;
    }
  }

router.get('/', ensureAuthenticated, function(req, res) {
    const page = {
        title: "Browse"
      };
    res.locals.page = page;

    res.render('pages/hubspot/browse')
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
          page: { title: `No deals found for product ${productId}` }
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
          const res = await axios.get(
            `https://api.hubapi.com/crm/v3/objects/deals/${id}?properties=dealname,amount,closedate`,
            {
              headers: {
                Authorization: `Bearer ${HUBSPOT_API_KEY}`
              }
            }
          );
          return {
            id,
            ...res.data.properties
          };
        })
      );

      res.locals.page = { title: `Deals for Product ${productId}` };
      res.locals.type = "deals";
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
