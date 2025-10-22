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

  // Utility: sleep ms
  sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  // Utility: Axios call with 429 backoff handling
  async requestWithRetry(fn, { maxRetries = 5, baseDelayMs = 250 } = {}) {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (error) {
        const status = error?.response?.status;
        if (status === 429 && attempt < maxRetries) {
          const retryAfter = parseFloat(error?.response?.headers?.['retry-after'] || '0');
          const backoff = retryAfter > 0 ? Math.ceil(retryAfter * 1000) : baseDelayMs * Math.pow(2, attempt);
          await this.sleep(backoff);
          attempt += 1;
          continue;
        }
        throw error;
      }
    }
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
   * Find a contact by exact email and return membership-related properties.
   * Also checks associated company for active membership overrides.
   */
  async getContactMembershipByEmail(email) {
    if (!email) return null;
    try {
      // 1) Exact email search with needed properties
      const searchUrl = `${this.baseUrl}/crm/v3/objects/contacts/search`;
      const payload = {
        filterGroups: [
          { filters: [{ propertyName: 'email', operator: 'EQ', value: String(email).toLowerCase() }] }
        ],
        properties: [
          'email',
          'firstname',
          'lastname',
          'odi_membership__active_or_lapsed__',
          'odi_member_partner_type'
        ],
        limit: 1
      };
      const cRes = await this.requestWithRetry(() => axios.post(searchUrl, payload, { headers: this.headers }));
      const contact = (cRes?.data?.results || [])[0];
      if (!contact) return null;

      const out = {
        contact_id: contact.id,
        email: contact.properties?.email || String(email).toLowerCase(),
        contact_membership_status: contact.properties?.odi_membership__active_or_lapsed__ || null,
        contact_membership_type: contact.properties?.odi_member_partner_type || null,
        company_membership_active: false,
        membership_status: contact.properties?.odi_membership__active_or_lapsed__ || null,
        membership_type: contact.properties?.odi_member_partner_type || null
      };

      // 2) Try associated company → if company membership Active, override
      try {
        const assocUrl = `${this.baseUrl}/crm/v3/objects/contacts/${contact.id}/associations/companies`;
        const assocRes = await this.requestWithRetry(() => axios.get(assocUrl, { headers: this.headers }));
        const companyId = assocRes?.data?.results?.[0]?.id;
        if (companyId) {
          const compUrl = `${this.baseUrl}/crm/v3/objects/companies/${companyId}`;
          const compRes = await this.requestWithRetry(() => axios.get(compUrl, {
            headers: this.headers,
            params: { properties: 'name,odi_membership_status__active_or_lapsed__,member_partner_type_org_' }
          }));
          const p = compRes?.data?.properties || {};
          if ((p.odi_membership_status__active_or_lapsed__ || '').toLowerCase() === 'active') {
            out.company_membership_active = true;
            out.membership_status = 'Active';
            out.membership_type = p.member_partner_type_org_ || out.membership_type || null;
          }
        }
      } catch (_) {
        // ignore association/company errors; fall back to contact-level values
      }

      return out;
    } catch (error) {
      console.error('Error getContactMembershipByEmail:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Batch: fetch contacts by emails with membership properties.
   * Uses multiple OR filterGroups per request (up to 25 emails per request) to reduce API calls.
   * Returns a map email -> { contact_id, email, contact_membership_status, contact_membership_type }
   */
  async getContactsMembershipByEmails(emails = []) {
    const normalized = Array.from(new Set((emails || []).map(e => String(e || '').toLowerCase()).filter(Boolean)));
    const byEmail = new Map();
    const chunkSize = 100;
    for (let i = 0; i < normalized.length; i += chunkSize) {
      const chunk = normalized.slice(i, i + chunkSize);
      const url = `${this.baseUrl}/crm/v3/objects/contacts/batch/read`;
      const payload = {
        properties: ['email','firstname','lastname','odi_membership__active_or_lapsed__','odi_member_partner_type'],
        idProperty: 'email',
        inputs: chunk.map(e => ({ id: e }))
      };
      try {
        const res = await this.requestWithRetry(() => axios.post(url, payload, { headers: this.headers }));
        const results = res?.data?.results || [];
        results.forEach(c => {
          const em = String(c.properties?.email || '').toLowerCase();
          if (!em) return;
          byEmail.set(em, {
            contact_id: c.id,
            email: em,
            contact_membership_status: c.properties?.odi_membership__active_or_lapsed__ || null,
            contact_membership_type: c.properties?.odi_member_partner_type || null
          });
        });
      } catch (e) {
        // Continue with remaining chunks
      }
    }
    return byEmail;
  }

  /**
   * Batch: read associated companies for a list of contact IDs.
   * Returns a map contactId -> first companyId (string) or null
   */
  async getAssociatedCompaniesForContacts(contactIds = []) {
    const ids = Array.from(new Set((contactIds || []).map(String).filter(Boolean)));
    const out = new Map();
    const chunkSize = 100;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const url = `${this.baseUrl}/crm/v4/associations/contacts/companies/batch/read`;
      const payload = { inputs: chunk.map(id => ({ id })) };
      try {
        const res = await this.requestWithRetry(() => axios.post(url, payload, { headers: this.headers }));
        const results = res?.data?.results || [];
        results.forEach(r => {
          const cid = (r.to || [])[0]?.id || null;
          out.set(r.from?.id, cid || null);
        });
      } catch (e) {
        // skip on error
      }
    }
    return out;
  }

  /**
   * Batch: read companies by IDs with membership properties. Returns map id -> properties
   */
  async getCompaniesByIdsBatch(companyIds = []) {
    const ids = Array.from(new Set((companyIds || []).map(String).filter(Boolean)));
    const out = new Map();
    const chunkSize = 100;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const url = `${this.baseUrl}/crm/v3/objects/companies/batch/read`;
      const payload = { properties: ['name','odi_membership_status__active_or_lapsed__','member_partner_type_org_'], inputs: chunk.map(id => ({ id })) };
      try {
        const res = await this.requestWithRetry(() => axios.post(url, payload, { headers: this.headers }));
        const results = res?.data?.results || [];
        results.forEach(c => out.set(c.id, c.properties || {}));
      } catch (e) {}
    }
    return out;
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
   * Fetch line items associated with a deal, including their linked product and moodle_course_id
   */
  async fetchDealLineItemsWithProducts(dealId) {
    try {
      // Get associated line item IDs
      const assocRes = await axios.get(
        `${this.baseUrl}/crm/v3/objects/deals/${dealId}/associations/line_items`,
        { headers: this.headers }
      );
      const lineItemIds = (assocRes.data?.results || []).map(r => r.id);
      if (lineItemIds.length === 0) return [];

      const results = [];
      for (const liId of lineItemIds) {
        // Fetch line item properties
        const liRes = await axios.get(
          `${this.baseUrl}/crm/v3/objects/line_items/${liId}?properties=name,hs_product_id,price,quantity,hs_recurring_billing_period`,
          { headers: this.headers }
        );
        const li = liRes.data;
        const productId = li?.properties?.hs_product_id || null;
        // Parse term months from ISO8601 period P{n}M
        let termMonths = null;
        const period = li?.properties?.hs_recurring_billing_period || '';
        const m = String(period).match(/^P(\d+)M$/i);
        if (m) termMonths = parseInt(m[1], 10);
        let product = null;
        if (productId) {
          product = await this.getProduct(productId);
          // Fallback term from product if line item period missing
          if ((termMonths === null || !Number.isFinite(termMonths)) && product?.billing_period) {
            const bp = parseInt(product.billing_period, 10);
            if (Number.isFinite(bp)) termMonths = bp;
          }
        }
        results.push({
          id: liId,
          name: li?.properties?.name || null,
          price: li?.properties?.price || null,
          quantity: li?.properties?.quantity || null,
          product_id: productId,
          product: product,
          moodle_course_id: product?.moodle_course_id || null,
          term_months: termMonths
        });
      }
      return results;
    } catch (error) {
      console.error('Error fetching deal line items:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Fetch contacts associated to a deal with a specific association label (v4)
   */
  async fetchDealContactsByLabel(dealId, label) {
    try {
      const url = `${this.baseUrl}/crm/v4/objects/deals/${dealId}/associations/contacts`;
      const res = await axios.get(url, { headers: this.headers });
      const items = res.data?.results || [];
      const contactIds = items
        .filter(it => Array.isArray(it.associationTypes) && it.associationTypes.some(t => (t.label || '').toLowerCase() === String(label || '').toLowerCase()))
        .map(it => it.toObjectId);
      if (contactIds.length === 0) return [];

      const contacts = [];
      for (const id of contactIds) {
        try {
          const cRes = await axios.get(`${this.baseUrl}/crm/v3/objects/contacts/${id}?properties=firstname,lastname,email`, { headers: this.headers });
          contacts.push({
            id,
            first_name: cRes.data?.properties?.firstname || '',
            last_name: cRes.data?.properties?.lastname || '',
            email: cRes.data?.properties?.email || ''
          });
        } catch (e) {
          console.warn('Failed to fetch contact', id, e?.response?.status);
        }
      }
      return contacts;
    } catch (error) {
      console.error('Error fetching deal contacts by label:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Fetch all contact IDs associated to a deal (no label filter)
   */
  async fetchDealContactIds(dealId) {
    try {
      const url = `${this.baseUrl}/crm/v3/objects/deals/${dealId}/associations/contacts`;
      const res = await axios.get(url, { headers: this.headers });
      const ids = (res.data?.results || []).map(r => r.id).filter(Boolean);
      return Array.from(new Set(ids.map(String)));
    } catch (error) {
      console.error('Error fetching deal contact IDs:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Apply an association label to all contacts associated with a deal
   */
  async labelAllDealContacts(dealId, label = 'Learner') {
    const ids = await this.fetchDealContactIds(dealId);
    const results = [];
    for (const contactId of ids) {
      try {
        const ok = await this.setAssociationLabels('deals', String(dealId), 'contacts', String(contactId), [label]);
        results.push({ contactId, labeled: Boolean(ok) });
      } catch (e) {
        results.push({ contactId, labeled: false, error: e?.message || 'label failed' });
      }
    }
    return { total: ids.length, updated: results.filter(r => r.labeled).length, results };
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

    const includesSelfPaced = String(dealData.courseType || '').toLowerCase().includes('self');
    const includesTutorLed = String(dealData.courseType || '').toLowerCase().includes('tutor');
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
        // Flags for included course types (deals may include both)
        includes_self_paced_courses: includesSelfPaced,
        includes_tutor_led_courses: includesTutorLed,
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


      // Then associate the line item with the deal
      const associationUrl = `${this.baseUrl}/crm/v3/objects/deals/${dealId}/associations/line_items/${lineItemId}/deal_to_line_item`;
      await axios.put(associationUrl, {}, { headers: this.headers });


      return lineItemId;
    } catch (error) {
      console.error("Error creating line item for deal:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Create line item for deal with custom name/price/quantity and optional productId
   */
  async createLineItemForDealWithOverrides(dealId, { productId = null, name, price, quantity = '1', termMonths = null }) {
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
      if (Number.isFinite(termMonths) && termMonths > 0) {
        lineItemData.properties.hs_recurring_billing_period = `P${parseInt(termMonths, 10)}M`;
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
               'course_type',
               'includes_self_paced_courses',
               'includes_tutor_led_courses',
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
    const all = [];
    let after = null;
    let pageCount = 0;
    try {
      while (true) {
        const body = {
          filterGroups: [
            {
              filters: [
                { propertyName: 'pipeline', operator: 'EQ', value: pipelineId }
              ]
            }
          ],
          properties: [
            'dealname','amount','pipeline','dealstage','description',
            'closedate','startdate','course_name','course_date','hubspot_owner_id',
            'calendar_event_id','calendar_event_url','forecast_id','projecturl',
            'createdate','hs_lastmodifieddate','hs_deal_stage_probability'
          ],
          limit: 100,
          sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
          ...(after ? { after } : {})
        };
        const response = await this.requestWithRetry(() => axios.post(url, body, { headers: this.headers }));
        const results = response?.data?.results || [];
        all.push(...results);
        after = response?.data?.paging?.next?.after || null;
        pageCount += 1;
        if (!after) break;
        if (pageCount > 50) break; // safety cap
      }
      if (process.env.DEBUG_HUBSPOT === 'true') {
      }
      return all;
    } catch (error) {
      console.error('Error fetching deals from pipeline:', JSON.stringify(error.response?.data || error.message, null, 2));
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
   * Fetch deals from multiple pipelines (in parallel) and flatten
   */
  async fetchDealsFromPipelines(pipelineIds = [], limitPerPipeline = 100) {
    const ids = Array.from(new Set((pipelineIds || []).map(String).filter(Boolean)));
    if (ids.length === 0) return [];
    const results = await Promise.all(ids.map(id => this.fetchDealsFromPipeline(id, limitPerPipeline).catch(() => [])));
    return results.flat();
  }

  /**
   * Fetch email/notes history associated with a deal
   * Returns unified array: { id, type: 'email'|'note', subject, to, from, text, html, timestamp }
   */
  async fetchDealEmailHistory(dealId) {
    try {
      const results = [];

      // Notes associated to the deal
      try {
        const assocNotes = await axios.get(
          `${this.baseUrl}/crm/v3/objects/deals/${dealId}/associations/notes`,
          { headers: this.headers }
        );
        const noteIds = (assocNotes.data?.results || []).map(r => r.id);
        for (const id of noteIds) {
          try {
            const nRes = await axios.get(
              `${this.baseUrl}/crm/v3/objects/notes/${id}?properties=hs_note_body,hs_timestamp`,
              { headers: this.headers }
            );
            const p = nRes.data?.properties || {};
            results.push({
              id,
              type: 'note',
              subject: '',
              to: '',
              from: '',
              text: null,
              html: p.hs_note_body || '',
              status: '',
              direction: '',
              timestamp: p.hs_timestamp || null
            });
          } catch (e) {}
        }
      } catch (e) {}

      // Sort newest first
      results.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
      return results;
    } catch (error) {
      console.error('Error fetching email history:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Determine the appropriate email type to send based on previous emails sent to a contact
   * @param {string} dealId - The deal ID
   * @param {string} contactEmail - The contact email address
   * @returns {Promise<'welcome'|'reminder'>} - The email type to send
   */
  async determineEmailType(dealId, contactEmail) {
    try {
      const history = await this.fetchLearnerEmailHistoryByDeal(dealId);
      const contactHistory = history.find(h => h.email.toLowerCase() === contactEmail.toLowerCase());
      
      if (!contactHistory || !contactHistory.items || contactHistory.items.length === 0) {
        // No previous emails sent - send welcome email
        return 'welcome';
      }
      
      // Helper: best-effort subject extraction from HTML body (first <strong> or 'Subject:' prefix)
      const extractSubject = (it) => {
        if (it?.subject) return String(it.subject);
        const html = String(it?.html || '');
        // Try first <strong> tag
        const strongMatch = html.match(/<strong>([^<]+)<\/strong>/i);
        if (strongMatch && strongMatch[1]) return strongMatch[1];
        // Try 'Subject:' header in HTML/text
        const subjMatch = html.match(/Subject:\s*([^<\n\r]+)/i);
        if (subjMatch && subjMatch[1]) return subjMatch[1];
        return '';
      };

      // Check if any previous email was a welcome email
      const hasWelcomeEmail = contactHistory.items.some(item => {
        const subj = extractSubject(item).toLowerCase();
        return subj.includes('welcome') && !subj.includes('reminder');
      });
      
      // If no welcome email was sent, send welcome; otherwise send reminder
      return hasWelcomeEmail ? 'reminder' : 'welcome';
    } catch (error) {
      console.error('Error determining email type:', error);
      // Default to welcome if we can't determine
      return 'welcome';
    }
  }

  /**
   * Fetch learner-specific email/notes history grouped by contact email.
   * Each item: { email, items: [{ id, type, subject, to, from, text, html, timestamp }] }
   */
  async fetchLearnerEmailHistoryByDeal(dealId) {
    try {
      const byEmail = new Map();

      // Helper to push
      const pushForEmails = (emailsArr, item) => {
        emailsArr.forEach((em) => {
          if (!em) return;
          const key = String(em).toLowerCase();
          if (!byEmail.has(key)) byEmail.set(key, { email: em, items: [] });
          byEmail.get(key).items.push(item);
        });
      };

      // Notes associated to deal → associated contacts define recipients; body contains subject/To rendered
      try {
        const assocNotes = await axios.get(
          `${this.baseUrl}/crm/v3/objects/deals/${dealId}/associations/notes`,
          { headers: this.headers }
        );
        const noteIds = (assocNotes.data?.results || []).map(r => r.id);
        for (const id of noteIds) {
          try {
            const nRes = await axios.get(
              `${this.baseUrl}/crm/v3/objects/notes/${id}?properties=hs_note_body,hs_timestamp`,
              { headers: this.headers }
            );
            const p = nRes.data?.properties || {};
            // Contacts associated to this note
            let toEmails = [];
            try {
              const assocContacts = await axios.get(
                `${this.baseUrl}/crm/v3/objects/notes/${id}/associations/contacts`,
                { headers: this.headers }
              );
              const cids = (assocContacts.data?.results || []).map(r => r.id);
              for (const cid of cids) {
                try {
                  const cRes = await axios.get(
                    `${this.baseUrl}/crm/v3/objects/contacts/${cid}?properties=email`,
                    { headers: this.headers }
                  );
                  const em = cRes.data?.properties?.email || null;
                  if (em) toEmails.push(em);
                } catch (_) {}
              }
            } catch (_) {}

            const item = {
              id,
              type: 'note',
              subject: '',
              to: toEmails.join(', '),
              from: process.env.EMAIL_FROM || '',
              text: null,
              html: p.hs_note_body || '',
              timestamp: p.hs_timestamp || null
            };
            pushForEmails(toEmails, item);
          } catch (_) {}
        }
      } catch (_) {}

      // Build array and sort each by timestamp desc
      const out = Array.from(byEmail.values()).map(group => ({
        email: group.email,
        items: (group.items || []).sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
      }));
      return out;
    } catch (error) {
      console.error('Error fetching learner email history:', error.response?.data || error.message);
      throw error;
    }
  }

  // Log an email communication as a Note and associate with deal/contact.
  async logEmailToDealAndContact({ dealId, contactId, subject, bodyHtml, sentAt = Date.now(), fromEmail = null, toEmail = null }) {
    const timestampIso = new Date(sentAt).toISOString();
    try {
      const noteRes = await axios.post(
        `${this.baseUrl}/crm/v3/objects/notes`,
        {
          properties: {
            hs_note_body: `<div><p><strong>${subject || 'Training Email'}</strong></p><p><em>To:</em> ${toEmail || ''}${fromEmail ? ` &nbsp;&nbsp;<em>From:</em> ${fromEmail}` : ''}</p></div>${bodyHtml}`,
            hs_timestamp: timestampIso
          }
        },
        { headers: this.headers }
      );
      const noteId = noteRes?.data?.id;
      if (noteId && dealId) {
        await axios.put(
          `${this.baseUrl}/crm/v3/objects/notes/${noteId}/associations/deals/${dealId}/note_to_deal`,
          {},
          { headers: this.headers }
        );
      }
      if (noteId && contactId) {
        await axios.put(
          `${this.baseUrl}/crm/v3/objects/notes/${noteId}/associations/contacts/${contactId}/note_to_contact`,
          {},
          { headers: this.headers }
        );
      }
      return { id: noteId, object: 'note' };
    } catch (error) {
      console.error('Error logging to HubSpot (note):', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Create a HubSpot note with a Creator header and associate with a deal (and optionally contact).
   */
  async logNoteToDealWithCreator({ dealId, creatorName = '', creatorEmail = '', subject = 'Note', bodyHtml = '', createdAt = Date.now(), contactId = null }) {
    const timestampIso = new Date(createdAt).toISOString();
    try {
      const header = `<div><p><strong>${subject || 'Note'}</strong></p><p><em>Creator:</em> ${creatorName || ''}${creatorEmail ? ` &lt;${creatorEmail}&gt;` : ''}</p></div>`;
      const noteRes = await axios.post(
        `${this.baseUrl}/crm/v3/objects/notes`,
        { properties: { hs_note_body: `${header}${bodyHtml || ''}`, hs_timestamp: timestampIso } },
        { headers: this.headers }
      );
      const noteId = noteRes?.data?.id;
      if (noteId && dealId) {
        await axios.put(
          `${this.baseUrl}/crm/v3/objects/notes/${noteId}/associations/deals/${dealId}/note_to_deal`,
          {},
          { headers: this.headers }
        );
      }
      if (noteId && contactId) {
        await axios.put(
          `${this.baseUrl}/crm/v3/objects/notes/${noteId}/associations/contacts/${contactId}/note_to_contact`,
          {},
          { headers: this.headers }
        );
      }
      return { id: noteId, object: 'note' };
    } catch (error) {
      console.error('Error logging note with creator:', error.response?.data || error.message);
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
   * Fetch all HubSpot owners (users) with basic fields
   */
  async fetchOwners() {
    const owners = [];
    let after = null;
    let hasMore = true;
    try {
      while (hasMore) {
        const url = `${this.baseUrl}/crm/v3/owners`;
        const res = await axios.get(url, { headers: this.headers, params: { limit: 100, after: after || undefined } });
        const results = res?.data?.results || res?.data || [];
        results.forEach(o => {
          owners.push({
            id: String(o.id || o.ownerId || ''),
            firstName: o.firstName || o.firstname || '',
            lastName: o.lastName || o.lastname || '',
            email: o.email || ''
          });
        });
        after = res?.data?.paging?.next?.after || null;
        hasMore = !!after;
        if (!res?.data?.paging && (!Array.isArray(results) || results.length < 100)) {
          hasMore = false;
        }
      }
      return owners;
    } catch (error) {
      console.error('Error fetching HubSpot owners:', error.response?.data || error.message);
      return owners;
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
