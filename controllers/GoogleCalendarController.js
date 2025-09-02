import BaseController from './BaseController.js';
import GoogleCalendarService from '../services/googleCalendarService.js';

export default class GoogleCalendarController extends BaseController {
  constructor() {
    super();
    this.googleCalendarService = new GoogleCalendarService();
  }

  /**
   * Get a specific calendar event by ID
   */
  async getEvent(req, res) {
    try {
      const { id } = req.params;
      const event = await this.googleCalendarService.getEvent(id);
      return this.sendSuccess(res, event, 'Calendar event fetched successfully');
    } catch (error) {
      console.error('Error in getEvent:', error);
      return this.sendError(res, `Failed to fetch calendar event: ${error.message}`, 500);
    }
  }

  /**
   * Create a training course calendar event
   */
  async createTrainingEvent(req, res) {
    try {
      const {
        client_name,
        course_name,
        course_datetime,
        course_location,
        booking_ref,
        course_duration,
        tutor_email,
        forecast_project_id,
        forecast_project_view_id,
        forecast_deliver_task_id
      } = req.body;

      

      // Validate required fields
      if (!client_name || !course_name || !course_datetime || !course_location || !course_duration) {
        return this.sendError(res, 'Missing required fields for calendar event creation', 400);
      }

      // Format course date for event summary
      const courseDate = new Date(course_datetime).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });

      const courseData = {
        clientName: client_name,
        courseName: course_name,
        courseDate: courseDate,
        courseLocation: course_location,
        bookingReference: booking_ref || 'No reference provided',
        startTime: course_datetime,
        durationHours: parseFloat(course_duration),
        tutorEmail: tutor_email,
        forecastProjectId: forecast_project_id,
        forecastProjectViewId: forecast_project_view_id,
        forecastDeliverTaskId: forecast_deliver_task_id
      };

      

      const event = await this.googleCalendarService.createTrainingEvent(courseData);

      return this.sendSuccess(res, {
        id: event.id,
        htmlLink: event.htmlLink,
        summary: event.summary
      }, 'Calendar event created successfully');

    } catch (error) {
      console.error('Error in createTrainingEvent:', error);
      return this.sendError(res, `Failed to create calendar event: ${error.message}`, 500);
    }
  }

  /**
   * Test calendar service connection
   */
  async testConnection(req, res) {
    try {
      // Try to get the calendar client to test authentication
      this.googleCalendarService.getCalendarClient();
      return this.sendSuccess(res, 'Google Calendar service is properly configured');
    } catch (error) {
      return this.sendError(res, `Google Calendar service not configured: ${error.message}`, 500);
    }
  }
}
