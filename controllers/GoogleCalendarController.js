import GoogleCalendarService from '../services/googleCalendarService.js';
import { sendSuccess, sendError } from '../utils/response.js';

export default class GoogleCalendarController {
  constructor() {
    this.googleCalendarService = new GoogleCalendarService();
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
        tutor_email
      } = req.body;

      // Validate required fields
      if (!client_name || !course_name || !course_datetime || !course_location || !booking_ref || !course_duration) {
        return sendError(res, 'Missing required fields for calendar event creation', 400);
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
        bookingReference: booking_ref,
        startTime: course_datetime,
        durationHours: parseFloat(course_duration),
        tutorEmail: tutor_email
      };

      const event = await this.googleCalendarService.createTrainingEvent(courseData);

      return sendSuccess(res, 'Calendar event created successfully', {
        id: event.id,
        url: event.htmlLink,
        summary: event.summary
      });

    } catch (error) {
      console.error('Error in createTrainingEvent:', error);
      return sendError(res, `Failed to create calendar event: ${error.message}`, 500);
    }
  }

  /**
   * Test calendar service connection
   */
  async testConnection(req, res) {
    try {
      // Try to get the calendar client to test authentication
      this.googleCalendarService.getCalendarClient();
      return sendSuccess(res, 'Google Calendar service is properly configured');
    } catch (error) {
      return sendError(res, `Google Calendar service not configured: ${error.message}`, 500);
    }
  }
}
