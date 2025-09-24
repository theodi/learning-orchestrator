import { MoodleService } from './moodleService.js';
import Enrollment from '../models/Enrollment.js';
import crypto from 'crypto';

export class EnrollmentService {
  constructor() {
    this.moodleService = new MoodleService();
  }

  // Aggregate Moodle users from cached course enrollments
  async buildAggregatedUsersFromCache() {
    const MoodleCourseEnrollments = (await import('../models/MoodleCourseEnrollments.js')).default;
    const docs = await MoodleCourseEnrollments.find({}).lean();
    const usersByKey = new Map();
    for (const doc of docs) {
      const courseId = doc.course_id;
      const courseName = doc.course_name || String(courseId);
      for (const u of (doc.enrollments || [])) {
        const email = (u.email || '').toLowerCase();
        const key = email || `moodle:${u.moodle_user_id}`;
        if (!usersByKey.has(key)) {
          usersByKey.set(key, {
            key,
            email: email || null,
            moodle_user_id: u.moodle_user_id || null,
            fullname: u.fullname || u.username || '',
            username: u.username || null,
            firstaccess: u.firstaccess || null,
            lastaccess: u.lastaccess || null,
            courses: []
          });
        }
        usersByKey.get(key).courses.push({ id: courseId, fullname: courseName, accessed: Boolean(u.lastaccess) });
      }
    }
    return Array.from(usersByKey.values()).map(r => ({
      ...r,
      course_count: Array.isArray(r.courses) ? r.courses.length : 0
    }));
  }

  // Generate unique secret token
  generateSecretToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Check enrollment/access status for a user in a course
  async getUserCourseStatus(courseId, email, durationMonths = 12) {
    try {
      const normalizedEmail = (email || '').toLowerCase().trim();
      if (!courseId || !normalizedEmail) {
        throw new Error('course_id and email are required');
      }

      // Fetch Moodle enrollments and attempt to locate user
      const moodleEnrollments = await this.moodleService.getCourseEnrolments(parseInt(courseId));

      // Match by email primarily; fallback to Moodle user lookup by email
      let moodleUser = null;
      if (normalizedEmail) {
        moodleUser = moodleEnrollments.find(u => (u.email || '').toLowerCase() === normalizedEmail);
      }

      // If not present in course enrolments, try to resolve Moodle user by email for details
      let moodleUserId = moodleUser ? moodleUser.id : null;
      if (!moodleUserId) {
        try {
          const lookedUp = await this.moodleService.lookupUserByEmail(normalizedEmail);
          moodleUserId = lookedUp ? lookedUp.id : null;
        } catch (_) {
          moodleUserId = null;
        }
      }

      // Enrolled if present in course enrolments OR details returned for this user+course
      let enrolled = Boolean(moodleUser);

      // Prefer authoritative per-user enrollment details from Moodle
      let hasMoodleAccess = false;
      try {
        if (moodleUserId) {
          const details = await this.moodleService.getUserEnrollmentDetails(parseInt(moodleUserId, 10), parseInt(courseId, 10));
          if (details) {
            enrolled = true; // details present implies enrollment in course
            // Accessed ONLY if lastCourseAccess is present
            hasMoodleAccess = Boolean(details.lastCourseAccess);
          } else if (moodleUser) {
            // Fallback to raw enrolment list timestamps if details not available
            const lastCourseAccessTs = parseInt(moodleUser.lastcourseaccess || 0, 10);
            // Accessed ONLY if lastcourseaccess > 0
            hasMoodleAccess = lastCourseAccessTs > 0;
          }
        }
      } catch (e) {
        // Non-fatal; keep hasMoodleAccess as computed
        hasMoodleAccess = Boolean(hasMoodleAccess);
      }

      const accessed = hasMoodleAccess;

      const result = { enrolled, accessed };

      // If not enrolled, attempt to auto-enrol the user directly in Moodle using their email
      if (!enrolled) {
        try {
          const lookedUp = await this.moodleService.lookupUserByEmail(normalizedEmail);
          if (lookedUp && lookedUp.id) {
            // Enrol using provided duration (months)
            const enrolResult = await this.moodleService.enrolUserInCourse(lookedUp.id, parseInt(courseId, 10), parseInt(durationMonths, 10));
            if (enrolResult && enrolResult.success) {
              // Confirm enrolment and access
              const details = await this.moodleService.getUserEnrollmentDetails(lookedUp.id, parseInt(courseId, 10));
              result.enrolled = Boolean(details);
              result.accessed = Boolean(details && details.lastCourseAccess);
              return result;
            }
          }
        } catch (_) {
          // Swallow errors to keep endpoint idempotent; client can retry later
        }

        // As a courtesy, if a pending enrollment exists in DB, include verification info
        try {
          const pending = await Enrollment.findOne({
            course_id: parseInt(courseId),
            user_email: normalizedEmail,
            status: 'pending_account_creation'
          });
          if (pending && pending.secret_token) {
            result.verification_token = pending.secret_token;
            result.verification_path = `/enrollments/verify/${pending.secret_token}`;
          }
        } catch (_) {}
      }

      return result;
    } catch (error) {
      console.error('Error checking user course status:', error.message);
      throw error;
    }
  }

  // Create enrollment record
  async createEnrollment(userEmail, courseId, courseName, durationMonths) {
    try {
      const expiryDate = new Date();
      expiryDate.setMonth(expiryDate.getMonth() + durationMonths);

      const enrollment = new Enrollment({
        user_email: userEmail,
        course_id: courseId,
        course_name: courseName,
        duration_months: durationMonths,
        expiry_date: expiryDate,
        secret_token: this.generateSecretToken()
      });

      await enrollment.save();
      return enrollment;
    } catch (error) {
      if (error.code === 11000) { // Duplicate key error
        throw new Error('User is already enrolled in this course');
      }
      throw error;
    }
  }

  // Process bulk enrollment
  async processBulkEnrollment(courseId, courseName, userEmails, durationMonths) {
    const results = {
      successful: [],
      pending: [],
      failed: []
    };

    for (const email of userEmails) {
      try {
        // Check if user already has enrollment
        const existingEnrollment = await Enrollment.findOne({
          user_email: email,
          course_id: courseId
        });

        if (existingEnrollment) {
          results.failed.push({
            email,
            reason: 'Already enrolled in this course'
          });
          continue;
        }

        // Look up user in Moodle
        const moodleUser = await this.moodleService.lookupUserByEmail(email);

        if (moodleUser) {
          // User exists in Moodle - enroll directly
          try {
            const enrollmentResult = await this.moodleService.enrolUserInCourse(
              moodleUser.id,
              courseId,
              durationMonths
            );

            // Only create database record if Moodle enrollment succeeded
            const enrollment = await this.createEnrollment(email, courseId, courseName, durationMonths);
            enrollment.status = 'enrolled';
            enrollment.moodle_user_id = moodleUser.id;
            enrollment.last_moodle_sync = new Date();
            await enrollment.save();

            results.successful.push({
              email,
              moodle_user_id: moodleUser.id,
              enrollment_id: enrollment._id
            });
          } catch (enrollmentError) {
            console.error(`Moodle enrollment failed for ${email}:`, enrollmentError.message);
            // Moodle enrollment failed - don't create any database record
            // Just add to failed results
            results.failed.push({
              email,
              reason: `Moodle enrollment failed: ${enrollmentError.message}`
            });
          }
        } else {
          // User doesn't exist in Moodle - create pending enrollment
          const enrollment = await this.createEnrollment(email, courseId, courseName, durationMonths);
          results.pending.push({
            email,
            enrollment_id: enrollment._id,
            secret_token: enrollment.secret_token
          });
        }
      } catch (error) {
        console.error(`Error processing enrollment for ${email}:`, error.message);
        results.failed.push({
          email,
          reason: error.message
        });
      }
    }

    return results;
  }

  // Clean up orphaned enrollment records
  async cleanupOrphanedEnrollments() {
    try {
      // Find enrollments that are marked as 'enrolled' but don't have a moodle_user_id
      // or enrollments that are marked as 'failed' 
      const orphanedEnrollments = await Enrollment.find({
        $or: [
          { status: 'enrolled', moodle_user_id: null },
          { status: 'failed' }
        ]
      });

      if (orphanedEnrollments.length > 0) {
        for (const enrollment of orphanedEnrollments) {
          await Enrollment.findByIdAndDelete(enrollment._id);
        }
      }

      return orphanedEnrollments.length;
    } catch (error) {
      console.error('Error during cleanup:', error.message);
      throw error;
    }
  }

  // Get enrollments for a specific course
  async getCourseEnrollments(courseId) {
    try {
      const enrollments = await Enrollment.find({ course_id: courseId })
        .sort({ enrollment_date: -1 });

      // Fetch Moodle enrolments for the course
      const moodleEnrollments = await this.moodleService.getCourseEnrolments(courseId);

      // Sync Moodle data into existing DB-backed enrollments
      for (const enrollment of enrollments) {
        if (enrollment.moodle_user_id && enrollment.status === 'enrolled') {
          const moodleEnrollmentDetails = await this.moodleService.getUserEnrollmentDetails(
            enrollment.moodle_user_id,
            enrollment.course_id
          );

          if (moodleEnrollmentDetails) {
            enrollment.moodle_first_access = moodleEnrollmentDetails.firstAccess;
            enrollment.moodle_last_access = moodleEnrollmentDetails.lastAccess;
            enrollment.moodle_last_course_access = moodleEnrollmentDetails.lastCourseAccess;
            enrollment.last_moodle_sync = new Date();

            if (moodleEnrollmentDetails.courseName && moodleEnrollmentDetails.courseName !== enrollment.course_name) {
              enrollment.course_name = moodleEnrollmentDetails.courseName;
            }

            await enrollment.save();
          } else {
            const moodleEnrollment = moodleEnrollments.find(m => m.id === enrollment.moodle_user_id);
            if (moodleEnrollment) {
              enrollment.moodle_last_access = moodleEnrollment.lastaccess ? new Date(moodleEnrollment.lastaccess * 1000) : null;
              enrollment.last_moodle_sync = new Date();
              await enrollment.save();
            }
          }
        }
      }

      // Build quick lookup sets for deduplication by Moodle user id and email
      const existingByMoodleId = new Set(
        enrollments.filter(e => e.moodle_user_id).map(e => e.moodle_user_id)
      );
      const existingByEmail = new Set(
        enrollments.filter(e => e.user_email).map(e => e.user_email.toLowerCase())
      );

      // Add Moodle-only enrolments (not in Mongo) to the returned list as virtual rows
      const virtualRows = [];
      for (const m of moodleEnrollments) {
        const moodleId = m.id;
        const email = (m.email || '').toLowerCase();

        // Skip if already represented by DB enrollment
        if ((moodleId && existingByMoodleId.has(moodleId)) || (email && existingByEmail.has(email))) {
          continue;
        }

        // Normalize Moodle fields to our view model
        virtualRows.push({
          _id: null,
          user_email: email || m.username || `moodle-user-${moodleId}`,
          status: 'enrolled',
          course_id: parseInt(courseId),
          course_name: null,
          duration_months: null,
          expiry_date: null,
          secret_token: null,
          moodle_user_id: moodleId || null,
          last_moodle_sync: new Date(),
          moodle_first_access: m.firstaccess ? new Date(m.firstaccess * 1000) : null,
          moodle_last_access: m.lastaccess ? new Date(m.lastaccess * 1000) : null,
          moodle_last_course_access: m.lastcourseaccess ? new Date(m.lastcourseaccess * 1000) : null
        });
      }

      // Return merged list: DB enrollments first (sorted), then Moodle-only virtual rows
      return [...enrollments, ...virtualRows];
    } catch (error) {
      console.error('Error fetching course enrollments:', error.message);
      throw error;
    }
  }

  // Get enrollment by secret token
  async getEnrollmentByToken(token) {
    try {
      const enrollment = await Enrollment.findOne({ secret_token: token });
      
      if (enrollment && enrollment.moodle_user_id && enrollment.status === 'enrolled') {
        // Sync with Moodle to get latest enrollment data
        const moodleEnrollmentDetails = await this.moodleService.getUserEnrollmentDetails(
          enrollment.moodle_user_id, 
          enrollment.course_id
        );
        
        if (moodleEnrollmentDetails) {
          // Update with Moodle data (authoritative source)
          enrollment.moodle_first_access = moodleEnrollmentDetails.firstAccess;
          enrollment.moodle_last_access = moodleEnrollmentDetails.lastAccess;
          enrollment.moodle_last_course_access = moodleEnrollmentDetails.lastCourseAccess;
          enrollment.last_moodle_sync = new Date();
          
          // Update course name if it has changed in Moodle
          if (moodleEnrollmentDetails.courseName && moodleEnrollmentDetails.courseName !== enrollment.course_name) {
            enrollment.course_name = moodleEnrollmentDetails.courseName;
          }
          
          await enrollment.save();
        }
      }
      
      return enrollment;
    } catch (error) {
      console.error('Error fetching enrollment by token:', error.message);
      throw error;
    }
  }

  // Verify and complete pending enrollment
  async verifyAndCompleteEnrollment(token) {
    try {
      const enrollment = await this.getEnrollmentByToken(token);
      if (!enrollment) {
        throw new Error('Invalid verification token');
      }

      if (enrollment.status !== 'pending_account_creation') {
        throw new Error('Enrollment is not in pending status');
      }

      // Check if user now exists in Moodle
      const moodleUser = await this.moodleService.lookupUserByEmail(enrollment.user_email);
      
      if (moodleUser) {
        // User now exists - enroll them
        // Use stored duration_months if available, otherwise calculate from expiry date
        const durationMonths = enrollment.duration_months || 
          Math.ceil((enrollment.expiry_date - enrollment.enrollment_date) / (1000 * 60 * 60 * 24 * 30));
        
        const enrollmentResult = await this.moodleService.enrolUserInCourse(
          moodleUser.id,
          enrollment.course_id,
          durationMonths
        );

        enrollment.status = 'enrolled';
        enrollment.moodle_user_id = moodleUser.id;
        enrollment.last_moodle_sync = new Date();
        await enrollment.save();

        return {
          success: true,
          message: 'Enrollment completed successfully',
          enrollment
        };
      } else {
        throw new Error('User account not found in Moodle. Please ensure you have created an ODI account and logged into Moodle.');
      }
    } catch (error) {
      console.error('Error verifying enrollment:', error.message);
      throw error;
    }
  }

  // Resend enrollment email
  async resendEnrollmentEmail(enrollmentId) {
    try {
      const enrollment = await Enrollment.findById(enrollmentId);
      if (!enrollment) {
        throw new Error('Enrollment not found');
      }

      enrollment.last_email_sent = new Date();
      await enrollment.save();

      // TODO: Implement email sending logic
      // For now, just return success
      return {
        success: true,
        message: 'Enrollment email resent',
        enrollment
      };
    } catch (error) {
      console.error('Error resending enrollment email:', error.message);
      throw error;
    }
  }

  // Get all enrollments with filtering
  async getAllEnrollments(filters = {}) {
    try {
      const query = {};
      
      if (filters.status) {
        query.status = filters.status;
      }
      
      if (filters.course_id) {
        query.course_id = filters.course_id;
      }
      
      if (filters.user_email) {
        query.user_email = { $regex: filters.user_email, $options: 'i' };
      }

      const enrollments = await Enrollment.find(query)
        .sort({ enrollment_date: -1 })
        .limit(filters.limit || 100);

      return enrollments;
    } catch (error) {
      console.error('Error fetching enrollments:', error.message);
      throw error;
    }
  }
}

export default EnrollmentService;
