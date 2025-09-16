import axios from "axios";
import crypto from 'crypto';
import { API_ENDPOINTS, CACHE_DURATION } from '../config/constants.js';

export class HubSpotService {
  constructor() {
    this.apiKey = process.env.HUBSPOT_API_KEY;
    this.baseUrl = API_ENDPOINTS.HUBSPOT.BASE_URL;
    this.webhookUrl = process.env.HUBSPOT_WEBHOOK;
    this.headers = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  /**
 * Fetch all HubSpot products
 * @param {string|null} productType - Optional product type filter (e.g., "Learning Course")
 */
  // Convert HubSpot ISO8601 period (e.g., "P24M") to number of months
  parseHubspotPeriod(period) {
    if (!period) return null;
    const str = String(period).trim();
    const match = str.match(/^P(\d+)M$/i);
    if (match) return parseInt(match[1], 10);
    const asNumber = Number(str);
    return Number.isFinite(asNumber) ? asNumber : null;
  }

  // Build HubSpot ISO8601 period string from number of months
  buildHubspotPeriod(months) {
    const n = parseInt(months, 10);
    return Number.isFinite(n) && n > 0 ? `P${n}M` : '';
  }

  async fetchProducts(productType = null) {
    const allProducts = [];
    let after = null;
    let hasMore = true;

    try {
      if (productType) {
        // Use POST /search with filter
        const url = `${this.baseUrl}/crm/v3/objects/products/search`;

        while (hasMore) {
          const body = {
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: 'hs_product_type',
                    operator: 'EQ',
                    value: productType
                  }
                ]
              }
            ],
            properties: ['name', 'hs_product_type', 'description', 'price', 'hs_sku', 'hs_recurring_billing_period', 'createdate', 'hs_lastmodifieddate', 'moodle_course_id', 'learning_price_members', 'price__gov_campus_', 'notes', 'learning_course_type'],
            limit: 100,
            ...(after && { after })
          };

          const response = await axios.post(url, body, { headers: this.headers });

          const results = response.data.results || [];
          allProducts.push(
            ...results.map((product) => ({
              id: product.id,
              name: product.properties.name,
              type: product.properties.hs_product_type || null,
              description: product.properties.description || null,
              price: product.properties.price || null,
              sku: product.properties.hs_sku || null,
              billing_period: this.parseHubspotPeriod(product.properties.hs_recurring_billing_period),
              moodle_course_id: product.properties.moodle_course_id || null,
              learning_price_members: product.properties.learning_price_members || null,
              price_gov_campus: product.properties.price__gov_campus_ || null,
              notes: product.properties.notes || '',
              learning_course_type: product.properties.learning_course_type || '',
              created: product.properties.createdate || null,
              modified: product.properties.hs_lastmodifieddate || null
            }))
          );

          after = response.data.paging?.next?.after;
          hasMore = !!after;
        }

      } else {
        // Use GET /objects/products with pagination and more properties
        const url = `${this.baseUrl}/crm/v3/objects/products`;

        while (hasMore) {
          const response = await axios.get(
            `${url}?limit=100&properties=name,hs_product_type,description,price,hs_sku,hs_recurring_billing_period,createdate,hs_lastmodifieddate,moodle_course_id,learning_price_members,price__gov_campus_,notes,learning_course_type${after ? `&after=${after}` : ''}`,
            { headers: this.headers }
          );

          const results = response.data.results || [];
          allProducts.push(
            ...results.map((product) => ({
              id: product.id,
              name: product.properties.name,
              type: product.properties.hs_product_type || null,
              price: product.properties.price || null,
              sku: product.properties.hs_sku || null,
              billing_period: this.parseHubspotPeriod(product.properties.hs_recurring_billing_period),
              moodle_course_id: product.properties.moodle_course_id || null,
              learning_price_members: product.properties.learning_price_members || null,
              price_gov_campus: product.properties.price__gov_campus_ || null,
              notes: product.properties.notes || '',
              learning_course_type: product.properties.learning_course_type || '',
              created: product.properties.createdate || null,
              modified: product.properties.hs_lastmodifieddate || null
            }))
          );

          after = response.data.paging?.next?.after;
          hasMore = !!after;
        }
      }

      return allProducts;
    } catch (error) {
      console.error('Error fetching HubSpot products:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Fetch HubSpot courses (products with type "Learning Course")
   */
  async fetchCourses() {
    return this.fetchProducts('Learning Course');
  }

  /**
   * Get a single product by ID
   */
  async getProduct(productId) {
    try {
      const url = `${this.baseUrl}/crm/v3/objects/products/${productId}`;
      const response = await axios.get(
        `${url}?properties=name,hs_product_type,description,price,hs_sku,hs_recurring_billing_period,moodle_course_id,learning_price_members,price__gov_campus_,notes,learning_course_type`,
        { headers: this.headers }
      );

      const product = response.data;
      return {
        id: product.id,
        name: product.properties.name,
        type: product.properties.hs_product_type || null,
        description: product.properties.description || null,
        price: product.properties.price || null,
        sku: product.properties.hs_sku || null,
        billing_period: this.parseHubspotPeriod(product.properties.hs_recurring_billing_period),
        moodle_course_id: product.properties.moodle_course_id || null,
        learning_price_members: product.properties.learning_price_members || null,
        price_gov_campus: product.properties.price__gov_campus_ || null,
        notes: product.properties.notes || '',
        learning_course_type: product.properties.learning_course_type || ''
      };
    } catch (error) {
      console.error('Error fetching HubSpot product:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Create a new HubSpot product
   */
  async createProduct(productData) {
    try {
      const url = `${this.baseUrl}/crm/v3/objects/products`;
      const payload = {
        properties: {
          name: productData.name,
          hs_product_type: productData.type || 'Learning Course',
          description: productData.description || '',
          price: productData.price || '',
          hs_sku: productData.sku || '',
          hs_recurring_billing_period: this.buildHubspotPeriod(productData.billing_period || productData.enrollment_duration_months),
          moodle_course_id: productData.moodle_course_id || '',
          learning_price_members: productData.learning_price_members || '',
          price__gov_campus_: productData.price_gov_campus || '',
          notes: productData.notes || '',
          learning_course_type: productData.learning_course_type || ''
        }
      };

      const response = await axios.post(url, payload, { headers: this.headers });
      return response.data;
    } catch (error) {
      console.error('Error creating HubSpot product:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Update an existing HubSpot product
   */
  async updateProduct(productId, productData) {
    try {
      const url = `${this.baseUrl}/crm/v3/objects/products/${productId}`;
      const payload = {
        properties: {
          name: productData.name,
          hs_product_type: productData.type || 'Learning Course',
          description: productData.description || '',
          price: productData.price || '',
          hs_sku: productData.sku || '',
          hs_recurring_billing_period: this.buildHubspotPeriod(productData.billing_period || productData.enrollment_duration_months),
          moodle_course_id: productData.moodle_course_id || '',
          learning_price_members: productData.learning_price_members || '',
          price__gov_campus_: productData.price_gov_campus || '',
          notes: productData.notes || '',
          learning_course_type: productData.learning_course_type || ''
        }
      };

      const response = await axios.patch(url, payload, { headers: this.headers });
      return response.data;
    } catch (error) {
      console.error('Error updating HubSpot product:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Fetch all HubSpot pipelines
   */
  async fetchPipelines() {
    const url = `${this.baseUrl}/crm/v3/pipelines/deals`;

    try {
      const response = await axios.get(url, { headers: this.headers });
      
      const pipelines = response.data.results || [];
      return pipelines.map((pipeline) => ({
        id: pipeline.id,
        label: pipeline.label,
        displayOrder: pipeline.displayOrder,
        stages: pipeline.stages || []
      }));
    } catch (error) {
      console.error("Error fetching HubSpot pipelines:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Search companies by name
   */
  async searchCompaniesByName(term) {
    const now = Date.now();
    const cacheKey = `search:${term.toLowerCase()}`;

    // Use an in-memory cache object
    global.companySearchCache = global.companySearchCache || {};
    const cached = global.companySearchCache[cacheKey];

    if (cached && now - cached.fetched < CACHE_DURATION.COMPANY_SEARCH) {
      return cached.data;
    }

    const url = `${this.baseUrl}/crm/v3/objects/companies/search`;

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
      const response = await axios.post(url, payload, { headers: this.headers });

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

  /**
   * Search HubSpot contacts with pagination
   * Required scopes: crm.objects.contacts.read
   */
  async searchContactsByTerm(term) {
    const now = Date.now();
    const cacheKey = `contact-search:${term.toLowerCase()}`;

    global.contactSearchCache = global.contactSearchCache || {};
    const cached = global.contactSearchCache[cacheKey];

    if (cached && now - cached.fetched < CACHE_DURATION.CONTACT_SEARCH) {
      return cached.data;
    }

    const allResults = [];
    let after = null;
    let hasMore = true;

    try {
      while (hasMore) {
        const url = `${this.baseUrl}/crm/v3/objects/contacts/search`;

        const payload = {
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "email",
                  operator: "CONTAINS_TOKEN",
                  value: term
                }
              ]
            },
            {
              filters: [
                {
                  propertyName: "firstname",
                  operator: "CONTAINS_TOKEN",
                  value: term
                }
              ]
            },
            {
              filters: [
                {
                  propertyName: "lastname",
                  operator: "CONTAINS_TOKEN",
                  value: term
                }
              ]
            }
          ],
          properties: ["firstname", "lastname", "email"],
          limit: 100,
          after: after || undefined
        };

        const response = await axios.post(url, payload, { headers: this.headers });

        const contacts = response.data.results.map(contact => ({
          id: contact.id,
          first_name: contact.properties.firstname || '',
          last_name: contact.properties.lastname || '',
          email: contact.properties.email || ''
        }));

        allResults.push(...contacts);

        after = response.data.paging?.next?.after;
        hasMore = !!after;
      }

      // Cache result
      global.contactSearchCache[cacheKey] = {
        fetched: now,
        data: allResults
      };

      return allResults;
    } catch (error) {
      console.error("Error searching contacts:", JSON.stringify(error.response?.data || error.message, null, 2));
      
      // Log the context object specifically if it exists
      if (error.response?.data?.errors?.[0]?.context) {
        console.error("Context object:", JSON.stringify(error.response.data.errors[0].context, null, 2));
      }
      
      return [];
    }
  }

  /**
   * Fetch all HubSpot contacts
   */
  async fetchAllContacts() {
    const allContacts = [];
    let after = null;
    let hasMore = true;

    try {
      while (hasMore) {
        const url = `${this.baseUrl}/crm/v3/objects/contacts?limit=100${after ? `&after=${after}` : ''}&properties=firstname,lastname,email`;

        const response = await axios.get(url, { headers: this.headers });

        const contacts = response.data.results || [];

        allContacts.push(
          ...contacts.map(contact => ({
            id: contact.id,
            first_name: contact.properties.firstname || '',
            last_name: contact.properties.lastname || '',
            email: contact.properties.email || ''
          }))
        );

        after = response.data.paging?.next?.after;
        hasMore = !!after;
      }

      return allContacts;
    } catch (error) {
      console.error("Error fetching HubSpot contacts:", error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Fetch companies with pagination
   */
  async fetchCompaniesBatch(after = null) {
    const baseUrl = `${this.baseUrl}/crm/v3/objects/companies?limit=100${after ? `&after=${after}` : ''}`;

    try {
      const response = await axios.get(baseUrl, { headers: this.headers });

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
   * Fetch deal by ID
   */
  async fetchDealById(dealId) {
    const url = `${this.baseUrl}/crm/v3/objects/deals/${dealId}?properties=dealname,amount,closedate`;

    try {
      const response = await axios.get(url, { headers: this.headers });
      return response.data;
    } catch (error) {
      console.error(`Error fetching deal ${dealId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Create a HubSpot contact
   */
  async createContact({ firstName, lastName, email, phone }) {
    const url = `${this.baseUrl}/crm/v3/objects/contacts`;

    const data = {
      properties: {
        firstname: firstName,
        lastname: lastName,
        email,
        phone,
      },
    };

    try {
      const response = await axios.post(url, data, { headers: this.headers });
      return response.data;
    } catch (error) {
      console.error("Error creating HubSpot contact:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Create a HubSpot deal
   */
  async createDeal(dealData) {
    const url = `${this.baseUrl}/crm/v3/objects/deals`;

    const data = {
      properties: {
        dealname: dealData.dealName,
        amount: dealData.value,
        pipeline: dealData.pipelineId,
        dealstage: dealData.stageId,
        description: dealData.description,
        closedate: dealData.closeDate, // Today's date as timestamp
        startdate: dealData.startDate, // Course start date as YYYY-MM-DD
        hs_deal_stage_probability: "1", // 100% these are won deals
        course_name: dealData.courseName, // Custom property for course name
        course_date: dealData.startDate, // Custom property for course date
        hubspot_owner_id: dealData.ownerId, // Deal owner ID
        ...(dealData.courseType ? { course_type: dealData.courseType } : {}),
      },
    };

    try {
      const response = await axios.post(url, data, { headers: this.headers });
      const dealId = response.data.id;

      // Associate with company if provided
      if (dealData.companyId) {
        await this.associateDealWithCompany(dealId, dealData.companyId);
      }

      // Associate with contact if provided
      if (dealData.contactId) {
        await this.associateDealWithContact(dealId, dealData.contactId);
      }

      // Create line item with product if provided
      if (dealData.productId) {
        await this.createLineItemForDeal(dealId, dealData.productId, dealData);
      }

      return response.data;
    } catch (error) {
      console.error("Error creating HubSpot deal:", JSON.stringify(error.response?.data || error.message, null, 2));
      throw error;
    }
  }

  /**
   * Update a HubSpot deal with additional properties
   */
  async updateDeal(dealId, updateData) {
    const url = `${this.baseUrl}/crm/v3/objects/deals/${dealId}`;

    const data = {
      properties: {
        ...updateData
      }
    };

    try {
      const response = await axios.patch(url, data, { headers: this.headers });
      return response.data;
    } catch (error) {
      console.error("Error updating HubSpot deal:", JSON.stringify(error.response?.data || error.message, null, 2));
      throw error;
    }
  }

  /**
   * Associate deal with company
   */
  async associateDealWithCompany(dealId, companyId) {
    const url = `${this.baseUrl}/crm/v3/objects/deals/${dealId}/associations/companies/${companyId}/deal_to_company`;

    try {
      await axios.put(url, {}, { headers: this.headers });
    } catch (error) {
      console.error("Error associating deal with company:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Associate deal with contact
   */
  async associateDealWithContact(dealId, contactId) {
    const url = `${this.baseUrl}/crm/v3/objects/deals/${dealId}/associations/contacts/${contactId}/deal_to_contact`;

    try {
      await axios.put(url, {}, { headers: this.headers });
    } catch (error) {
      console.error("Error associating deal with contact:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
 * Set association labels between two CRM objects (v4 API)
 * - Ensures the association exists (creates with proper spec array)
 * - If created with a USER_DEFINED type (which has a label), skips /labels
 * - If created with HUBSPOT_DEFINED, uses /labels to apply labels
 * - fromType/toType must be plural API names ("deals", "contacts", etc.)
 */
async setAssociationLabels(fromType, fromId, toType, toId, labels = []) {
  const assocBase = `${this.baseUrl}/crm/v4/objects/${fromType}/${fromId}/associations/${toType}/${toId}`;
  const labelsUrl = `${assocBase}/labels`;
  const typesUrl  = `${this.baseUrl}/crm/v4/associations/${fromType}/${toType}/labels`;

  // 0) Fetch available association defs (category, typeId, label)
  let createSpec = null;
  try {
    const typesRes = await axios.get(typesUrl, { headers: this.headers });
    const defs = (typesRes?.data?.results || []).map(d => ({
      associationCategory: d.category,   // 'HUBSPOT_DEFINED' or 'USER_DEFINED'
      associationTypeId: d.typeId,
      label: d.label || null
    }));

    const desiredLabel = labels.length === 1 ? labels[0] : null;

    // Prefer a user-defined type matching the desired label; else hubspot-defined; else first available
    createSpec =
      (desiredLabel && defs.find(d => d.label === desiredLabel)) ||
      defs.find(d => d.associationCategory === 'HUBSPOT_DEFINED') ||
      defs[0];

    if (!createSpec?.associationTypeId) {
      throw new Error('No valid association type found for this object pair.');
    }
  } catch (err) {
    console.error('[HS] Failed to fetch/match association types', err?.response?.status, err?.response?.data || err.message);
    throw new Error('Cannot determine associationTypeId for create call.');
  }

  // 1) Ensure the association exists (PUT with ARRAY body of specs)
  let createdWithUserDefinedLabel = createSpec.associationCategory === 'USER_DEFINED' && !!createSpec.label;
  try {
    const res = await axios.put(assocBase, [createSpec], { headers: this.headers });

    // If API echoes labels, trust that
    if (Array.isArray(res.data?.labels) && res.data.labels.length > 0) {
      createdWithUserDefinedLabel = true;
    }
  } catch (err) {
    const code = err?.response?.status;
    const data = err?.response?.data;
    console.error('[HS] Association create failed', code, data);
    if (code !== 409) {
      throw new Error(`Failed to create association: ${code || err.message}`);
    }
  }

  // 2) Only call /labels when needed:
  // - If we created using HUBSPOT_DEFINED (no label), attach labels here
  // - If we used USER_DEFINED (label already applied), skip to avoid 404
  if (!createdWithUserDefinedLabel) {
    try {
      const res = await axios.put(labelsUrl, { labels }, { headers: this.headers });
      return true;
    } catch (err) {
      const code = err?.response?.status;
      const data = err?.response?.data;
      console.error('[HS] Set labels failed', code, data, { url: labelsUrl, payload: { labels } });

      if (code === 400 || code === 404) {
        console.error(
          '[HS] Hint: Ensure each label exists in HubSpot (Settings → Objects → Deals → Associations → Contacts → Manage labels),' +
          ' check exact case/spelling, and confirm your Private App has crm.objects.associations.write.'
        );
      }
      return false;
    }
  } else {
    return true;
  }
}

  /**
   * Create line item for deal with product
   */
  async createLineItemForDeal(dealId, productId, dealData) {
    try {
      // First, create the line item
      const lineItemData = {
        properties: {
          name: dealData.courseName || "Course Booking",
          hs_product_id: productId,
          price: dealData.value,
          quantity: "1"
          // Removed hs_recurring_billing_period as it's not needed for one-time purchases
        }
      };

      const lineItemUrl = `${this.baseUrl}/crm/v3/objects/line_items`;
      const lineItemResponse = await axios.post(lineItemUrl, lineItemData, { headers: this.headers });
      const lineItemId = lineItemResponse.data.id;

      console.log(`Created line item ${lineItemId} for product ${productId}`);

      // Then associate the line item with the deal
      const associationUrl = `${this.baseUrl}/crm/v3/objects/deals/${dealId}/associations/line_items/${lineItemId}/deal_to_line_item`;
      await axios.put(associationUrl, {}, { headers: this.headers });

      console.log(`Associated line item ${lineItemId} with deal ${dealId}`);

      return lineItemId;
    } catch (error) {
      console.error("Error creating line item for deal:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Create line item for deal with custom name/price/quantity and optional productId
   */
  async createLineItemForDealWithOverrides(dealId, { productId = null, name, price, quantity = '1' }) {
    try {
      const lineItemData = {
        properties: {
          name: name || 'Line item',
          price: price,
          quantity: String(quantity)
        }
      };
      if (productId) {
        lineItemData.properties.hs_product_id = productId;
      }

      const lineItemUrl = `${this.baseUrl}/crm/v3/objects/line_items`;
      const lineItemResponse = await axios.post(lineItemUrl, lineItemData, { headers: this.headers });
      const lineItemId = lineItemResponse.data.id;

      const associationUrl = `${this.baseUrl}/crm/v3/objects/deals/${dealId}/associations/line_items/${lineItemId}/deal_to_line_item`;
      await axios.put(associationUrl, {}, { headers: this.headers });

      return lineItemId;
    } catch (error) {
      console.error('Error creating line item with overrides:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get a specific deal by ID
   */
  async getDeal(dealId) {
    try {
      // Get the deal and its main properties
      const dealResponse = await axios.get(
        `${this.baseUrl}/crm/v3/objects/deals/${dealId}`,
        {
          headers: this.headers,
          params: {
                         properties: [
               'dealname',
               'amount',
               'closedate',
               'pipeline',
               'dealstage',
               'hs_deal_stage_probability',
               'hubspot_owner_id',
               'description',
               'startdate',
               'course_name',
               'course_date',
               'calendar_event_id',
               'calendar_event_url',
               'forecast_id',
               'projecturl',
               'createdate',
               'hs_lastmodifieddate'
             ].join(',')
          }
        }
      );
  
      const deal = dealResponse.data;
  
      // --- FETCH ASSOCIATED COMPANY ---
      try {
        const companyAssocResponse = await axios.get(
          `${this.baseUrl}/crm/v3/objects/deals/${dealId}/associations/companies`,
          { headers: this.headers }
        );
  
        const companyId = companyAssocResponse.data.results?.[0]?.id;
  
        if (companyId) {
          const companyResponse = await axios.get(
            `${this.baseUrl}/crm/v3/objects/companies/${companyId}`,
            {
              headers: this.headers,
              params: { properties: 'name,domain,industry' }
            }
          );
          deal.properties.company_details = companyResponse.data;
        } else {
          deal.properties.company_details = null;
        }
      } catch (error) {
        console.error('Error fetching associated company:', error.message);
        deal.properties.company_details = null;
      }
  
      // --- FETCH ASSOCIATED CONTACT ---
      try {
        const contactAssocResponse = await axios.get(
          `${this.baseUrl}/crm/v3/objects/deals/${dealId}/associations/contacts`,
          { headers: this.headers }
        );
  
        const contactId = contactAssocResponse.data.results?.[0]?.id;
  
        if (contactId) {
          const contactResponse = await axios.get(
            `${this.baseUrl}/crm/v3/objects/contacts/${contactId}`,
            {
              headers: this.headers,
              params: { properties: 'firstname,lastname,email,phone' }
            }
          );
          deal.properties.contact_details = contactResponse.data;
        } else {
          deal.properties.contact_details = null;
        }
      } catch (error) {
        console.error('Error fetching associated contact:', error.message);
        deal.properties.contact_details = null;
      }
  
      // --- FETCH OWNER ---
      if (deal.properties?.hubspot_owner_id) {
        try {
          const ownerResponse = await axios.get(
            `${this.baseUrl}/crm/v3/owners/${deal.properties.hubspot_owner_id}`,
            { headers: this.headers }
          );
          deal.properties.owner_details = ownerResponse.data;
        } catch (error) {
          console.error('Error fetching owner details:', error.message);
          deal.properties.owner_details = null;
        }
      }
  
      // --- FETCH PIPELINE + STAGE DETAILS ---
      try {
        const pipelinesResponse = await axios.get(
          `${this.baseUrl}/crm/v3/pipelines/deals`,
          { headers: this.headers }
        );
  
        const pipelines = pipelinesResponse.data.results || [];
        const pipeline = pipelines.find(p => p.id === deal.properties?.pipeline);
        if (pipeline) {
          deal.properties.pipeline_details = pipeline;
  
          const stage = pipeline.stages.find(s => s.id === deal.properties?.dealstage);
          if (stage) {
            deal.properties.stage_details = stage;
          }
        } else {
          deal.properties.pipeline_details = null;
          deal.properties.stage_details = null;
        }
      } catch (error) {
        console.error('Error fetching pipeline details:', error.message);
        deal.properties.pipeline_details = null;
        deal.properties.stage_details = null;
      }
  
             return deal;
     } catch (error) {
       console.error('Error fetching deal:', error.response?.data || error.message);
       throw error;
     }
   }

   /**
    * Fetch deals from a specific pipeline
    */
   async fetchDealsFromPipeline(pipelineId, limit = 100) {
     const url = `${this.baseUrl}/crm/v3/objects/deals/search`;
     
     const body = {
       filterGroups: [
         {
           filters: [
             {
               propertyName: 'pipeline',
               operator: 'EQ',
               value: pipelineId
             }
           ]
         }
       ],
       properties: [
         'dealname', 'amount', 'pipeline', 'dealstage', 'description', 
         'closedate', 'startdate', 'course_name', 'course_date', 'hubspot_owner_id',
         'calendar_event_id', 'calendar_event_url', 'forecast_id', 'projecturl',
         'createdate', 'hs_lastmodifieddate'
       ],
       limit: limit,
       sorts: [
         {
           propertyName: 'createdate',
           direction: 'DESCENDING'
         }
       ]
     };

     try {
       const response = await axios.post(url, body, { headers: this.headers });
       return response.data.results || [];
     } catch (error) {
       console.error("Error fetching deals from pipeline:", JSON.stringify(error.response?.data || error.message, null, 2));
       throw error;
     }
   }
  

  /**
   * Get deals for a specific product
   */
  async getDealsForProduct(productId) {
    try {
      // Step 1: Search for line items referencing this product
      const searchResponse = await axios.post(
        `${this.baseUrl}/crm/v3/objects/line_items/search`,
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
        { headers: this.headers }
      );

      const lineItems = searchResponse.data.results || [];

      if (lineItems.length === 0) {
        return [];
      }

      // Step 2: For each line item, get associated deals
      const dealIds = new Set();

      await Promise.all(
        lineItems.map(async (item) => {
          const assocRes = await axios.get(
            `${this.baseUrl}/crm/v3/objects/line_items/${item.id}/associations/deals`,
            { headers: this.headers }
          );
          assocRes.data.results.forEach(d => dealIds.add(d.id));
        })
      );

      // Step 3: Fetch deal details
      const deals = await Promise.all(
        Array.from(dealIds).map(async (id) => {
          const dealRes = await axios.get(
            `${this.baseUrl}/crm/v3/objects/deals/${id}?properties=dealname,amount,closedate`,
            { headers: this.headers }
          );
          return {
            id,
            ...dealRes.data.properties
          };
        })
      );

      return deals;
    } catch (error) {
      console.error("Error fetching deals for product:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Send data to Zapier webhook
   */
  async sendToZapier(payload) {
    if (!this.webhookUrl) {
      throw new Error('Zapier webhook URL not configured');
    }

    const response = await axios.post(this.webhookUrl, payload);
    return response.data;
  }

  /**
   * Log fallback data when Zapier fails
   */
  logFallback(payload, error) {
    const fs = require('fs');
    const logData = JSON.stringify({ 
      payload, 
      error, 
      time: new Date() 
    }) + '\n';
    
    fs.appendFileSync('logs/zapier-fallback.log', logData);
  }

  /**
   * Process HubSpot webhook payload
   */
  handleWebhook(req) {
    const event = req.body;
    //console.log("Received HubSpot Webhook Event:", JSON.stringify(event, null, 2));

    return {
      objectType: event.objectType,
      objectId: event.objectId,
      eventType: event.subscriptionType,
      timestamp: event.occurredAt,
    };
  }

  /**
   * Verify HubSpot webhook signature
   */
  verifyWebhookSignature(req, secret) {
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

  /**
   * Find HubSpot user by email
   */
  async findUserByEmail(email) {
    const url = `${this.baseUrl}/crm/v3/owners`;
    
    try {
      const response = await axios.get(url, { 
        headers: this.headers,
        params: { email }
      });
      
      const users = response.data.results || [];
      return users.find(user => user.email === email) || null;
    } catch (error) {
      console.error("Error finding user by email:", JSON.stringify(error.response?.data || error.message, null, 2));
      return null;
    }
  }

  /**
   * Check available scopes for the current API key
   * This can help debug scope-related issues
   */
  async checkAvailableScopes() {
    const url = `${this.baseUrl}/oauth/v1/access-tokens/${this.apiKey}`;

    try {
      const response = await axios.get(url, { headers: this.headers });
      return response.data;
    } catch (error) {
      console.error("Error checking scopes:", JSON.stringify(error.response?.data || error.message, null, 2));
      throw error;
    }
  }
}

// Export individual functions for backward compatibility
export const fetchProductsFromHubSpot = async () => {
  const service = new HubSpotService();
  return service.fetchProducts();
};

export const fetchPipelinesFromHubSpot = async () => {
  const service = new HubSpotService();
  return service.fetchPipelines();
};

export const checkHubSpotScopes = async () => {
  const service = new HubSpotService();
  return service.checkAvailableScopes();
};

export const fetchCompaniesFromHubSpotBatch = async (after = null) => {
  const service = new HubSpotService();
  return service.fetchCompaniesBatch(after);
};

export const searchCompaniesByName = async (term) => {
  const service = new HubSpotService();
  return service.searchCompaniesByName(term);
};

export const searchContactsByTerm = async (term) => {
  const service = new HubSpotService();
  return service.searchContactsByTerm(term);
};

export const fetchDealById = async (dealId) => {
  const service = new HubSpotService();
  return service.fetchDealById(dealId);
};

export const createContact = async (contactData) => {
  const service = new HubSpotService();
  return service.createContact(contactData);
};

export const createDeal = async (dealData) => {
  const service = new HubSpotService();
  return service.createDeal(dealData);
};

export const createLineItemForDeal = async (dealId, productId, dealData) => {
  const service = new HubSpotService();
  return service.createLineItemForDeal(dealId, productId, dealData);
};

export const findUserByEmail = async (email) => {
  const service = new HubSpotService();
  return service.findUserByEmail(email);
};

export const handleWebhook = (req) => {
  const service = new HubSpotService();
  return service.handleWebhook(req);
};

export const verifyWebhookSignature = (req, secret) => {
  const service = new HubSpotService();
  return service.verifyWebhookSignature(req, secret);
};

export default HubSpotService;
