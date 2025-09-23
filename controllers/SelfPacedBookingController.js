import BaseController from './BaseController.js';
import { HubSpotService } from '../services/hubspotService.js';
import { HTTP_STATUS, HUBSPOT_CONFIG } from '../config/constants.js';

export default class SelfPacedBookingController extends BaseController {
  constructor() {
    super();
    this.hubspotService = new HubSpotService();
  }

  async new(req, res) {
    try {
      const pipelines = await this.hubspotService.fetchPipelines();
      const envDefault = process.env.HUBSPOT_DEFAULT_PIPELINE_ID || '';
      const defaultPipelineId = envDefault || pipelines?.[0]?.id || '';
      // Preload self-paced courses for plain dropdowns
      let selfPacedCourses = [];
      try {
        const allCourses = await this.hubspotService.fetchCourses();
        selfPacedCourses = (allCourses || []).filter(c => String(c.learning_course_type || '').toLowerCase() === 'self paced');
      } catch (e) {
        console.warn('Failed to fetch courses for self-paced form:', e?.message || e);
      }
      return this.renderPage(req, res, 'pages/self-paced-bookings/new', {
        title: 'New Self-Paced Course Booking',
        pipelines,
        defaultPipelineId,
        courses: selfPacedCourses,
        userName: req.user?.displayName || req.user?.name || req.user?.username || '',
        userEmail: req.user?.emails?.[0]?.value || req.user?.email || ''
      });
    } catch (error) {
      console.error('Failed to load self-paced booking form:', error);
      return this.sendError(res, 'Failed to load self-paced booking form');
    }
  }

  async create(req, res) {
    try {
      const acceptHeader = req.get('accept') || '';

      const {
        pipeline,
        sub_client, // company id
        booking_ref,
        client_name,
        primary_contact_name,
        primary_contact_email,
        primary_contact_id,
        completed_by_name,
        completed_by_email,
        line_items = [], // [{product_id, name, price, quantity}]
        learners = [] // [{name, email}]
      } = req.body || {};

      if (!pipeline) return this.sendError(res, 'Pipeline is required', HTTP_STATUS.BAD_REQUEST);

      // Find owner by submitter email
      let ownerId = null;
      try {
        const owner = await this.hubspotService.findUserByEmail(completed_by_email);
        ownerId = owner?.id || null;
      } catch (e) {
        console.warn('Owner lookup failed:', e?.message || e);
      }

      // Build deal name/description
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      // Resolve organisation name: prefer request body, else fetch from HubSpot by company ID
      let orgName = (client_name || '').trim();
      if (!orgName && sub_client) {
        try {
          const companyRes = await this.hubspotService.fetchCompaniesBatch();
          const companies = companyRes?.companies || [];
          const found = companies.find(c => String(c.id) === String(sub_client));
          if (found?.name) orgName = found.name;
        } catch (e) {
          console.warn('Could not resolve company name from HubSpot:', e?.message || e);
        }
      }
      const selectedCourseNames = Array.isArray(line_items)
        ? line_items.map(i => (i?.name || '').trim()).filter(Boolean)
        : [];
      const singleCourse = selectedCourseNames.length === 1 ? selectedCourseNames[0] : null;
      const courseTitle = singleCourse || 'Various courses';
      const dealName = `Self-Paced Booking | ${orgName || 'Unknown organisation'} | ${courseTitle}`;
      const description = `Self-paced course booking\nBooking Reference: ${booking_ref || 'N/A'}\nCompleted By: ${completed_by_name || ''} (${completed_by_email || ''})`;

      // Prepare base deal data (amount set after line-items, initial 0)
      const dealData = {
        dealName,
        value: '0',
        pipelineId: pipeline,
        stageId: HUBSPOT_CONFIG.DEFAULT_DEAL_STAGE_ID,
        description,
        closeDate: Date.now(),
        startDate: dateStr,
        courseName: courseTitle,
        courseType: 'Self-paced',
        ownerId,
        companyId: sub_client || null,
        contactId: null,
        productId: null
      };

      // Primary contact: find or create if needed
      try {
        let contactId = primary_contact_id || null;
        if (!contactId && primary_contact_email) {
          const matches = await this.hubspotService.searchContactsByTerm(primary_contact_email);
          if (matches && matches.length > 0) {
            contactId = matches[0].id;
          }
        }
        if (!contactId && (primary_contact_name || primary_contact_email)) {
          const [firstName, ...lastParts] = (primary_contact_name || '').split(' ');
          const lastName = lastParts.join(' ') || '';
          const created = await this.hubspotService.createContact({
            firstName: firstName || 'Primary',
            lastName: lastName || 'Contact',
            email: primary_contact_email || '',
            phone: ''
          });
          contactId = created?.id || null;
        }
        dealData.contactId = contactId;
      } catch (e) {
        console.warn('Primary contact create/find failed:', e?.message || e);
      }

      // Create the deal
      const deal = await this.hubspotService.createDeal(dealData);
      const dealId = deal.id;

      // Ensure primary contact has association label
      if (dealData.contactId) {
        await this.hubspotService.setAssociationLabels('deals', dealId, 'contacts', dealData.contactId, ['Primary contact']);
      }

      // Create line items with provided prices and compute total
      let totalAmount = 0;
      if (Array.isArray(line_items)) {
        for (const item of line_items) {
          const priceNum = Number(item?.price || 0) || 0;
          const qtyNum = Number(item?.quantity || 1) || 1;
          totalAmount += priceNum * qtyNum;
          const name = item?.name || 'Self-Paced Course';
          const productId = item?.product_id || null;
          const termMonths = Number(item?.term_months || 0) || null;
          await this.hubspotService.createLineItemForDealWithOverrides(dealId, {
            productId,
            name,
            price: priceNum,
            quantity: String(qtyNum),
            termMonths: termMonths
          });
        }
      }

      // Update deal amount to sum of line items
      try {
        await this.hubspotService.updateDeal(dealId, { amount: String(totalAmount) });
      } catch (e) {
        console.warn('Failed to update deal amount:', e?.message || e);
      }

      // Learners: find/create by email and associate to deal
      if (Array.isArray(learners)) {
        for (const learner of learners) {
          try {
            const email = (learner?.email || '').trim();
            const fullName = (learner?.name || '').trim();
            let contactId = null;
            if (email) {
              const matches = await this.hubspotService.searchContactsByTerm(email);
              if (matches && matches.length > 0) contactId = matches[0].id;
            }
            if (!contactId) {
              const [firstName, ...lastParts] = fullName.split(' ');
              const lastName = lastParts.join(' ') || '';
              const created = await this.hubspotService.createContact({
                firstName: firstName || 'Learner',
                lastName: lastName || 'Contact',
                email: email || '',
                phone: ''
              });
              contactId = created?.id || null;
            }
            if (contactId) {
              await this.hubspotService.associateDealWithContact(dealId, contactId);
              await this.hubspotService.setAssociationLabels('deals', dealId, 'contacts', contactId, ['Learner']);
            }
          } catch (e) {
            console.warn('Learner association failed:', e?.message || e);
          }
        }
      }

      const portalId = process.env.HUBSPOT_PORTAL_ID || '748510';
      const dealUrl = `https://app.hubspot.com/contacts/${portalId}/deal/${dealId}`;

      if (acceptHeader.includes('application/json')) {
        return this.sendSuccess(res, { id: dealId, url: dealUrl }, 'Self-paced booking created', HTTP_STATUS.CREATED);
      }

      return res.redirect('/self-paced-bookings');
    } catch (error) {
      console.error('Error creating self-paced course booking:', error);
      return this.sendError(res, 'Failed to create self-paced course booking');
    }
  }
}


