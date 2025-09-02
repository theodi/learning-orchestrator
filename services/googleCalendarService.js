import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

export class GoogleCalendarService {
  constructor() {
    this.calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    this.serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    this.privateKey = process.env.GOOGLE_PRIVATE_KEY;
    this.sendInvitations = process.env.GOOGLE_CALENDAR_SEND_INVITATIONS === 'true';
    this.impersonateUser = process.env.GOOGLE_CALENDAR_IMPERSONATE_USER || null;
    
    if (!this.serviceAccountEmail || !this.privateKey) {
      console.warn('Google Calendar service account credentials not configured');
    }
  }

  /**
   * Get authenticated Google Calendar client
   */
  getCalendarClient() {
    if (!this.serviceAccountEmail || !this.privateKey) {
      throw new Error('Google Calendar service account credentials not configured');
    }

    const auth = new google.auth.JWT(
      this.serviceAccountEmail,
      null,
      this.privateKey.replace(/\\n/g, '\n'),
      [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events'
      ],
      this.impersonateUser
    );

    return google.calendar({ version: 'v3', auth });
  }

  /**
   * Get a specific calendar event by ID
   */
  async getEvent(eventId) {
    try {
      const calendar = this.getCalendarClient();
      const response = await calendar.events.get({
        calendarId: this.calendarId,
        eventId: eventId
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching Google Calendar event:', error);
      throw new Error(`Failed to fetch calendar event: ${error.message}`);
    }
  }

  /**
   * Create a calendar event
   */
  async createEvent(eventData) {
    try {
      const calendar = this.getCalendarClient();
      
      const event = {
        summary: eventData.summary,
        description: eventData.description,
        start: {
          dateTime: eventData.startDateTime,
          timeZone: 'Europe/London',
        },
        end: {
          dateTime: eventData.endDateTime,
          timeZone: 'Europe/London',
        },
        attendees: eventData.attendees || [],
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 }, // 1 day before
            { method: 'popup', minutes: 30 }, // 30 minutes before
          ],
        },
      };

       const response = await calendar.events.insert({
         calendarId: this.calendarId,
         resource: event,
         sendUpdates: this.sendInvitations ? 'all' : 'none', // Control invitation sending
       });

      return {
        id: response.data.id,
        htmlLink: response.data.htmlLink,
        summary: response.data.summary,
        start: response.data.start,
        end: response.data.end,
      };
    } catch (error) {
      console.error('Error creating Google Calendar event:', error);
      throw new Error(`Failed to create calendar event: ${error.message}`);
    }
  }

  /**
   * Create a training course event
   */
  async createTrainingEvent(courseData) {
    const {
      clientName,
      courseName,
      courseDate,
      courseLocation,
      bookingReference,
      startTime,
      durationHours,
      tutorEmail,
      forecastProjectId,
      forecastProjectViewId,
      forecastDeliverTaskId
    } = courseData;

    // Calculate end time
    const startDateTime = new Date(startTime);
    const endDateTime = new Date(startDateTime.getTime() + (durationHours * 60 * 60 * 1000));

    

    // Build description without IDs (moved to summary)
    const description = `Training course booking\n\nClient: ${clientName}\nCourse: ${courseName}\nLocation: ${courseLocation}\nBooking Reference: ${bookingReference}`;

    // Compute ID prefix/suffix for summary
    const taskPart = forecastDeliverTaskId ? `T${forecastDeliverTaskId} - ` : '';
    let projectPart = '';
    if (forecastProjectViewId) {
      const normalizedProjectViewId = /^P-/.test(forecastProjectViewId)
        ? forecastProjectViewId
        : forecastProjectViewId.replace(/^P(.*)$/,'P-$1');
      projectPart = ` [${normalizedProjectViewId}]`;
    }

    const eventData = {
      summary: `${taskPart}${clientName} - ${courseName} - ${courseDate} (${courseLocation}) - ${bookingReference}${projectPart}`,
      description: description,
      startDateTime: startDateTime.toISOString(),
      endDateTime: endDateTime.toISOString(),
      attendees: tutorEmail ? [{ email: tutorEmail }] : [],
    };

    

    return await this.createEvent(eventData);
  }
}

export default GoogleCalendarService;
