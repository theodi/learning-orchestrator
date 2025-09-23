// HubSpot controller

import BaseController from './BaseController.js';
import { HubSpotService } from '../services/hubspotService.js';
import { EmailService } from '../services/emailService.js';
import { buildWelcomeEmail, buildReminderEmail } from '../services/emailTemplates.js';
import { ForecastService } from '../services/forecastService.js';
import { EnrollmentService } from '../services/enrollmentService.js';
import { validateApiKey, validateProjectId } from '../utils/validation.js';
import { HTTP_STATUS, HUBSPOT_CONFIG } from '../config/constants.js';

export class HubSpotController extends BaseController {
  constructor() {
    super();
    this.hubspotService = new HubSpotService();
    this.forecastService = new ForecastService();
    this.enrollmentService = new EnrollmentService();
    this.emailService = new EmailService();
  }

  // In-memory queue for reminder jobs by deal
  static reminderJobs = new Map(); // key: deal_id -> { status, startedAt, finishedAt, summary, error }

  getReminderJob(dealId) {
    return HubSpotController.reminderJobs.get(String(dealId));
  }

  setReminderJob(dealId, data) {
    const current = this.getReminderJob(dealId) || {};
    HubSpotController.reminderJobs.set(String(dealId), { ...current, ...data });
  }

  // Browse page
  async browse(req, res) {
    return this.renderPage(req, res, 'pages/hubspot/browse', {
      title: 'Browse HubSpot Data'
    });
  }

  // Search companies
  async searchCompanies(req, res) {
    try {
      const { q } = req.query;
      
      if (!q) {
        return this.sendError(res, 'Missing query param `q`', HTTP_STATUS.BAD_REQUEST);
      }

      const companies = await this.hubspotService.searchCompaniesByName(q);
      return this.sendSuccess(res, companies);
    } catch (error) {
      return this.sendError(res, 'Failed to search companies');
    }
  }

  // Search contacts
  async searchContacts(req, res) {
    try {
      const { q } = req.query;
      
      if (!q) {
        return this.sendError(res, 'Missing query param `q`', HTTP_STATUS.BAD_REQUEST);
      }

      const contacts = await this.hubspotService.searchContactsByTerm(q);
      return this.sendSuccess(res, contacts);
    } catch (error) {
      return this.sendError(res, 'Failed to search contacts');
    }
  }

  // Get deal by ID
  async getDeal(req, res) {
    try {
      const { id } = req.params;
      const deal = await this.hubspotService.getDeal(id);
      return this.sendSuccess(res, deal);
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Authenticated: learner enrollment/access matrix for a deal
  async getDealLearnerMatrix(req, res) {
    try {
      const { id } = req.params;

      // Fetch line items (to get moodle_course_id and term months)
      const lineItems = await this.hubspotService.fetchDealLineItemsWithProducts(id);
      const courseEntries = lineItems
        .map(li => ({
          course_id: parseInt(li.moodle_course_id),
          term_months: Number(li.term_months),
          course_name: li?.product?.name || ''
        }))
        .filter(e => Number.isFinite(e.course_id));

      // Fetch contacts labeled as Learner
      const learners = await this.hubspotService.fetchDealContactsByLabel(id, 'Learner');
      const emails = learners.map(l => l.email).filter(Boolean);

      // Build matrix: rows=learners, cols=courses
      const results = [];
      for (const email of emails) {
        const learner = learners.find(l => l.email === email);
        const firstName = learner?.first_name || '';
        const lastName = learner?.last_name || '';
        const fullName = `${firstName} ${lastName}`.trim() || 'Learner';
        const row = { email, name: fullName, courses: [] };
        for (const entry of courseEntries) {
          const cid = entry.course_id;
          const termMonths = Number.isFinite(entry.term_months) && entry.term_months > 0 ? entry.term_months : 12;
          try {
            const status = await this.enrollmentService.getUserCourseStatus(cid, email, termMonths);
            row.courses.push({
              course_id: cid,
              course_name: status?.course_name || entry.course_name || '',
              enrolled: Boolean(status?.enrolled),
              accessed: Boolean(status?.accessed),
              enrollment_date: status?.enrollment_date || null,
              expiry_date: status?.expiry_date || null
            });
          } catch (e) {
            row.courses.push({ course_id: cid, course_name: entry.course_name || '', enrolled: false, accessed: false, error: e?.message || 'lookup failed' });
          }
        }
        results.push(row);
      }

      return this.sendSuccess(res, { courses: courseEntries.map(c => ({ course_id: c.course_id, course_name: c.course_name })), learners: results }, 'Learner matrix');
    } catch (error) {
      return this.sendError(res, error.message || 'Failed to fetch learner matrix');
    }
  }

  // Fetch email/notes history for a deal
  async getDealEmailHistory(req, res) {
    try {
      const { id } = req.params;
      const acceptHeader = (req.get('accept') || '').toLowerCase();
      // If learner grouping requested, return grouped
      if (String(req.query.group_by_contact || '').toLowerCase() === 'true') {
        const grouped = await this.hubspotService.fetchLearnerEmailHistoryByDeal(id);
        return this.sendSuccess(res, grouped, 'Email history by contact');
      }
      const history = await this.hubspotService.fetchDealEmailHistory(id);
      return this.sendSuccess(res, history, 'Email history');
    } catch (error) {
      return this.sendError(res, error.message || 'Failed to fetch email history');
    }
  }

  // Webhook: queue welcome/reminder emails to all pending learners on a deal
  async sendDealLearnerReminders(req, res) {
    try {
      const apiKey = req.headers['x-api-key'] || req.query.api_key;
      if (!validateApiKey(apiKey, process.env.WEBHOOK_API_KEY)) {
        return this.sendError(res, 'Forbidden: Invalid API key', HTTP_STATUS.FORBIDDEN);
      }

      const { deal_id } = req.body || req.query || {};
      if (!deal_id) {
        return this.sendError(res, 'Missing deal_id', HTTP_STATUS.BAD_REQUEST);
      }
      // Queue: if a job exists and running, return 202; else enqueue
      const existing = this.getReminderJob(deal_id);
      if (existing && (existing.status === 'running' || existing.status === 'queued')) {
        return this.sendSuccess(res, { deal_id, job: existing }, 'Reminder job in progress', HTTP_STATUS.ACCEPTED);
      }

      this.setReminderJob(deal_id, { status: 'queued', startedAt: new Date().toISOString(), finishedAt: null, summary: null, error: null });

      setImmediate(async () => {
        this.setReminderJob(deal_id, { status: 'running' });
        try {
          const result = await this.processDealLearnerRemindersInternal(deal_id);
          this.setReminderJob(deal_id, { status: 'completed', finishedAt: new Date().toISOString(), summary: result?.summary || null });
        } catch (err) {
          this.setReminderJob(deal_id, { status: 'failed', finishedAt: new Date().toISOString(), error: err?.message || String(err) });
        }
      });

      return this.sendSuccess(res, { deal_id, job: this.getReminderJob(deal_id) }, 'Reminder job queued', HTTP_STATUS.ACCEPTED);
    } catch (error) {
      return this.sendError(res, error.message || 'Failed to queue deal reminders');
    }
  }

  // (Removed) getDealReminderStatus: using single endpoint for idempotent queue + status

  // The actual processing, factored out for queue execution
  async processDealLearnerRemindersInternal(deal_id) {
    const lineItems = await this.hubspotService.fetchDealLineItemsWithProducts(deal_id);
    const courseEntries = lineItems
      .map(li => ({
        course_id: parseInt(li.moodle_course_id),
        term_months: Number(li.term_months),
        course_name: li?.product?.name || ''
      }))
      .filter(e => Number.isFinite(e.course_id));

    const learners = await this.hubspotService.fetchDealContactsByLabel(deal_id, 'Learner');
    const emails = learners.map(l => l.email).filter(Boolean);

    const moodleRoot = process.env.MOODLE_ROOT || 'https://moodle.learndata.info';
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

    const results = [];
    for (const email of emails) {
      const learner = learners.find(l => l.email === email);
      const firstName = learner?.first_name || '';
      const lastName = learner?.last_name || '';
      const learnerName = `${firstName} ${lastName}`.trim() || 'Learner';

      const statuses = [];
      for (const entry of courseEntries) {
        const cid = entry.course_id;
        const termMonths = Number.isFinite(entry.term_months) && entry.term_months > 0 ? entry.term_months : 12;
        try {
          const status = await this.enrollmentService.getUserCourseStatus(cid, email, termMonths);
          statuses.push({
            course_id: cid,
            course_name: status?.course_name || entry.course_name || '',
            enrolled: Boolean(status?.enrolled),
            accessed: Boolean(status?.accessed)
          });
        } catch (_) {
          statuses.push({ course_id: cid, course_name: entry.course_name || '', enrolled: false, accessed: false });
        }
      }

      const pendingCourses = statuses.filter(s => !(s.enrolled && s.accessed));
      if (pendingCourses.length === 0) {
        results.push({ email, skipped: true, reason: 'all courses completed' });
        continue;
      }

      const determinedEmailType = await this.hubspotService.determineEmailType(deal_id, email);
      const anyEnrolled = pendingCourses.some(c => c.enrolled);
      const verifyUrl = `${baseUrl}/enrollments/verify?deal_id=${deal_id}&email=${encodeURIComponent(email)}`;

      const template = determinedEmailType === 'welcome'
        ? buildWelcomeEmail({ moodleRootUrl: moodleRoot, courses: pendingCourses, verifyUrl, anyEnrolled, learnerName })
        : buildReminderEmail({ moodleRootUrl: moodleRoot, courses: pendingCourses, verifyUrl, anyEnrolled, learnerName });

      const html = this.emailService.buildHtml({ title: template.subject, bodyHtml: template.bodyHtml });

      let messageId = null;
      try {
        const info = await this.emailService.sendHtmlEmail({ to: email, subject: template.subject, html });
        messageId = info?.messageId || null;
      } catch (err) {
        results.push({ email, sent: false, error: err?.message || 'send failed' });
        continue;
      }

      let contactId = null;
      try {
        const matches = await this.hubspotService.searchContactsByTerm(email);
        contactId = matches?.[0]?.id || null;
      } catch (_) {}
      try {
        await this.hubspotService.logEmailToDealAndContact({
          dealId: String(deal_id),
          contactId,
          subject: `Email sent: ${template.subject}`,
          bodyHtml: html,
          fromEmail: process.env.EMAIL_FROM || 'training@theodi.org',
          toEmail: email,
          sentAt: Date.now()
        });
      } catch (_) {}

      results.push({ email, sent: true, emailType: determinedEmailType, messageId });
    }

    const summary = {
      totalLearners: emails.length,
      attempted: results.filter(r => !r.skipped).length,
      sent: results.filter(r => r.sent).length,
      skipped: results.filter(r => r.skipped).length
    };
    return { results, summary };
  }
  // Send learner reminder email and log to HubSpot
  async sendLearnerReminder(req, res) {
    try {
      const { deal_id, contact_email, courses, emailType, learner_name } = req.body || {};
      if (!deal_id || !contact_email || !Array.isArray(courses)) {
        return this.sendError(res, 'Missing deal_id, contact_email, or courses[]', HTTP_STATUS.BAD_REQUEST);
      }

      // Determine email type based on previous emails sent (if not explicitly provided)
      const determinedEmailType = emailType || await this.hubspotService.determineEmailType(deal_id, contact_email);

      // Compose email HTML body mirroring verify page instructions
      const moodleRoot = process.env.MOODLE_ROOT || 'https://moodle.learndata.info';
      const anyEnrolled = (courses || []).some(c => c.enrolled);
      
      // Build verification URL for deal-based verification
      const baseUrl = process.env.BASE_URL || 'http://localhost:3080';
      const verifyUrl = `${baseUrl}/enrollments/verify?deal_id=${deal_id}&email=${encodeURIComponent(contact_email)}`;
      
      // Use provided learner name or fallback to lookup
      let learnerName = learner_name;
      let contactId = null;
      
      if (!learnerName) {
        try {
          const matches = await this.hubspotService.searchContactsByTerm(contact_email);
          const first = matches?.[0] || null;
          contactId = first?.id || null;
          const props = first?.properties || {};
          const firstName = props.firstname || props.firstName || '';
          const lastName = props.lastname || props.lastName || '';
          const full = `${firstName} ${lastName}`.trim();
          learnerName = full || props.name || props.fullname || 'Learner';
        } catch (_) {
          learnerName = 'Learner';
        }
      } else {
        // Still need contactId for logging
        try {
          const matches = await this.hubspotService.searchContactsByTerm(contact_email);
          contactId = matches?.[0]?.id || null;
        } catch (_) {}
      }

      const template = determinedEmailType === 'welcome' 
        ? buildWelcomeEmail({ moodleRootUrl: moodleRoot, courses, verifyUrl, anyEnrolled, learnerName })
        : buildReminderEmail({ moodleRootUrl: moodleRoot, courses, verifyUrl, anyEnrolled, learnerName });
      
      const html = this.emailService.buildHtml({ title: template.subject, bodyHtml: template.bodyHtml });

      // Send email
      const info = await this.emailService.sendHtmlEmail({
        to: contact_email,
        subject: template.subject,
        html
      });

      // contactId already resolved above

      // Log to HubSpot (as a Note associated to deal and contact)
      await this.hubspotService.logEmailToDealAndContact({
        dealId: String(deal_id),
        contactId: contactId,
        subject: `Email sent: ${template.subject}`,
        bodyHtml: html,
        fromEmail: process.env.EMAIL_FROM || 'training@theodi.org',
        toEmail: contact_email,
        sentAt: Date.now()
      });

      return this.sendSuccess(res, { 
        messageId: info?.messageId || null, 
        emailType: determinedEmailType,
        subject: template.subject 
      }, `${determinedEmailType === 'welcome' ? 'Welcome' : 'Reminder'} email sent`);
    } catch (error) {
      return this.sendError(res, error.message || 'Failed to send reminder');
    }
  }

  // Get companies with pagination
  async getCompanies(req, res) {
    try {
      const { after } = req.query;
      const result = await this.hubspotService.fetchCompaniesBatch(after);
      return this.sendSuccess(res, result);
    } catch (error) {
      return this.sendError(res, 'Failed to fetch companies');
    }
  }

  // Handle self-paced form submission
  async handleSelfPacedSubmission(req, res) {
    try {
      const requiredFields = [
        'course_name_sp',
        'client_requestor_sp',
        'client_requestor_email_sp',
        'pipeline_sp',
        'self_paced'
      ];

      const validation = this.handleValidation(req, res, requiredFields);
      if (validation) return validation;

      const payload = { ...req.body };
      //console.log('Self-paced form submission:', payload);

      // Create HubSpot deal for self-paced course
      let dealResult = null;
      try {
        dealResult = await this.createSelfPacedHubSpotDeal(payload);
        console.log('HubSpot deal created for self-paced course:', dealResult);
      } catch (error) {
        console.error('Failed to create HubSpot deal for self-paced course:', error.message);
        return this.renderPage(req, res, 'pages/hubspot/error', {
          title: 'Error',
          message: 'Failed to create HubSpot deal. Please try again.'
        });
      }

      return this.renderPage(req, res, 'pages/hubspot/success', {
        title: 'Form Submitted',
        message: 'Form submitted successfully!',
        data: payload,
        dealId: dealResult.id
      });
    } catch (error) {
      return this.renderPage(req, res, 'pages/hubspot/error', {
        title: 'Error',
        message: 'An unexpected error occurred while processing your submission.'
      });
    }
  }

  // Handle form submission
  async handleFormSubmission(req, res) {
    try {
      const requiredFields = [
        'sub_client',
        'course_location',
        'course_name',
        'course_datetime',
        'course_duration',
        'tutor_name',
        'tutor_email',
        'client_requestor',
        'client_requestor_email',
        'value',
        'pipeline',
        'completed_by_name',
        'completed_by_email',
        'submission_timestamp'
      ];

      const validation = this.handleValidation(req, res, requiredFields);
      if (validation) return validation;

      const payload = { ...req.body };
      console.log('Form submission:', payload);

      // Create HubSpot deal
      let dealResult = null;
      try {
        dealResult = await this.createHubSpotDeal(payload);
        console.log('HubSpot deal created:', dealResult);
      } catch (error) {
        console.error('Failed to create HubSpot deal:', error.message);
        return this.renderPage(req, res, 'pages/hubspot/error', {
          title: 'Error',
          message: 'Failed to create HubSpot deal. Please try again.'
        });
      }

      // Send to Zapier (keeping for backward compatibility)
      /*
      try {
        await this.hubspotService.sendToZapier(payload);
      } catch (error) {
        console.error('Zapier webhook failed:', error.message);
        // Fallback logging
        this.hubspotService.logFallback(payload, error.message);
      }*/

      return this.renderPage(req, res, 'pages/hubspot/success', {
        title: 'Form Submitted',
        message: 'Form submitted successfully!',
        data: payload,
        dealId: dealResult.id
      });
    } catch (error) {
      return this.renderPage(req, res, 'pages/hubspot/error', {
        title: 'Error',
        message: 'An unexpected error occurred while processing your submission.'
      });
    }
  }

  // AJAX: Create HubSpot deal and return JSON
  async createDealAjax(req, res) {
    try {
      const requiredFields = [
        'sub_client',
        'course_location',
        'course_name',
        'course_datetime',
        'course_duration',
        'tutor_name',
        'tutor_email',
        'client_requestor',
        'client_requestor_email',
        'value',
        'pipeline',
        'completed_by_name',
        'completed_by_email',
        'submission_timestamp'
      ];

      const validation = this.handleValidation(req, res, requiredFields);
      if (validation) return; // handleValidation already responded

      const payload = { ...req.body };

      try {
        const deal = await this.createHubSpotDeal(payload);
        const portalId = process.env.HUBSPOT_PORTAL_ID || '748510';
        const dealUrl = `https://app.hubspot.com/contacts/${portalId}/deal/${deal.id}`;
        return this.sendSuccess(res, { id: deal.id, url: dealUrl, properties: deal.properties });
      } catch (error) {
        const err = error.response?.data || { message: error.message };
        return this.sendError(res, err.message || 'Failed to create HubSpot deal');
      }
    } catch (error) {
      return this.sendError(res, 'Unexpected error creating HubSpot deal');
    }
  }

  // Create contact
  async createContact(req, res) {
    try {
      const contact = await this.hubspotService.createContact(req.body);
      return this.sendSuccess(res, { contact });
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Handle webhook
  async handleWebhook(req, res) {
    try {
      const webhookSecret = process.env.HUBSPOT_WEBHOOK_SECRET;
      const isValid = this.hubspotService.verifyWebhookSignature(req, webhookSecret);

      if (!isValid) {
        console.warn('Invalid HubSpot webhook signature');
        return res.status(HTTP_STATUS.FORBIDDEN).send('Forbidden: Invalid signature');
      }

      const event = this.hubspotService.handleWebhook(req);
      //console.log('Valid webhook received:', event);

      return res.status(HTTP_STATUS.OK).send('Webhook received');
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Authenticated webhook: return learner statuses for a deal
  async getDealLearnerStatus(req, res) {
    try {
      const apiKey = req.headers['x-api-key'] || req.query.api_key;
      if (!validateApiKey(apiKey, process.env.WEBHOOK_API_KEY)) {
        return this.sendError(res, 'Forbidden: Invalid API key', HTTP_STATUS.FORBIDDEN);
      }

      const { deal_id } = req.body || req.query || {};
      if (!deal_id) {
        return this.sendError(res, 'Missing deal_id', HTTP_STATUS.BAD_REQUEST);
      }

      // Fetch line items (to get moodle_course_id)
      const lineItems = await this.hubspotService.fetchDealLineItemsWithProducts(deal_id);
      console.log('lineItems', lineItems);
      const courseEntries = lineItems
        .map(li => ({ course_id: parseInt(li.moodle_course_id), term_months: Number(li.term_months) }))
        .filter(e => Number.isFinite(e.course_id));

      // Fetch contacts labeled as Learner
      const learners = await this.hubspotService.fetchDealContactsByLabel(deal_id, 'Learner');
      const emails = learners.map(l => l.email).filter(Boolean);

      const results = [];
      for (const email of emails) {
        for (const entry of courseEntries) {
          const cid = entry.course_id;
          const termMonths = Number.isFinite(entry.term_months) && entry.term_months > 0 ? entry.term_months : 12;
          console.log('termMonths', termMonths);
          try {
            const status = await this.enrollmentService.getUserCourseStatus(cid, email, termMonths);
            results.push({
              email,
              course_id: cid,
              enrolled: Boolean(status?.enrolled),
              accessed: Boolean(status?.accessed)
            });
          } catch (e) {
            results.push({ email, course_id: cid, enrolled: false, accessed: false, error: e?.message || 'lookup failed' });
          }
        }
      }

      return this.sendSuccess(res, results, 'Learner status fetched');
    } catch (error) {
      return this.sendError(res, error.message || 'Failed to fetch learner status');
    }
  }

  // Get products
  async getProducts(req, res) {
    try {
      const acceptHeader = req.get('accept') || '';
      if (acceptHeader.includes('application/json')) {
        const data = await this.hubspotService.fetchProducts();
        return this.sendSuccess(res, data);
      }

      return this.renderPage(req, res, 'pages/hubspot/index', {
        title: 'HubSpot Products',
        data: [],
        type: 'products',
        endpoint: '/hubspot/products'
      });
    } catch (error) {
      return this.sendError(res, 'Failed to fetch products');
    }
  }

  // Get deals for product
  async getProductDeals(req, res) {
    try {
      const { productId } = req.params;
      const acceptHeader = req.get('accept') || '';
      
      if (acceptHeader.includes('application/json')) {
        const deals = await this.hubspotService.getDealsForProduct(productId);
        return this.sendSuccess(res, deals);
      }

      return this.renderPage(req, res, 'pages/hubspot/index', {
        title: `Deals for Product ${productId}`,
        data: [],
        type: 'deals',
        endpoint: `/hubspot/products/${productId}/deals`
      });
    } catch (error) {
      return this.sendError(res, 'Failed to fetch deals');
    }
  }

  // Get courses (products with type "Learning Course")
  async getCourses(req, res) {
    try {
      const acceptHeader = req.get('accept') || '';
      if (acceptHeader.includes('application/json')) {
        const data = await this.hubspotService.fetchCourses();
        return this.sendSuccess(res, data);
      }

      return this.renderPage(req, res, 'pages/hubspot/courses/index', {
        title: 'HubSpot Courses',
        data: [],
        type: 'courses',
        endpoint: '/hubspot/courses'
      });
    } catch (error) {
      return this.sendError(res, 'Failed to fetch courses');
    }
  }

  // Get single course
  async getCourse(req, res) {
    try {
      const { id } = req.params;
      const acceptHeader = req.get('accept') || '';
      
      if (acceptHeader.includes('application/json')) {
        const course = await this.hubspotService.getProduct(id);
        return this.sendSuccess(res, course);
      }

      const course = await this.hubspotService.getProduct(id);
      const portalId = process.env.HUBSPOT_PORTAL_ID || '748510';
      const moodleRoot = process.env.MOODLE_ROOT || 'https://moodle.learndata.info';
      return this.renderPage(req, res, 'pages/hubspot/courses/show', {
        title: `Course: ${course.name}`,
        course: course,
        portalId: portalId,
        moodleRoot: moodleRoot
      });
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Show course creation form
  async showCreateCourse(req, res) {
    return this.renderPage(req, res, 'pages/hubspot/courses/edit', {
      title: 'Create New Course',
      course: {
        name: '',
        description: '',
        price: '',
        sku: '',
        billing_period: '',
        enrollment_duration_months: '',
        moodle_course_id: '',
        learning_price_members: '',
        price_gov_campus: '',
        notes: '',
        learning_course_type: ''
      }
    });
  }

  // Show course edit form
  async showEditCourse(req, res) {
    try {
      const { id } = req.params;
      const course = await this.hubspotService.getProduct(id);
      
      return this.renderPage(req, res, 'pages/hubspot/courses/edit', {
        title: `Edit Course: ${course.name}`,
        course: {
          ...course,
          enrollment_duration_months: course.billing_period || ''
        }
      });
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Create new course
  async createCourse(req, res) {
    try {
      const acceptHeader = req.get('accept') || '';
      
      const courseData = {
        name: req.body.name,
        type: 'Learning Course',
        description: req.body.description || '',
        price: req.body.price || '',
        sku: req.body.sku || '',
        billing_period: req.body.enrollment_duration_months || req.body.billing_period || '',
        enrollment_duration_months: req.body.enrollment_duration_months || '',
        moodle_course_id: req.body.moodle_course_id || '',
        learning_price_members: req.body.learning_price_members || '',
        price_gov_campus: req.body.price_gov_campus || '',
        notes: req.body.notes || '',
        learning_course_type: req.body.learning_course_type || ''
      };

      const result = await this.hubspotService.createProduct(courseData);
      
      if (acceptHeader.includes('application/json')) {
        return this.sendSuccess(res, result, 'Course created successfully', HTTP_STATUS.CREATED);
      }

      // Redirect to the course view page
      return res.redirect(`/hubspot/courses/${result.id}`);
    } catch (error) {
      if (req.get('accept')?.includes('application/json')) {
        return this.sendError(res, error.message);
      }
      
      // Re-render form with error
      return this.renderPage(req, res, 'pages/hubspot/courses/edit', {
        title: 'Create New Course',
        course: req.body,
        error: error.message
      });
    }
  }

  // Update existing course
  async updateCourse(req, res) {
    try {
      const { id } = req.params;
      const acceptHeader = req.get('accept') || '';
      
      const courseData = {
        name: req.body.name,
        type: 'Learning Course',
        description: req.body.description || '',
        price: req.body.price || '',
        sku: req.body.sku || '',
        billing_period: req.body.enrollment_duration_months || req.body.billing_period || '',
        enrollment_duration_months: req.body.enrollment_duration_months || '',
        moodle_course_id: req.body.moodle_course_id || '',
        learning_price_members: req.body.learning_price_members || '',
        price_gov_campus: req.body.price_gov_campus || '',
        notes: req.body.notes || '',
        learning_course_type: req.body.learning_course_type || ''
      };

      const result = await this.hubspotService.updateProduct(id, courseData);
      
      if (acceptHeader.includes('application/json')) {
        return this.sendSuccess(res, result, 'Course updated successfully');
      }

      // Redirect to the course view page
      return res.redirect(`/hubspot/courses/${id}`);
    } catch (error) {
      if (req.get('accept')?.includes('application/json')) {
        return this.sendError(res, error.message);
      }
      
      // Re-render form with error
      const course = { id: req.params.id, ...req.body };
      return this.renderPage(req, res, 'pages/hubspot/courses/edit', {
        title: `Edit Course: ${course.name}`,
        course: course,
        error: error.message
      });
    }
  }

  // Handle webhook form (external)
  async handleWebhookForm(req, res) {
    try {
      //console.log('[Webhook] Incoming HubSpot form payload:', JSON.stringify({ query: req.query, body: req.body }, null, 2));
      const apiKey = req.headers['x-api-key'] || req.query.api_key;
      
      if (!validateApiKey(apiKey, process.env.WEBHOOK_API_KEY)) {
        return this.sendError(res, 'Forbidden: Invalid API key', HTTP_STATUS.FORBIDDEN);
      }

      const { project_id } = req.query;
      
      if (!validateProjectId(project_id)) {
        return this.sendError(res, 'Invalid or missing project_id', HTTP_STATUS.BAD_REQUEST);
      }

      const requiredFields = [
        'hs_form_title',
        'hs_form_id',
        'first_name',
        'last_name',
        'email'
      ];

      const validation = this.handleValidation(req, res, requiredFields);
      if (validation) return validation;

      const taskData = this.buildTaskData(req.body, project_id);
      //console.log('[Webhook] Creating Forecast task with payload:', JSON.stringify(taskData, null, 2));
      const result = await this.forecastService.createTask(taskData);
      //console.log('[Webhook] Forecast task created:', JSON.stringify(result, null, 2));

      return this.sendSuccess(res, {
        id: result?.id,
        url: result?.url || null,
        project_id: result?.project_id || taskData.project_id,
        title: result?.title || taskData.title
      }, 'Task created successfully', HTTP_STATUS.CREATED);
    } catch (error) {
      console.error('[Webhook] Failed to create Forecast task:', error.response?.data || error.message || error);
      return this.sendError(res, error.response?.data || 'Failed to create task in Forecast');
    }
  }

  // Helper methods
  buildTaskData(body, projectId) {
    const portalId = process.env.HUBSPOT_PORTAL_ID || "748510";
    const formSubmissionLink = `https://app.hubspot.com/submissions/${portalId}/form/${body.hs_form_id}/submissions`;

    return {
      title: `${body.first_name} ${body.last_name} | ${body.hs_form_title}`,
      description: `
        <strong>Form:</strong> ${body.hs_form_title}<br/>
        <strong>Name:</strong> ${body.first_name} ${body.last_name}<br/>
        <strong>Email:</strong> ${body.email}<br/>
        <strong>Organisation:</strong> ${body.organisation}<br/>
        <strong>Role:</strong> ${body.role || "Not provided"}<br/>
        <strong>Label:</strong> ${body.label || "Not provided"}<br/>
        <strong>Submission Link:</strong> <a href="${formSubmissionLink}" target="_blank">${formSubmissionLink}</a>
      `.trim(),
      project_id: parseInt(projectId),
      approved: true
    };
  }

  // Create HubSpot deal from form data
  async createHubSpotDeal(formData) {
    // Format the deal name: "Course Booking | <product_name> | <YYYY-MM-DD>"
    const courseDate = new Date(formData.course_datetime);
    const dateString = courseDate.toISOString().split('T')[0]; // YYYY-MM-DD format
    const dealName = `Course Booking | ${formData.course_name} | ${dateString}`;

    // Create description with optional booking reference (plain text)
    const description = `Course: ${formData.course_name}
Location: ${formData.course_location}
Date & Time: ${formData.course_datetime}
Duration: ${formData.course_duration} hours
Tutor: ${formData.tutor_name} (${formData.tutor_email})
${formData.booking_ref ? `Booking Reference: ${formData.booking_ref}` : 'Booking Reference: Not provided'}
Completed By: ${formData.completed_by_name} (${formData.completed_by_email})`.trim();

    // Find the deal owner (person who submitted the form)
    let ownerId = null;
    try {
      const owner = await this.hubspotService.findUserByEmail(formData.completed_by_email);
      if (owner) {
        ownerId = owner.id;
        console.log(`Found deal owner: ${owner.firstName} ${owner.lastName} (${owner.id})`);
      } else {
        console.log(`No HubSpot user found for email: ${formData.completed_by_email}`);
      }
    } catch (error) {
      console.error('Failed to find deal owner:', error.message);
    }

    // Prepare deal data
    const dealData = {
      dealName: dealName,
      value: formData.value,
      pipelineId: formData.pipeline,
      stageId: HUBSPOT_CONFIG.DEFAULT_DEAL_STAGE_ID,
      description: description,
      closeDate: Date.now(), // Today's date as timestamp
      startDate: new Date(formData.course_datetime).toISOString().split('T')[0], // Course start date as YYYY-MM-DD
      courseName: formData.course_name, // Course name for custom property
      ownerId: ownerId, // Deal owner ID
      companyId: formData.sub_client, // This is the company ID from the dropdown
      contactId: null, // We'll handle contact creation/linking separately
      productId: null // We'll need to find the product ID by name
    };

    // Find or create contact
    try {
      const contactResult = await this.findOrCreateContact(formData);
      dealData.contactId = contactResult.id;
    } catch (error) {
      console.error('Failed to find/create contact:', error.message);
      // Continue without contact association
    }

    // Use product ID directly from form
    if (formData.course_id && formData.course_id.trim() !== '') {
      console.log(`Using product ID from form: ${formData.course_id}`);
      dealData.productId = formData.course_id; // This is now the product ID
    }

    // Create the deal
    return await this.hubspotService.createDeal(dealData);
  }

  // Find or create contact
  async findOrCreateContact(formData) {
    const clientName = formData.client_requestor;
    const clientEmail = formData.client_requestor_email;
    const clientId = formData.client_requestor_id;

    // If we have a contact ID, use it directly (existing contact selected)
    if (clientId && clientId.trim() !== '') {
      return { id: clientId };
    }

    // Check if this is a new client (no email provided)
    if (!clientEmail || clientEmail === clientName || clientEmail.trim() === '') {
      // This is a new client, create contact
      const [firstName, ...lastNameParts] = clientName.split(' ');
      const lastName = lastNameParts.join(' ') || '';

      const contactData = {
        firstName: firstName,
        lastName: lastName,
        email: '', // We'll need to get this from the user
        phone: ''
      };

      return await this.hubspotService.createContact(contactData);
    } else {
      // This is an existing client, find the contact
      const contacts = await this.hubspotService.searchContactsByTerm(clientEmail);
      if (contacts.length > 0) {
        return contacts[0];
      } else {
        // Contact not found, create new one
        const [firstName, ...lastNameParts] = clientName.split(' ');
        const lastName = lastNameParts.join(' ') || '';

        const contactData = {
          firstName: firstName,
          lastName: lastName,
          email: clientEmail,
          phone: ''
        };

        return await this.hubspotService.createContact(contactData);
      }
    }
  }

  // Find product ID by name (kept for backward compatibility)
  async findProductIdByName(productName) {
    const products = await this.hubspotService.fetchProducts();
    const product = products.find(p => p.name === productName);
    return product ? product.id : null;
  }

  // Create HubSpot deal for self-paced course
  async createSelfPacedHubSpotDeal(formData) {
    // Format the deal name: "Self-Paced Course | <product_name> | <YYYY-MM-DD>"
    const currentDate = new Date();
    const dateString = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD format
    const dealName = `Self-Paced Course | ${formData.course_name_sp} | ${dateString}`;

    // Create description for self-paced course (plain text)
    const description = `Course: ${formData.course_name_sp}
Type: Self-Paced
Date: ${dateString}
Client: ${formData.client_requestor_sp}
Client Email: ${formData.client_requestor_email_sp}`.trim();

    // Find the deal owner (person who submitted the form)
    let ownerId = null;
    try {
      const owner = await this.hubspotService.findUserByEmail(formData.completed_by_email);
      if (owner) {
        ownerId = owner.id;
        console.log(`Found deal owner for self-paced: ${owner.firstName} ${owner.lastName} (${owner.id})`);
      } else {
        console.log(`No HubSpot user found for email: ${formData.completed_by_email}`);
      }
    } catch (error) {
      console.error('Failed to find deal owner for self-paced:', error.message);
    }

    // Prepare deal data
    const dealData = {
      dealName: dealName,
      value: "0", // Self-paced courses might not have a fixed value
      pipelineId: formData.pipeline_sp,
      stageId: HUBSPOT_CONFIG.DEFAULT_DEAL_STAGE_ID,
      description: description,
      closeDate: Date.now(), // Today's date as timestamp
      startDate: currentDate.toISOString().split('T')[0], // Current date as YYYY-MM-DD
      courseName: formData.course_name_sp, // Course name for custom property
      ownerId: ownerId, // Deal owner ID
      companyId: null, // Self-paced might not have a company
      contactId: null,
      productId: null
    };

    // Find or create contact
    try {
      const contactResult = await this.findOrCreateContact({
        client_requestor: formData.client_requestor_sp,
        client_requestor_email: formData.client_requestor_email_sp,
        client_requestor_id: formData.client_requestor_id_sp
      });
      dealData.contactId = contactResult.id;
    } catch (error) {
      console.error('Failed to find/create contact for self-paced course:', error.message);
    }

    // Use product ID directly from form
    if (formData.course_id_sp && formData.course_id_sp.trim() !== '') {
      console.log(`Using product ID from self-paced form: ${formData.course_id_sp}`);
      dealData.productId = formData.course_id_sp; // This is now the product ID
    }

    // Create the deal
    return await this.hubspotService.createDeal(dealData);
  }
}

export default HubSpotController;
