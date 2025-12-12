// HubSpot controller

import BaseController from './BaseController.js';
import { HubSpotService } from '../services/hubspotService.js';
import { EmailService } from '../services/emailService.js';
import { buildWelcomeEmail, buildReminderEmail } from '../services/emailTemplates.js';
import { ForecastService } from '../services/forecastService.js';
import { EnrollmentService } from '../services/enrollmentService.js';
import { MoodleService } from '../services/moodleService.js';
import { validateApiKey, validateProjectId } from '../utils/validation.js';
import { HTTP_STATUS, HUBSPOT_CONFIG, DEBUG_MODE } from '../config/constants.js';
import { IGNORED_PIPELINE_LABELS } from '../config/pipelines.js';

export class HubSpotController extends BaseController {
  constructor() {
    super();
    this.hubspotService = new HubSpotService();
    this.forecastService = new ForecastService();
    this.enrollmentService = new EnrollmentService();
    this.emailService = new EmailService();
    this.moodleService = new MoodleService();
    // In-memory short-term caches to reduce repeated HubSpot lookups per deal
    this.lineItemsCache = new Map();   // key: dealId -> { ts, data }
    this.dealLearnersCache = new Map(); // key: `${dealId}:Learner` -> { ts, data }
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

  // Get deals (by pipeline) with content negotiation
  async getDeals(req, res) {
    try {
      const acceptHeader = req.get('accept') || '';
      const rawPipes = req.query.pipeline || req.query.pipelines || process.env.HUBSPOT_DEFAULT_PIPELINE_ID;
      const pipelineIds = Array.isArray(rawPipes)
        ? rawPipes.map(String)
        : String(rawPipes || '').split(',').map(s => s.trim()).filter(Boolean);
      const debug = String(req.query.debug || '').toLowerCase() === 'true';

      if (acceptHeader.includes('application/json')) {
        // Fetch deals and return JSON (multi-pipeline support)
        let deals = [];
        if (pipelineIds.length > 1) {
          deals = await this.hubspotService.fetchDealsFromPipelines(pipelineIds);
        } else {
          deals = await this.hubspotService.fetchDealsFromPipeline(pipelineIds[0]);
        }
        // Filter: remove closed (won/lost/100%) older than 24 months to reduce data size
        const twentyFourMonthsAgo = new Date();
        twentyFourMonthsAgo.setMonth(twentyFourMonthsAgo.getMonth() - 24);
        const cutoffTs = twentyFourMonthsAgo.getTime();
        const filteredDeals = deals.filter(d => {
          const p = d?.properties || {};
          const cd = p.closedate ? new Date(p.closedate) : null;
          const prob = Number(p.hs_deal_stage_probability);
          const isHundred = Number.isFinite(prob) && prob >= 1;
          const stageText = String(p.dealstage || '').toLowerCase();
          const isClosed = isHundred || stageText.includes('closed') || stageText.includes('won') || stageText.includes('lost');
          if (!isClosed) return true;
          if (!cd || !Number.isFinite(cd.getTime())) return true;
          return cd.getTime() >= cutoffTs;
        });
        // Also fetch pipelines to map stage labels client-side if needed
        let pipelines = [];
        try {
          pipelines = await this.hubspotService.fetchPipelines();
          if (Array.isArray(pipelines) && IGNORED_PIPELINE_LABELS?.length) {
            pipelines = pipelines.filter(p => !IGNORED_PIPELINE_LABELS.includes(p.label));
          }
        } catch (_) {}
        // Fetch owners to resolve names client-side
        let owners = [];
        try {
          owners = await this.hubspotService.fetchOwners();
        } catch (_) {}
        if (debug) {
          if (Array.isArray(filteredDeals) && filteredDeals.length > 0) {
            const sample = filteredDeals[0];
          }
        }
        return this.sendSuccess(res, { deals: filteredDeals, pipelines, owners, currentPipeline: pipelineIds[0] || null, selectedPipelines: pipelineIds });
      }

      // HTML page render with pipelines for selector
      let pipelines = [];
      try {
        pipelines = await this.hubspotService.fetchPipelines();
        if (Array.isArray(pipelines) && IGNORED_PIPELINE_LABELS?.length) {
          pipelines = pipelines.filter(p => !IGNORED_PIPELINE_LABELS.includes(p.label));
        }
      } catch (e) {
        pipelines = [];
      }
      const envDefault = process.env.HUBSPOT_DEFAULT_PIPELINE_ID || '';
      const preferred = pipelines.find(p => (p.label || '').toLowerCase() === 'learning and consultancy');
      const currentPipeline = pipelineIds[0] || preferred?.id || envDefault || (pipelines[0]?.id || '');

      if (debug) {
      }
      return this.renderPage(req, res, 'pages/hubspot/deals/index', {
        title: 'HubSpot Deals',
        pipelines,
        currentPipeline
      });
    } catch (error) {
      console.error('[GET /hubspot/deals] error:', error?.response?.data || error?.message || error);
      return this.sendError(res, 'Failed to fetch deals');
    }
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
      const singleEmail = (req.query.email || '').toString().trim().toLowerCase();
      const debug = DEBUG_MODE.ENABLED;
      const debugLog = (...args) => { if (debug) console.log('[getDealLearnerMatrix]', ...args); };

      // Fetch line items (to get moodle_course_id and term months) with short TTL cache
      const lineItemsTtl = 5 * 60 * 1000; // 5 minutes
      const now = Date.now();
      const cachedLineItems = this.lineItemsCache.get(String(id));
      let lineItems = null;
      if (cachedLineItems && (now - cachedLineItems.ts) < lineItemsTtl) {
        lineItems = cachedLineItems.data;
        debugLog('line items cached hit', { count: Array.isArray(lineItems) ? lineItems.length : 0 });
      } else {
        lineItems = await this.hubspotService.fetchDealLineItemsWithProducts(id);
        this.lineItemsCache.set(String(id), { ts: now, data: lineItems });
        debugLog('line items fetched', { count: Array.isArray(lineItems) ? lineItems.length : 0 });
      }
      const courseEntries = lineItems
        .map(li => ({
          course_id: parseInt(li.moodle_course_id),
          term_months: Number(li.term_months),
          course_name: li?.product?.name || ''
        }))
        .filter(e => Number.isFinite(e.course_id));

      // Fetch contacts labeled as Learner with short TTL cache
      const learnersTtl = 5 * 60 * 1000; // 5 minutes
      const learnersCacheKey = `${id}:Learner`;
      const cachedLearners = this.dealLearnersCache.get(learnersCacheKey);
      let learners = null;
      if (cachedLearners && (now - cachedLearners.ts) < learnersTtl) {
        learners = cachedLearners.data;
        debugLog('learners cached hit', { count: Array.isArray(learners) ? learners.length : 0 });
      } else {
        learners = await this.hubspotService.fetchDealContactsByLabel(id, 'Learner');
        this.dealLearnersCache.set(learnersCacheKey, { ts: now, data: learners });
        debugLog('learners fetched', { count: Array.isArray(learners) ? learners.length : 0 });
      }
      const emails = learners
        .map(l => l.email)
        .filter(Boolean)
        .map(e => e.toLowerCase());

      // If a specific learner email is requested, only process that learner to reduce workload
      const targetEmails = singleEmail ? emails.filter(e => e === singleEmail) : emails;

      // Caches to avoid repeated Moodle calls when many learners/courses exist
      const courseEnrollmentsCache = new Map(); // courseId -> enrolments array (local per-request cache)
      const userLookupCache = new Map(); // email -> moodle user (or null)
      const enrollmentDetailsCache = new Map(); // `${userId}:courseId` -> details (or null)

      const getCourseEnrollmentsFor = async (courseId) => {
        const cacheKey = String(courseId);
        // Check local per-request cache first
        if (courseEnrollmentsCache.has(cacheKey)) {
          return courseEnrollmentsCache.get(cacheKey);
        }
        // Use enrollmentService cached version (with promise deduplication across requests)
        try {
          const enrolments = await this.enrollmentService.getCourseEnrollmentsCached(parseInt(courseId));
          const normalized = Array.isArray(enrolments) ? enrolments : [];
          // Store in local cache too for this request
          courseEnrollmentsCache.set(cacheKey, normalized);
          debugLog('getCourseEnrolments', { courseId, count: normalized.length });
          return normalized;
        } catch (err) {
          debugLog('getCourseEnrolments error', { courseId, error: err?.message });
          courseEnrollmentsCache.set(cacheKey, []);
          return [];
        }
      };

      // Build matrix: rows=learners, cols=courses
      const results = [];
      for (const email of targetEmails) {
        const learner = learners.find(l => l.email === email);
        const firstName = learner?.first_name || '';
        const lastName = learner?.last_name || '';
        const fullName = `${firstName} ${lastName}`.trim() || 'Learner';
        // Ensure Moodle user exists for this learner before status checks
        let moodleUserId = null;
        try {
          if (this.moodleService && this.moodleService.ensureUser) {
            moodleUserId = await this.moodleService.ensureUser({ email, firstName, lastName });
            debugLog('ensureUser', { email, moodleUserId });
          } else {
            const existing = await this.moodleService.lookupUserByEmail(email);
            moodleUserId = existing?.id || null;
            debugLog('lookupUserByEmail (fallback ensure)', { email, moodleUserId });
          }
        } catch (error) {
          try {
            const existing = await this.moodleService.lookupUserByEmail(email);
            moodleUserId = existing?.id || null;
            debugLog('lookupUserByEmail (error path)', { email, moodleUserId, error: error?.message });
          } catch (lookupError) {
            
          }
        }
        // Get Moodle login info for display
        let loginInfo = { exists: false, ever_logged_in: false, last_access: null };
        try {
          loginInfo = await this.moodleService.getUserLoginInfoByEmail(email);
          debugLog('getUserLoginInfoByEmail', { email, last_access: loginInfo?.last_access });
        } catch (_) {}
        const row = { email, name: fullName, login: loginInfo, courses: [] };
        for (const entry of courseEntries) {
          const cid = entry.course_id;
          const termMonths = Number.isFinite(entry.term_months) && entry.term_months > 0 ? entry.term_months : 12;
          try {
            const courseEnrollments = await getCourseEnrollmentsFor(cid);
            let status = await this.enrollmentService.getUserCourseStatus(cid, email, termMonths, {
              courseEnrollments,
              userLookupCache,
              enrollmentDetailsCache
            });
            debugLog('getUserCourseStatus', { email, courseId: cid, enrolled: status?.enrolled, accessed: status?.accessed });
            if (!status?.enrolled && moodleUserId) {
              try {
                await this.moodleService.enrolUserInCourse(moodleUserId, cid, termMonths);
                debugLog('enrolUserInCourse', { email, moodleUserId, courseId: cid });
                status = await this.enrollmentService.getUserCourseStatus(cid, email, termMonths, {
                  courseEnrollments,
                  userLookupCache,
                  enrollmentDetailsCache
                });
                debugLog('post-enrol getUserCourseStatus', { email, courseId: cid, enrolled: status?.enrolled, accessed: status?.accessed });
              } catch (enrollError) {
                
              }
            } else if (!status?.enrolled && !moodleUserId) {
              
            }
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

  // Lightweight learner list (no Moodle lookups) for a deal
  async getDealLearners(req, res) {
    try {
      const { id } = req.params;
      const learnersTtl = 5 * 60 * 1000; // 5 minutes
      const now = Date.now();
      const cacheKey = `${id}:Learner`;
      const cachedLearners = this.dealLearnersCache.get(cacheKey);
      let learners = null;
      if (cachedLearners && (now - cachedLearners.ts) < learnersTtl) {
        learners = cachedLearners.data;
      } else {
        learners = await this.hubspotService.fetchDealContactsByLabel(id, 'Learner');
        this.dealLearnersCache.set(cacheKey, { ts: now, data: learners });
      }
      const result = (learners || []).map(l => ({
        email: l.email,
        first_name: l.first_name || l.firstname || '',
        last_name: l.last_name || l.lastname || '',
        name: l.name || `${l.first_name || ''} ${l.last_name || ''}`.trim()
      })).filter(l => l.email);

      const acceptHeader = (req.get('accept') || '').toLowerCase();
      if (acceptHeader.includes('application/json')) {
        return this.sendSuccess(res, result, 'Learners for deal');
      }
      // Default to JSON for this endpoint
      return this.sendSuccess(res, result, 'Learners for deal');
    } catch (error) {
      return this.sendError(res, error.message || 'Failed to fetch learners for deal');
    }
  }

  // Update deal fields (stage, closedate)
  async updateDealFields(req, res) {
    try {
      const { id } = req.params;
      const { dealstage, closedate } = req.body || {};
      const payload = {};
      if (dealstage) payload.dealstage = dealstage;
      if (closedate) payload.closedate = closedate;
      if (Object.keys(payload).length === 0) return this.sendError(res, 'No fields to update', HTTP_STATUS.BAD_REQUEST);
      const updated = await this.hubspotService.updateDeal(id, payload);
      return this.sendSuccess(res, updated, 'Deal updated');
    } catch (error) {
      return this.sendError(res, error?.response?.data || error?.message || 'Failed to update deal');
    }
  }

  // Add a note to a deal
  async addDealNote(req, res) {
    try {
      const { id } = req.params;
      const { bodyHtml, subject } = req.body || {};
      if (!bodyHtml) return this.sendError(res, 'Missing bodyHtml', HTTP_STATUS.BAD_REQUEST);
      const creatorName = req.user ? (req.user.displayName || req.user.name || req.user.username || '') : '';
      const creatorEmail = req.user ? (req.user.email || (req.user.emails && req.user.emails[0] && req.user.emails[0].value) || '') : '';
      // Create note and associate to deal with Creator header
      const result = await this.hubspotService.logNoteToDealWithCreator({
        dealId: String(id),
        creatorName,
        creatorEmail,
        subject: subject || 'Note',
        bodyHtml: bodyHtml,
        createdAt: Date.now(),
        contactId: null
      });
      return this.sendSuccess(res, result, 'Note added');
    } catch (error) {
      return this.sendError(res, error?.response?.data || error?.message || 'Failed to add note');
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

      // Short-circuit: do not send emails for this specific deal; return OK
      if (String(deal_id) === '51639991127') {
        return this.sendSuccess(res, { deal_id }, 'No-op: reminders suppressed for deal');
      }

      // Check for debug mode
      const debugMode = DEBUG_MODE.EMAIL_DEBUG || 
                       String(req.query.debug || req.body?.debug || '').toLowerCase() === 'true';

      // Require single learner mode to avoid bulk spam: must supply contact_email/email
      const contactEmail = (req.body?.contact_email || req.body?.email || req.query?.contact_email || req.query?.email || '').toString().trim();
      if (!contactEmail) {
        return this.sendError(res, 'contact_email (or email) is required for deal-send-reminders; bulk mode is disabled to avoid spam', HTTP_STATUS.BAD_REQUEST);
      }

      try {
        const result = await this.sendReminderForSingleLearner(deal_id, contactEmail, debugMode);
        return this.sendSuccess(res, result, debugMode ? 'Debug: Reminder would be processed for learner' : 'Reminder processed for learner');
      } catch (err) {
        return this.sendError(res, err?.message || 'Failed to send learner reminder');
      }
    } catch (error) {
      return this.sendError(res, error.message || 'Failed to queue deal reminders');
    }
  }

  // (Removed) getDealReminderStatus: using single endpoint for idempotent queue + status

  // The actual processing, factored out for queue execution
  async processDealLearnerRemindersInternal(deal_id, debugMode = false) {
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
      // Use the contact ID from the deal-associated learner (already fetched above)
      const contactId = learner?.id || null;
      
      if (debugMode) {
        // Debug mode: log what would be sent without actually sending
        console.log(`\n=== DEBUG MODE: Email for ${email} ===`);
        console.log(`Subject: ${template.subject}`);
        console.log(`Email Type: ${determinedEmailType}`);
        console.log(`Learner Name: ${learnerName}`);
        console.log(`Pending Courses:`, pendingCourses.map(c => `${c.course_name} (ID: ${c.course_id})`));
        console.log(`Verify URL: ${verifyUrl}`);
        console.log(`HTML Content Length: ${html.length} characters`);
        console.log(`Contact ID: ${contactId || 'Not found in deal learners'}`);
        
        console.log(`Would log note to HubSpot with:`);
        console.log(`- Deal ID: ${deal_id}`);
        console.log(`- Contact ID: ${contactId || 'null'}`);
        console.log(`- Subject: Email sent: ${template.subject}`);
        console.log(`- From: ${process.env.EMAIL_FROM || 'training@theodi.org'}`);
        console.log(`- To: ${email}`);
        console.log(`=== END DEBUG ===\n`);
        
        results.push({ 
          email, 
          sent: false, 
          debug: true, 
          emailType: determinedEmailType, 
          messageId: 'DEBUG-SIMULATED',
          contactId,
          subject: template.subject,
          courses: pendingCourses,
          verifyUrl
        });
      } else {
        // Normal mode: actually send emails and log notes
        try {
          const info = await this.emailService.sendHtmlEmail({ to: email, subject: template.subject, html });
          messageId = info?.messageId || null;
        } catch (err) {
          results.push({ email, sent: false, error: err?.message || 'send failed' });
          continue;
        }

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
    }

    const summary = {
      totalLearners: emails.length,
      attempted: results.filter(r => !r.skipped).length,
      sent: results.filter(r => r.sent).length,
      skipped: results.filter(r => r.skipped).length
    };
    return { results, summary };
  }
  // Helper: send reminder/welcome for a single learner on a deal
  async sendReminderForSingleLearner(deal_id, contact_email, debugMode = false) {
    const lineItems = await this.hubspotService.fetchDealLineItemsWithProducts(deal_id);
    const courseEntries = lineItems
      .map(li => ({
        course_id: parseInt(li.moodle_course_id),
        term_months: Number(li.term_months),
        course_name: li?.product?.name || ''
      }))
      .filter(e => Number.isFinite(e.course_id));

    // Verify the contact is actually associated with the deal and labeled as Learner
    let contactId = null;
    let firstName = '';
    let lastName = '';
    let learnerName = 'Learner';
    
    try {
      const dealLearners = await this.hubspotService.fetchDealContactsByLabel(deal_id, 'Learner');
      const learner = dealLearners.find(l => l.email === contact_email);
      
      if (!learner) {
        throw new Error(`Contact ${contact_email} is not associated with deal ${deal_id} or not labeled as Learner`);
      }
      
      // Use the contact data from the deal association
      contactId = learner.id;
      firstName = learner.first_name || '';
      lastName = learner.last_name || '';
      const full = `${firstName} ${lastName}`.trim();
      learnerName = full || learner.name || 'Learner';
    } catch (error) {
      // If we can't verify the contact is associated with the deal, throw an error
      throw new Error(`Failed to verify contact association: ${error.message}`);
    }

    // Ensure Moodle user exists (auth oauth2), but do not modify if already present
    let moodleUserId = null;
    try {
      if (this.moodleService && this.moodleService.ensureUser) {
        moodleUserId = await this.moodleService.ensureUser({ email: contact_email, firstName, lastName });
      }
    } catch (_) {
      const existing = await this.moodleService.lookupUserByEmail(contact_email);
      moodleUserId = existing?.id || null;
    }

    const statuses = [];
    for (const entry of courseEntries) {
      const cid = entry.course_id;
      const termMonths = Number.isFinite(entry.term_months) && entry.term_months > 0 ? entry.term_months : 12;
      try {
        let status = await this.enrollmentService.getUserCourseStatus(cid, contact_email, termMonths);
        if (!status?.enrolled && moodleUserId) {
          try {
            await this.moodleService.enrolUserInCourse(moodleUserId, cid, termMonths);
            status = await this.enrollmentService.getUserCourseStatus(cid, contact_email, termMonths);
          } catch (_) {}
        }
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
      return { email: contact_email, skipped: true, reason: 'all courses completed' };
    }

    const determinedEmailType = await this.hubspotService.determineEmailType(deal_id, contact_email);
    const moodleRoot = process.env.MOODLE_ROOT || 'https://moodle.learndata.info';
    const baseUrl = process.env.BASE_URL || 'http://localhost:3080';
    const anyEnrolled = pendingCourses.some(c => c.enrolled);
    const verifyUrl = `${baseUrl}/enrollments/verify?deal_id=${deal_id}&email=${encodeURIComponent(contact_email)}`;

    // learnerName determined above

    const template = determinedEmailType === 'welcome'
      ? buildWelcomeEmail({ moodleRootUrl: moodleRoot, courses: pendingCourses, verifyUrl, anyEnrolled, learnerName })
      : buildReminderEmail({ moodleRootUrl: moodleRoot, courses: pendingCourses, verifyUrl, anyEnrolled, learnerName });
    const html = this.emailService.buildHtml({ title: template.subject, bodyHtml: template.bodyHtml });

    let messageId = null;
    // contactId is already set from the deal learner verification above

    if (debugMode) {
      // Debug mode: log what would be sent without actually sending
      console.log(`\n=== DEBUG MODE: Single Learner Email for ${contact_email} ===`);
      console.log(`Subject: ${template.subject}`);
      console.log(`Email Type: ${determinedEmailType}`);
      console.log(`Learner Name: ${learnerName}`);
      console.log(`Pending Courses:`, pendingCourses.map(c => `${c.course_name} (ID: ${c.course_id})`));
      console.log(`Verify URL: ${verifyUrl}`);
      console.log(`HTML Content Length: ${html.length} characters`);
      console.log(`Contact ID: ${contactId || 'Not found in deal learners'}`);
      
      console.log(`Would log note to HubSpot with:`);
      console.log(`- Deal ID: ${deal_id}`);
      console.log(`- Contact ID: ${contactId || 'null'}`);
      console.log(`- Subject: Email sent: ${template.subject}`);
      console.log(`- From: ${process.env.EMAIL_FROM || 'training@theodi.org'}`);
      console.log(`- To: ${contact_email}`);
      console.log(`=== END DEBUG ===\n`);
      
      return { 
        email: contact_email, 
        sent: false, 
        debug: true, 
        emailType: determinedEmailType, 
        messageId: 'DEBUG-SIMULATED',
        contactId,
        subject: template.subject,
        courses: pendingCourses,
        verifyUrl
      };
    } else {
      // Normal mode: actually send email and log note
      const info = await this.emailService.sendHtmlEmail({ to: contact_email, subject: template.subject, html });
      messageId = info?.messageId || null;

      try {
        await this.hubspotService.logEmailToDealAndContact({
          dealId: String(deal_id),
          contactId,
          subject: `Email sent: ${template.subject}`,
          bodyHtml: html,
          fromEmail: process.env.EMAIL_FROM || 'training@theodi.org',
          toEmail: contact_email,
          sentAt: Date.now()
        });
      } catch (_) {}

      return { email: contact_email, sent: true, emailType: determinedEmailType, messageId };
    }
  }
  // Send learner reminder email and log to HubSpot
  async sendLearnerReminder(req, res) {
    try {
      const { deal_id, contact_email, courses, emailType, learner_name, debug } = req.body || {};
      if (!deal_id || !contact_email || !Array.isArray(courses)) {
        return this.sendError(res, 'Missing deal_id, contact_email, or courses[]', HTTP_STATUS.BAD_REQUEST);
      }

      // Check for debug mode
      const debugMode = DEBUG_MODE.EMAIL_DEBUG || 
                       String(debug || req.query?.debug || '').toLowerCase() === 'true';

      // Verify the contact is actually associated with the deal and labeled as Learner
      let contactId = null;
      let learnerName = learner_name;
      
      try {
        const dealLearners = await this.hubspotService.fetchDealContactsByLabel(deal_id, 'Learner');
        const learner = dealLearners.find(l => l.email === contact_email);
        
        if (!learner) {
          throw new Error(`Contact ${contact_email} is not associated with deal ${deal_id} or not labeled as Learner`);
        }
        
        // Use the contact data from the deal association
        contactId = learner.id;
        if (!learnerName) {
          const firstName = learner.first_name || '';
          const lastName = learner.last_name || '';
          const full = `${firstName} ${lastName}`.trim();
          learnerName = full || learner.name || 'Learner';
        }
      } catch (error) {
        return this.sendError(res, `Failed to verify contact association: ${error.message}`);
      }

      // Determine email type based on previous emails sent (if not explicitly provided)
      const determinedEmailType = emailType || await this.hubspotService.determineEmailType(deal_id, contact_email);

      // Compose email HTML body mirroring verify page instructions
      const moodleRoot = process.env.MOODLE_ROOT || 'https://moodle.learndata.info';
      const anyEnrolled = (courses || []).some(c => c.enrolled);
      
      // Build verification URL for deal-based verification
      const baseUrl = process.env.BASE_URL || 'http://localhost:3080';
      const verifyUrl = `${baseUrl}/enrollments/verify?deal_id=${deal_id}&email=${encodeURIComponent(contact_email)}`;

      const template = determinedEmailType === 'welcome' 
        ? buildWelcomeEmail({ moodleRootUrl: moodleRoot, courses, verifyUrl, anyEnrolled, learnerName })
        : buildReminderEmail({ moodleRootUrl: moodleRoot, courses, verifyUrl, anyEnrolled, learnerName });
      
      const html = this.emailService.buildHtml({ title: template.subject, bodyHtml: template.bodyHtml });

      let messageId = null;

      if (debugMode) {
        // Debug mode: log what would be sent without actually sending
        console.log(`\n=== DEBUG MODE: Manual Learner Reminder for ${contact_email} ===`);
        console.log(`Subject: ${template.subject}`);
        console.log(`Email Type: ${determinedEmailType}`);
        console.log(`Learner Name: ${learnerName}`);
        console.log(`Courses:`, courses.map(c => `${c.course_name} (ID: ${c.course_id}, Enrolled: ${c.enrolled}, Accessed: ${c.accessed})`));
        console.log(`Verify URL: ${verifyUrl}`);
        console.log(`HTML Content Length: ${html.length} characters`);
        console.log(`Contact ID: ${contactId || 'Not found in deal learners'}`);
        
        console.log(`Would log note to HubSpot with:`);
        console.log(`- Deal ID: ${deal_id}`);
        console.log(`- Contact ID: ${contactId || 'null'}`);
        console.log(`- Subject: Email sent: ${template.subject}`);
        console.log(`- From: ${process.env.EMAIL_FROM || 'training@theodi.org'}`);
        console.log(`- To: ${contact_email}`);
        console.log(`=== END DEBUG ===\n`);
        
        return this.sendSuccess(res, { 
          messageId: 'DEBUG-SIMULATED',
          emailType: determinedEmailType,
          subject: template.subject,
          debug: true,
          contactId,
          courses,
          verifyUrl
        }, `Debug: ${determinedEmailType === 'welcome' ? 'Welcome' : 'Reminder'} email would be sent`);
      } else {
        // Normal mode: actually send email and log note
        const info = await this.emailService.sendHtmlEmail({
          to: contact_email,
          subject: template.subject,
          html
        });
        messageId = info?.messageId || null;

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
          messageId: messageId, 
          emailType: determinedEmailType,
          subject: template.subject 
        }, `${determinedEmailType === 'welcome' ? 'Welcome' : 'Reminder'} email sent`);
      }
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

      // Create HubSpot deal
      let dealResult = null;
      try {
        dealResult = await this.createHubSpotDeal(payload);
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

  // Authenticated webhook: label all deal contacts as Learner and set self-paced flag
  async labelDealLearnersAndFlagSelfPaced(req, res) {
    try {
      const apiKey = req.headers['x-api-key'] || req.query.api_key;
      if (!validateApiKey(apiKey, process.env.WEBHOOK_API_KEY)) {
        return this.sendError(res, 'Forbidden: Invalid API key', HTTP_STATUS.FORBIDDEN);
      }

      const { deal_id, label } = req.body || req.query || {};
      if (!deal_id) {
        return this.sendError(res, 'Missing deal_id', HTTP_STATUS.BAD_REQUEST);
      }

      const appliedLabel = String(label || 'Learner');

      // 1) Label all associated contacts
      const labelResult = await this.hubspotService.labelAllDealContacts(deal_id, appliedLabel);

      // 2) Set the self-paced flag on the deal
      let updateResult = null;
      try {
        updateResult = await this.hubspotService.updateDeal(String(deal_id), { includes_self_paced_courses: true });
      } catch (e) {
        // include error context but don't fail overall if labeling worked
      }

      return this.sendSuccess(
        res,
        {
          deal_id: String(deal_id),
          label: appliedLabel,
          contacts_processed: labelResult.total,
          contacts_labeled: labelResult.updated,
          deal_updated: Boolean(updateResult && updateResult.id),
        },
        'Contacts labeled and self-paced flag set'
      );
    } catch (error) {
      return this.sendError(res, error.message || 'Failed to label learners and flag deal');
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
      } else {
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
      } else {
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
      dealData.productId = formData.course_id_sp; // This is now the product ID
    }

    // Create the deal
    return await this.hubspotService.createDeal(dealData);
  }
}

export default HubSpotController;
