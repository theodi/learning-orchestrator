import BaseController from './BaseController.js';
import { HubSpotService } from '../services/hubspotService.js';
import { ForecastService } from '../services/forecastService.js';
import { GoogleCalendarService } from '../services/googleCalendarService.js';

export default class CourseBookingController extends BaseController {
  constructor() {
    super();
    this.hubspotService = new HubSpotService();
    this.forecastService = new ForecastService();
    this.googleCalendarService = new GoogleCalendarService();
  }

  // List all course bookings from HubSpot pipeline
  async index(req, res) {
    try {
      const pipelineId = req.query.pipeline || process.env.HUBSPOT_DEFAULT_PIPELINE_ID;
      
      // Fetch deals from the specified pipeline
      const deals = await this.hubspotService.fetchDealsFromPipeline(pipelineId);

      // Fetch available pipelines for the dropdown
      let pipelines = [];
      try {
        pipelines = await this.hubspotService.fetchPipelines();
      } catch (pipelineError) {
        console.error('Failed to fetch pipelines:', pipelineError.message);
      }

      const displayBookings = deals.map(deal => {
        const props = deal.properties;
        
        let hubspotLink = '-';
        let forecastLink = '-';
        let calendarLink = '-';

        // Create links if IDs are available
        if (deal.id) {
          const portalId = process.env.HUBSPOT_PORTAL_ID;
          hubspotLink = `<a href="https://app.hubspot.com/contacts/${portalId}/deal/${deal.id}" target="_blank">View Deal</a>`;
        }

        // Forecast link: prefer URL if available, regardless of ID
        if (props.projecturl) {
          forecastLink = `<a href="${props.projecturl}" target="_blank">View Project</a>`;
        }

        // Calendar link: prefer URL if available, regardless of ID
        if (props.calendar_event_url) {
          calendarLink = `<a href="${props.calendar_event_url}" target="_blank">View Event</a>`;
        }

        // Format dates consistently for display and sorting
        const courseDate = props.course_date ? new Date(props.course_date) : null;
        const createdDate = props.createdate ? new Date(props.createdate) : null;
        
        return {
          id: deal.id,
          deal_name: props.dealname || 'Unnamed Deal',
          course_name: props.course_name || 'N/A',
          course_date: courseDate ? courseDate.toISOString().split('T')[0] : 'N/A', // YYYY-MM-DD format
          course_date_sort: courseDate ? courseDate.toISOString() : '1900-01-01T00:00:00.000Z', // For sorting
          amount: props.amount ? `£${parseFloat(props.amount).toFixed(2)}` : 'N/A',
          amount_sort: props.amount ? parseFloat(props.amount) : 0, // For sorting
          created_at: createdDate ? createdDate.toISOString().split('T')[0] : 'N/A', // YYYY-MM-DD format
          created_at_sort: createdDate ? createdDate.toISOString() : '1900-01-01T00:00:00.000Z', // For sorting
          hubspot_link: hubspotLink,
          forecast_link: forecastLink,
          calendar_link: calendarLink
        };
      });

      return this.renderPage(req, res, 'pages/course-bookings/index', {
        title: 'Course Bookings',
        bookings: displayBookings,
        currentPipeline: pipelineId,
        pipelines: pipelines
      });
    } catch (error) {
      console.error('Error loading course bookings:', error);
      return this.sendError(res, 'Failed to load course bookings');
    }
  }

  // Show individual booking page (fetch deal from HubSpot)
  async show(req, res) {
    try {
      const { id } = req.params;
      
      // Fetch deal from HubSpot
      const deal = await this.hubspotService.getDeal(id);
      
      if (!deal) {
        return this.sendError(res, 'Course booking not found', 404);
      }

      // Transform deal data to match the expected booking format
      const booking = {
        id: deal.id,
        deal_name: deal.properties.dealname,
        course_name: deal.properties.course_name,
        course_date: deal.properties.course_date,
        amount: deal.properties.amount,
        description: deal.properties.description,
        hubspot_deal_id: deal.id,
        hubspot_deal_url: `https://app.hubspot.com/contacts/${process.env.HUBSPOT_PORTAL_ID}/deal/${deal.id}`,
        forecast_project_id: deal.properties.forecast_id,
        forecast_project_url: deal.properties.projecturl,
        google_calendar_event_id: deal.properties.calendar_event_id,
        google_calendar_url: deal.properties.calendar_event_url,
        created_at: deal.properties.createdate,
        updated_at: deal.properties.hs_lastmodifieddate
      };

      return this.renderPage(req, res, 'pages/course-bookings/show', {
        title: 'Course Booking Details',
        booking: booking
      });
    } catch (error) {
      console.error('Error loading booking details:', error);
      return this.sendError(res, 'Failed to load booking details');
    }
  }

  // Show new booking form
  async new(req, res) {
    try {
      // Get the same data as the current HubSpot form
      const products = await this.hubspotService.fetchProducts("Learning Course");
      const tutors = await this.forecastService.fetchUsers();
      const companies = await this.hubspotService.fetchCompaniesBatch();
      
      let pipelines = [];
      try {
        pipelines = await this.hubspotService.fetchPipelines();
      } catch (pipelineError) {
        console.error('Failed to fetch pipelines:', pipelineError.message);
      }

      return this.renderPage(req, res, 'pages/course-bookings/new', {
        title: 'New Course Booking',
        products,
        tutors,
        companies,
        pipelines,
        defaultPipelineId: process.env.HUBSPOT_DEFAULT_PIPELINE_ID,
        userName: req.user?.displayName || `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || 'Unknown User',
        userEmail: req.user?.email || 'unknown@example.com'
      });
    } catch (error) {
      return this.sendError(res, 'Failed to load booking form');
    }
  }

  // Create new booking (update HubSpot deal with integration data)
  async create(req, res) {
    try {
      // Extract the deal ID from the request body (should be set when deal is created)
      const dealId = req.body.hubspot_deal_id;
      
      if (!dealId) {
        return this.sendError(res, 'HubSpot deal ID is required');
      }

      // Prepare update data for HubSpot deal
      const updateData = {};
      
      if (req.body.forecast_project_id) {
        updateData.forecast_id = req.body.forecast_project_id;
      }
      if (req.body.forecast_project_url) {
        updateData.projecturl = req.body.forecast_project_url;
      }
      if (req.body.google_calendar_event_id) {
        updateData.calendar_event_id = req.body.google_calendar_event_id;
      }
      if (req.body.google_calendar_url) {
        updateData.calendar_event_url = req.body.google_calendar_url;
      }

      // Update the HubSpot deal with integration data
      if (Object.keys(updateData).length > 0) {
        await this.hubspotService.updateDeal(dealId, updateData);
      }

      // Return success with deal ID
      return this.sendSuccess(res, {
        dealId: dealId,
        message: 'Course booking created successfully'
      }, 'Course booking created successfully');
    } catch (error) {
      console.error('Error creating course booking:', error);
      return this.sendError(res, 'Failed to create course booking');
    }
  }

  // Show edit form for existing booking
  async edit(req, res) {
    try {
      const { id } = req.params;
      
      // Fetch deal from HubSpot
      const deal = await this.hubspotService.getDeal(id);
      
      if (!deal) {
        return this.sendError(res, 'Course booking not found', 404);
      }

      // Get the same data as the new form
      const products = await this.hubspotService.fetchProducts("Learning Course");
      const tutors = await this.forecastService.fetchUsers();
      const companies = await this.hubspotService.fetchCompaniesBatch();
      
      let pipelines = [];
      try {
        pipelines = await this.hubspotService.fetchPipelines();
      } catch (pipelineError) {
        console.error('Failed to fetch pipelines:', pipelineError.message);
      }

      // Transform deal to booking format
      const booking = {
        id: deal.id,
        deal_name: deal.properties.dealname,
        course_name: deal.properties.course_name,
        course_date: deal.properties.course_date,
        amount: deal.properties.amount,
        description: deal.properties.description,
        forecast_project_id: deal.properties.forecast_id,
        forecast_project_url: deal.properties.projecturl,
        google_calendar_event_id: deal.properties.calendar_event_id,
        google_calendar_url: deal.properties.calendar_event_url
      };

      return this.renderPage(req, res, 'pages/course-bookings/edit', {
        title: 'Edit Course Booking',
        booking: booking,
        products,
        tutors,
        companies,
        pipelines,
        defaultPipelineId: process.env.HUBSPOT_DEFAULT_PIPELINE_ID
      });
    } catch (error) {
      return this.sendError(res, 'Failed to load booking for editing');
    }
  }

  // Update existing booking (update HubSpot deal)
  async update(req, res) {
    try {
      const { id } = req.params;
      
      // Prepare update data for HubSpot deal
      const updateData = {};
      
      // Map form fields to HubSpot properties
      if (req.body.deal_name) updateData.dealname = req.body.deal_name;
      if (req.body.course_name) updateData.course_name = req.body.course_name;
      if (req.body.course_date) updateData.course_date = req.body.course_date;
      if (req.body.amount) updateData.amount = req.body.amount;
      if (req.body.description) updateData.description = req.body.description;
      if (req.body.forecast_project_id) updateData.forecast_id = req.body.forecast_project_id;
      if (req.body.forecast_project_url) updateData.projecturl = req.body.forecast_project_url;
      if (req.body.google_calendar_event_id) updateData.calendar_event_id = req.body.google_calendar_event_id;
      if (req.body.google_calendar_url) updateData.calendar_event_url = req.body.google_calendar_url;

      // Update the HubSpot deal
      const updatedDeal = await this.hubspotService.updateDeal(id, updateData);

      return this.sendSuccess(res, updatedDeal, 'Course booking updated successfully');
    } catch (error) {
      console.error('Error updating course booking:', error);
      return this.sendError(res, 'Failed to update course booking');
    }
  }
}
