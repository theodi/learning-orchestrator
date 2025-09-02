import BaseController from './BaseController.js';
import CourseBooking from '../models/CourseBooking.js';
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

  // List all course bookings (datatable)
  async index(req, res) {
    try {
      const bookings = await CourseBooking.find({})
        .sort({ created_at: -1 })
        .lean();

      // Fetch only deal names from HubSpot for the listing page
      const displayBookings = await Promise.all(bookings.map(async (booking) => {
        let dealName = 'Not created';
        let hubspotLink = 'Not created';
        let forecastLink = 'Not created';
        let calendarLink = 'Not created';

        // Fetch only HubSpot deal name if available
        if (booking.hubspot_deal_id) {
          try {
            const dealData = await this.hubspotService.getDeal(booking.hubspot_deal_id);
            dealName = dealData.properties?.dealname || 'Deal Found';
            hubspotLink = `<a href="${booking.hubspot_deal_url}" target="_blank">View Deal</a>`;
          } catch (error) {
            console.error(`Failed to fetch HubSpot deal ${booking.hubspot_deal_id}:`, error);
            hubspotLink = `<a href="${booking.hubspot_deal_url}" target="_blank">View Deal</a>`;
          }
        }

        // Simple links for other systems
        if (booking.forecast_project_id) {
          forecastLink = `<a href="${booking.forecast_project_url}" target="_blank">View Project</a>`;
        }

        if (booking.google_calendar_event_id) {
          calendarLink = `<a href="${booking.google_calendar_url}" target="_blank">View Event</a>`;
        }

        return {
          id: booking._id,
          deal_name: dealName,
          created_at: new Date(booking.created_at).toLocaleDateString('en-GB'),
          hubspot_link: hubspotLink,
          forecast_link: forecastLink,
          calendar_link: calendarLink
        };
      }));

      return this.renderPage(req, res, 'pages/course-bookings/index', {
        title: 'Course Bookings',
        bookings: displayBookings
      });
    } catch (error) {
      console.error('Error loading course bookings:', error);
      return this.sendError(res, 'Failed to load course bookings');
    }
  }

  // Show individual booking page (data will be loaded via AJAX)
  async show(req, res) {
    try {
      const { id } = req.params;
      const booking = await CourseBooking.findById(id);
      
      if (!booking) {
        return this.sendError(res, 'Course booking not found', 404);
      }

      // Just render the page - data will be loaded via AJAX
      return this.renderPage(req, res, 'pages/course-bookings/show', {
        title: 'Course Booking Details',
        booking: booking
      });
    } catch (error) {
      return this.sendError(res, 'Failed to load booking details');
    }
  }

  // Show new booking form
  async new(req, res) {
    try {
      // Get the same data as the current HubSpot form
      const products = await this.hubspotService.fetchProducts();
      const tutors = await this.forecastService.fetchUsers();
      const companies = await this.hubspotService.fetchCompaniesBatch();
      
      let pipelines = [];
      try {
        pipelines = await this.hubspotService.fetchPipelines();
      } catch (pipelineError) {
        console.error('Failed to fetch pipelines:', pipelineError.message);
      }
      
      const userName = req.user?.displayName || '';
      const userEmail = req.user?.emails?.[0]?.value || '';

      return this.renderPage(req, res, 'pages/course-bookings/new', {
        title: 'New Course Booking',
        products,
        tutors,
        companies,
        pipelines,
        defaultPipelineId: process.env.HUBSPOT_DEFAULT_PIPELINE_ID,
        userEmail,
        userName
      });
    } catch (error) {
      return this.sendError(res, 'Failed to load booking form');
    }
  }

  // Create new booking
  async create(req, res) {
    try {
      // Create minimal booking record with only integration data
      const booking = new CourseBooking();
      
      // If integration data is provided, update the booking with it
      if (req.body.hubspot_deal_id) {
        await booking.updateIntegration('hubspot', req.body.hubspot_deal_id, req.body.hubspot_deal_url);
      }
      if (req.body.forecast_project_id) {
        await booking.updateIntegration('forecast', req.body.forecast_project_id, req.body.forecast_project_url);
      }
      if (req.body.google_calendar_event_id) {
        await booking.updateIntegration('calendar', req.body.google_calendar_event_id, req.body.google_calendar_url);
      }
      
      // Save to MongoDB
      const savedBooking = await booking.save();

      // Return success with booking ID
      return this.sendSuccess(res, {
        bookingId: savedBooking._id,
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
      const booking = await CourseBooking.findById(id);
      
      if (!booking) {
        return this.sendError(res, 'Course booking not found', 404);
      }

      // Get the same data as the new form
      const products = await this.hubspotService.fetchProducts();
      const tutors = await this.forecastService.fetchUsers();
      const companies = await this.hubspotService.fetchCompaniesBatch();
      
      let pipelines = [];
      try {
        pipelines = await this.hubspotService.fetchPipelines();
      } catch (pipelineError) {
        console.error('Failed to fetch pipelines:', pipelineError.message);
      }

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

  // Update existing booking
  async update(req, res) {
    try {
      const { id } = req.params;
      const booking = await CourseBooking.findById(id);
      
      if (!booking) {
        return this.sendError(res, 'Course booking not found', 404);
      }

      // Update booking fields
      Object.assign(booking, req.body);
      booking.updated_at = new Date();

      // Save updated booking
      const updatedBooking = await booking.save();

      return this.sendSuccess(res, updatedBooking, 'Course booking updated successfully');
    } catch (error) {
      console.error('Error updating course booking:', error);
      return this.sendError(res, 'Failed to update course booking');
    }
  }


}
