import { MoodleService } from './moodleService.js';
import Enrollment from '../models/Enrollment.js';
import crypto from 'crypto';

export class EnrollmentService {
  constructor() {
    this.moodleService = new MoodleService();
  }

  // Generate unique secret token
  generateSecretToken() {
    return crypto.randomBytes(32).toString('hex');
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
    console.log('Starting bulk enrollment process:', {
      courseId,
      courseName,
      userEmails,
      durationMonths
    });

    const results = {
      successful: [],
      pending: [],
      failed: []
    };

    for (const email of userEmails) {
      console.log(`Processing enrollment for: ${email}`);
      
      try {
        // Check if user already has enrollment
        const existingEnrollment = await Enrollment.findOne({
          user_email: email,
          course_id: courseId
        });

        if (existingEnrollment) {
          console.log(`User ${email} already enrolled in course ${courseId}`);
          results.failed.push({
            email,
            reason: 'Already enrolled in this course'
          });
          continue;
        }

        // Look up user in Moodle
        console.log(`Looking up user ${email} in Moodle...`);
        const moodleUser = await this.moodleService.lookupUserByEmail(email);

        if (moodleUser) {
          console.log(`User ${email} found in Moodle with ID: ${moodleUser.id}`);
          // User exists in Moodle - enroll directly
          try {
            console.log(`Attempting to enroll user ${email} (Moodle ID: ${moodleUser.id}) in course ${courseId}`);
            const enrollmentResult = await this.moodleService.enrolUserInCourse(
              moodleUser.id,
              courseId,
              durationMonths
            );

            console.log(`Moodle enrollment successful for ${email}:`, enrollmentResult);

            // Only create database record if Moodle enrollment succeeded
            const enrollment = await this.createEnrollment(email, courseId, courseName, durationMonths);
            enrollment.status = 'enrolled';
            enrollment.moodle_user_id = moodleUser.id;
            enrollment.last_moodle_sync = new Date();
            await enrollment.save();

            console.log(`Enrollment record created for ${email}`);

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
          console.log(`User ${email} not found in Moodle, creating pending enrollment`);
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

    console.log('Bulk enrollment process completed:', results);
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
        console.log(`Found ${orphanedEnrollments.length} orphaned enrollments to clean up`);
        
        for (const enrollment of orphanedEnrollments) {
          console.log(`Cleaning up orphaned enrollment for ${enrollment.user_email} in course ${enrollment.course_id}`);
          await Enrollment.findByIdAndDelete(enrollment._id);
        }
        
        console.log('Cleanup completed');
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

      // Sync with Moodle for existing enrollments
      const moodleEnrollments = await this.moodleService.getCourseEnrolments(courseId);
      
      for (const enrollment of enrollments) {
        if (enrollment.moodle_user_id) {
          const moodleEnrollment = moodleEnrollments.find(m => m.id === enrollment.moodle_user_id);
          if (moodleEnrollment) {
            enrollment.moodle_last_access = moodleEnrollment.lastaccess ? 
              new Date(moodleEnrollment.lastaccess * 1000) : null;
            enrollment.last_moodle_sync = new Date();
            await enrollment.save();
          }
        }
      }

      return enrollments;
    } catch (error) {
      console.error('Error fetching course enrollments:', error.message);
      throw error;
    }
  }

  // Get enrollment by secret token
  async getEnrollmentByToken(token) {
    try {
      return await Enrollment.findOne({ secret_token: token });
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
        const enrollmentResult = await this.moodleService.enrolUserInCourse(
          moodleUser.id,
          enrollment.course_id,
          Math.ceil((enrollment.expiry_date - enrollment.enrollment_date) / (1000 * 60 * 60 * 24 * 30))
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
