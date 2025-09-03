import BaseController from './BaseController.js';
import { EnrollmentService } from '../services/enrollmentService.js';
import { MoodleService } from '../services/moodleService.js';

export class EnrollmentController extends BaseController {
  constructor() {
    super();
    this.enrollmentService = new EnrollmentService();
    this.moodleService = new MoodleService();
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

  // Verify enrollment token
  async verifyEnrollment(req, res) {
    try {
      const { token } = req.params;
      const acceptHeader = (req.get('accept') || '').toLowerCase();

      const enrollment = await this.enrollmentService.getEnrollmentByToken(token);
      
      if (!enrollment) {
        if (acceptHeader.includes('application/json')) {
          return this.sendError(res, 'Invalid verification token', 404);
        }
        return this.renderPage(req, res, 'pages/enrollments/verify', {
          title: 'Invalid Token',
          link: '/enrollments/verify',
          error: 'Invalid verification token',
          moodleRootUrl: this.moodleService.getMoodleRootUrl()
        });
      }

      // If enrollment is already completed, just show success
      if (enrollment.status === 'enrolled') {
        return this.renderPage(req, res, 'pages/enrollments/verify', {
          title: 'Enrollment Complete',
          link: '/enrollments/verify',
          enrollment: enrollment,
          enrollmentCompleted: true,
          moodleRootUrl: this.moodleService.getMoodleRootUrl()
        });
      }

      // Check if user now exists in Moodle and auto-complete enrollment if possible
      let enrollmentResult = null;
      let moodleUser = null;
      
      try {
        moodleUser = await this.moodleService.lookupUserByEmail(enrollment.user_email);
        
        if (moodleUser) {
          if (enrollment.status === 'pending_account_creation') {
            try {
              enrollmentResult = await this.enrollmentService.verifyAndCompleteEnrollment(token);
              
              if (enrollmentResult.success) {
                // Refresh enrollment data to get updated status
                const updatedEnrollment = await this.enrollmentService.getEnrollmentByToken(token);
                return this.renderPage(req, res, 'pages/enrollments/verify', {
                  title: 'Enrollment Complete',
                  link: '/enrollments/verify',
                  enrollment: updatedEnrollment,
                  enrollmentCompleted: true,
                  autoCompleted: true,
                  moodleRootUrl: this.moodleService.getMoodleRootUrl()
                });
              }
            } catch (enrollmentError) {
              console.error(`Error during auto-enrollment for ${enrollment.user_email}:`, enrollmentError.message);
            }
          }
        }
      } catch (moodleError) {
        console.error(`Moodle lookup failed for ${enrollment.user_email}:`, moodleError.message);
        // Continue to show the manual completion page
      }

      if (acceptHeader.includes('application/json')) {
        return this.sendSuccess(res, enrollment, 'Enrollment found');
      }

      // Render verification page with current status
      return this.renderPage(req, res, 'pages/enrollments/verify', {
        title: 'Complete Your Course Enrollment',
        link: '/enrollments/verify',
        enrollment: enrollment,
        moodleUser: moodleUser,
        enrollmentCompleted: false,
        moodleRootUrl: this.moodleService.getMoodleRootUrl()
      });
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }

  // Complete pending enrollment
  async completeEnrollment(req, res) {
    try {
      const { token } = req.params;
      
      const result = await this.enrollmentService.verifyAndCompleteEnrollment(token);
      
      return this.sendSuccess(res, result, 'Enrollment completed successfully');
    } catch (error) {
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

  // Resend enrollment email by token (public route)
  async resendEmailByToken(req, res) {
    try {
      const { token } = req.params;
      
      // First verify the token is valid
      const enrollment = await this.enrollmentService.getEnrollmentByToken(token);
      if (!enrollment) {
        return this.sendError(res, 'Invalid verification token', 404);
      }
      
      const result = await this.enrollmentService.resendEnrollmentEmail(enrollment._id);
      
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
