import BaseController from './BaseController.js';
import { MoodleService } from '../services/moodleService.js';

export class MoodleController extends BaseController {
  constructor() {
    super();
    this.service = new MoodleService();
  }

  // Browse page shell (AJAX will populate the table)
  async browse(req, res) {
    return this.renderPage(req, res, 'pages/moodle/index', {
      title: 'Browse Moodle Courses',
      link: '/moodle/courses'
    });
  }

  // GET /moodle/courses with content negotiation
  async getCourses(req, res) {
    try {
      const acceptHeader = (req.get('accept') || '').toLowerCase();
      const courses = await this.service.fetchCourses();

      if (acceptHeader.includes('application/json')) {
        return this.sendSuccess(res, courses, 'Courses fetched successfully');
      }

      // Default: render page shell (for humans). Data loads via AJAX.
      return this.renderPage(req, res, 'pages/moodle/index', {
        title: 'Browse Moodle Courses',
        link: '/moodle/courses'
      });
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }
}

export default MoodleController;


