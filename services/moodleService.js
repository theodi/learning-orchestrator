import axios from 'axios';

export class MoodleService {
  constructor() {
    this.baseUrl = process.env.MOODLE_URI;
    this.token = process.env.MOODLE_TOKEN;
    this.functionName = 'core_course_get_courses';
  }

  // Get the Moodle root URL for frontend links
  getMoodleRootUrl() {
    return process.env.MOODLE_ROOT || 'https://moodle.learndata.info';
  }

  buildParams(extraParams = {}) {
    const params = {
      wstoken: this.token,
      wsfunction: this.functionName,
      moodlewsrestformat: 'json',
    };

    // Handle array parameters by flattening them into indexed format
    Object.keys(extraParams).forEach(key => {
      if (Array.isArray(extraParams[key])) {
        // Flatten arrays into indexed parameters (e.g., enrolments[0][roleid])
        extraParams[key].forEach((item, index) => {
          if (typeof item === 'object') {
            Object.keys(item).forEach(subKey => {
              params[`${key}[${index}][${subKey}]`] = item[subKey];
            });
          } else {
            params[`${key}[${index}]`] = item;
          }
        });
      } else {
        params[key] = extraParams[key];
      }
    });

    return params;
  }

  async fetchCourses() {
    try {
      const response = await axios.get(this.baseUrl, { params: this.buildParams() });

      // Moodle may return error as an object with exception info or string like 'invalidtoken'
      if (typeof response.data === 'string' && response.data.toLowerCase().includes('invalidtoken')) {
        throw new Error('Invalid token - token not found');
      }

      if (response.data && response.data.exception) {
        const message = response.data.message || response.data.error || 'Moodle API error';
        throw new Error(message);
      }

      // Expect array of courses
      const courses = Array.isArray(response.data) ? response.data : (response.data.courses || []);
      return courses;
    } catch (error) {
      // Surface Moodle error detail where possible
      const details = error.response?.data || error.message;
      throw new Error(typeof details === 'string' ? details : (details?.message || 'Failed to fetch Moodle courses'));
    }
  }

  // Look up user by email
  async lookupUserByEmail(email) {
    try {
      const params = this.buildParams({
        wsfunction: 'core_user_get_users_by_field',
        field: 'email',
        values: [email]
      });
      const response = await axios.get(this.baseUrl, { params });
      
      if (response.data && response.data.exception) {
        throw new Error(response.data.message || 'User lookup failed');
      }

      return response.data && response.data.length > 0 ? response.data[0] : null;
    } catch (error) {
      console.error('Error looking up user by email:', error.message);
      return null;
    }
  }

  // Enrol user in course
  async enrolUserInCourse(userId, courseId, enrolmentDurationMonths = 12) {
    try {
      const enrolmentEndDate = new Date();
      enrolmentEndDate.setMonth(enrolmentEndDate.getMonth() + enrolmentDurationMonths);

      const enrolmentData = {
        roleid: 5, // Student role ID (may need to be configurable)
        userid: parseInt(userId),
        courseid: parseInt(courseId),
        timestart: Math.floor(Date.now() / 1000),
        timeend: Math.floor(enrolmentEndDate.getTime() / 1000),
        suspend: 0
      };

      const params = this.buildParams({
        wsfunction: 'enrol_manual_enrol_users',
        enrolments: [enrolmentData]
      });

      const response = await axios.get(this.baseUrl, { params });
      
      if (response.data && response.data.exception) {
        throw new Error(response.data.message || 'Enrolment failed');
      }

      return {
        success: true,
        enrolmentEndDate: enrolmentEndDate
      };
    } catch (error) {
      console.error('Error enrolling user in course:', error.message);
      if (error.response) {
        console.error('Response data:', error.response.data);
        console.error('Response status:', error.response.status);
      }
      throw new Error(`Failed to enroll user: ${error.message}`);
    }
  }

  // Get course enrolments
  async getCourseEnrolments(courseId) {
    try {
      const params = this.buildParams({
        wsfunction: 'core_enrol_get_enrolled_users',
        courseid: courseId
      });

      const response = await axios.get(this.baseUrl, { params });
      
      if (response.data && response.data.exception) {
        throw new Error(response.data.message || 'Failed to fetch enrolments');
      }

      return response.data || [];
    } catch (error) {
      console.error('Error fetching course enrolments:', error.message);
      return [];
    }
  }

  // Check if user is enrolled in course
  async isUserEnrolledInCourse(userId, courseId) {
    try {
      const enrolments = await this.getCourseEnrolments(courseId);
      return enrolments.some(enrolment => enrolment.id === userId);
    } catch (error) {
      console.error('Error checking enrolment status:', error.message);
      return false;
    }
  }

  // Get user enrollment details from Moodle
  async getUserEnrollmentDetails(userId, courseId) {
    try {
      // First get the course enrollments to find the specific user
      const params = this.buildParams({
        wsfunction: 'core_enrol_get_enrolled_users',
        courseid: courseId
      });

      const response = await axios.get(this.baseUrl, { params });
      
      if (response.data && response.data.exception) {
        throw new Error(response.data.message || 'Failed to fetch course enrollments');
      }

      // Find the specific user enrollment in this course
      const userEnrollment = response.data.find(user => user.id === userId);
      
      if (userEnrollment) {
        return {
          courseId: courseId,
          courseName: userEnrollment.course_name || null,
          firstAccess: userEnrollment.firstaccess ? new Date(userEnrollment.firstaccess * 1000) : null,
          lastAccess: userEnrollment.lastaccess ? new Date(userEnrollment.lastaccess * 1000) : null,
          lastCourseAccess: userEnrollment.lastcourseaccess ? new Date(userEnrollment.lastcourseaccess * 1000) : null,
          progress: userEnrollment.progress || 0
        };
      }

      return null;
    } catch (error) {
      console.error('Error fetching user enrollment details:', error.message);
      return null;
    }
  }
}

export default MoodleService;


