import BaseController from './BaseController.js';
import { EnrollmentService } from '../services/enrollmentService.js';
import { MoodleService } from '../services/moodleService.js';
import { HubSpotService } from '../services/hubspotService.js';
import { validateApiKey } from '../utils/validation.js';
import { HTTP_STATUS } from '../config/constants.js';

export class EnrollmentController extends BaseController {
  constructor() {
    super();
    this.enrollmentService = new EnrollmentService();
    this.moodleService = new MoodleService();
    this.hubspotService = new HubSpotService();
  }

  // Course enrollment page
  async newEnrollment(req, res) {
    try {
      const courses = await this.moodleService.fetchCourses();
      
      return this.renderPage(req, res, 'pages/enrollments/new', {
        title: 'Course Enrollment',
        link: '/enrollments/new',
        courses: courses
      });
    } catch (error) {
      return this.sendError(res, 'Failed to load enrollment form');
    }
  }

  // Process bulk enrollment
  async createEnrollment(req, res) {
    try {
      const { courseId, courseName, userEmails, durationMonths } = req.body;

      if (!courseId || !courseName || !userEmails || !durationMonths) {
        return this.sendValidationError(res, ['courseId', 'courseName', 'userEmails', 'durationMonths'], 'Missing required fields');
      }

      // Parse user emails (comma-separated or array)
      const emails = Array.isArray(userEmails) ? userEmails : userEmails.split(',').map(e => e.trim()).filter(e => e);

      if (emails.length === 0) {
        return this.sendError(res, 'No valid email addresses provided');
      }

      const results = await this.enrollmentService.processBulkEnrollment(
        parseInt(courseId),
        courseName,
        emails,
        parseInt(durationMonths)
      );

      return this.sendSuccess(res, results, 'Enrollment processed successfully');
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Get enrolments for a course
  async getCourseEnrollments(req, res) {
    try {
      const { courseId } = req.params;
      const acceptHeader = (req.get('accept') || '').toLowerCase();

      const enrollments = await this.enrollmentService.getCourseEnrollments(parseInt(courseId));

      if (acceptHeader.includes('application/json')) {
        return this.sendSuccess(res, enrollments, 'Course enrollments fetched successfully');
      }

      // Get course name from first enrollment or fetch from Moodle
      let courseName = 'Unknown Course';
      if (enrollments.length > 0 && enrollments[0].course_name) {
        courseName = enrollments[0].course_name;
      } else {
        try {
          const courses = await this.moodleService.fetchCourses();
          const course = courses.find(c => c.id === parseInt(courseId));
          if (course) {
            courseName = course.fullname || course.shortname || courseName;
          }
        } catch (error) {
          console.error('Error fetching course name from Moodle:', error.message);
        }
      }

      // Default: render page shell
      return this.renderPage(req, res, 'pages/enrollments/course', {
        title: 'Course Enrollments',
        link: `/enrollments/course/${courseId}`,
        courseId: courseId,
        courseName: courseName,
        moodleRootUrl: this.moodleService.getMoodleRootUrl()
      });
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Get all enrollments
  async getAllEnrollments(req, res) {
    try {
      const { status, course_id, user_email, limit } = req.query;
      const acceptHeader = (req.get('accept') || '').toLowerCase();

      const filters = {};
      if (status) filters.status = status;
      if (course_id) filters.course_id = parseInt(course_id);
      if (user_email) filters.user_email = user_email;
      if (limit) filters.limit = parseInt(limit);

      const enrollments = await this.enrollmentService.getAllEnrollments(filters);

      if (acceptHeader.includes('application/json')) {
        return this.sendSuccess(res, enrollments, 'Enrollments fetched successfully');
      }

      // Default: render page shell
      return this.renderPage(req, res, 'pages/enrollments/index', {
        title: 'All Enrollments',
        link: '/enrollments'
      });
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Public: check user enrollment/access status in a course
  async getUserCourseStatus(req, res) {
    try {
      const { course_id, email } = req.query;

      if (!course_id || !email) {
        return res.status(400).json({ error: 'Missing required parameters: course_id, email' });
      }

      // API key protection (header x-api-key or query api_key)
      const apiKey = req.headers['x-api-key'] || req.query.api_key;
      if (!validateApiKey(apiKey, process.env.WEBHOOK_API_KEY)) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'Forbidden: Invalid API key' });
      }

      const status = await this.enrollmentService.getUserCourseStatus(parseInt(course_id), email);
      // Return raw data only
      return res.json(status);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  }

  

  // Public: verification by deal_id and email (alternative to token)
  async verifyEnrollmentByDeal(req, res) {
    try {
      const { deal_id, email } = req.query;
      const acceptHeader = (req.get('accept') || '').toLowerCase();

      if (!deal_id || !email) {
        // Behave like invalid token
        if (acceptHeader.includes('application/json')) {
          return this.sendError(res, 'Missing deal_id or email', HTTP_STATUS.BAD_REQUEST);
        }
        res.status(HTTP_STATUS.BAD_REQUEST);
        return this.renderPage(req, res, 'pages/enrollments/verify', {
          title: 'Invalid Verification Link',
          error: 'Invalid verification link. Missing parameters.',
          moodleRootUrl: this.moodleService.getMoodleRootUrl()
        });
      }

      // Check the email is a Learner on the deal
      let learnerEmails = [];
      try {
        const learners = await this.hubspotService.fetchDealContactsByLabel(deal_id, 'Learner');
        learnerEmails = (learners || []).map(l => (l.email || '').toLowerCase()).filter(Boolean);
      } catch (e) {}

      if (!learnerEmails.includes(String(email).toLowerCase())) {
        if (acceptHeader.includes('application/json')) {
          return this.sendError(res, 'Email not associated with this deal', HTTP_STATUS.FORBIDDEN);
        }
        res.status(HTTP_STATUS.BAD_REQUEST);
        return this.renderPage(req, res, 'pages/enrollments/verify', {
          title: 'Invalid Verification Link',
          error: 'Your email is not associated with this booking.',
          moodleRootUrl: this.moodleService.getMoodleRootUrl()
        });
      }

      // Get moodle course ids and term months from line items
      let lineItems = [];
      try {
        lineItems = await this.hubspotService.fetchDealLineItemsWithProducts(deal_id);
      } catch (err) {
        const hsStatus = err?.response?.status;
        if (hsStatus === 404) {
          if (acceptHeader.includes('application/json')) {
            return this.sendError(res, 'Invalid deal_id', HTTP_STATUS.BAD_REQUEST);
          }
          res.status(HTTP_STATUS.BAD_REQUEST);
          return this.renderPage(req, res, 'pages/enrollments/verify', {
            title: 'Invalid Verification Link',
            error: 'This booking could not be found.',
            moodleRootUrl: this.moodleService.getMoodleRootUrl()
          });
        }
        throw err;
      }
      const courseEntries = lineItems
        .map(li => ({ course_id: parseInt(li.moodle_course_id), term_months: Number(li.term_months) }))
        .filter(e => Number.isFinite(e.course_id));

      if (!courseEntries.length) {
        if (acceptHeader.includes('application/json')) {
          return this.sendError(res, 'No Moodle course linked to this deal', HTTP_STATUS.NOT_FOUND);
        }
        return this.renderPage(req, res, 'pages/enrollments/verify', {
          title: 'Invalid Link',
          error: 'No course found for this booking.',
          moodleRootUrl: this.moodleService.getMoodleRootUrl()
        });
      }
      // Build per-course statuses using term months if available
      const statuses = [];
      for (const entry of courseEntries) {
        const cid = entry.course_id;
        const termMonths = Number.isFinite(entry.term_months) && entry.term_months > 0 ? entry.term_months : 12;
        const s = await this.enrollmentService.getUserCourseStatus(cid, String(email), termMonths);
        statuses.push({
          course_id: cid,
          course_name: s?.course_name || '',
          enrolled: Boolean(s?.enrolled),
          accessed: Boolean(s?.accessed),
          enrollment_date: s?.enrollment_date || null,
          expiry_date: s?.expiry_date || null
        });
      }

      // Fill missing course names from Moodle catalogue as a fallback
      if (statuses.some(e => !e.course_name)) {
        try {
          const moodleCourses = await this.moodleService.fetchCourses();
          const byId = new Map(moodleCourses.map(c => [parseInt(c.id), (c.fullname || c.shortname || '').trim()]));
          statuses.forEach(e => {
            if (!e.course_name) {
              const n = byId.get(parseInt(e.course_id));
              if (n) e.course_name = n;
            }
          });
        } catch (_) {
          // ignore
        }
      }

      if (acceptHeader.includes('application/json')) {
        return this.sendSuccess(res, statuses, 'Enrollment status');
      }

      return this.renderPage(req, res, 'pages/enrollments/verify', {
        title: 'Your Course Access',
        email: String(email),
        enrollments: statuses,
        moodleRootUrl: this.moodleService.getMoodleRootUrl()
      });
    } catch (error) {
      const hsStatus = error?.response?.status;
      if (hsStatus === 404) {
        return this.sendError(res, 'Invalid deal_id', HTTP_STATUS.BAD_REQUEST);
      }
      return this.sendError(res, error.message);
    }
  }

  

  // Resend enrollment email
  async resendEmail(req, res) {
    try {
      const { enrollmentId } = req.params;
      
      const result = await this.enrollmentService.resendEnrollmentEmail(enrollmentId);
      
      return this.sendSuccess(res, result, 'Enrollment email resent successfully');
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  

  // Browse enrollments page
  async browse(req, res) {
    try {
      return this.renderPage(req, res, 'pages/enrollments/browse', {
        title: 'Browse Enrollments',
        link: '/enrollments'
      });
    } catch (error) {
      return this.sendError(res, 'Failed to load enrollments page');
    }
  }
}

export default EnrollmentController;
