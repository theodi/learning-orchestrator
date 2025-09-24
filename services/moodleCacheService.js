import MoodleCourseEnrollments from '../models/MoodleCourseEnrollments.js';
import { MoodleService } from './moodleService.js';

export class MoodleCacheService {
  constructor() {
    this.moodle = new MoodleService();
  }

  async refreshCoursesBatch({ concurrency = 5 } = {}) {
    const courses = await this.moodle.fetchCourses();
    const courseInfos = (courses || [])
      .map(c => ({ id: parseInt(c.id), name: c.fullname || c.shortname || String(c.id) }))
      .filter(c => Number.isFinite(c.id) && c.id !== 1);

    for (let i = 0; i < courseInfos.length; i += concurrency) {
      const batch = courseInfos.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(ci => this.moodle.getCourseEnrolments(ci.id)
          .then(list => ({ course: ci, enrolments: Array.isArray(list) ? list : [] }))
          .catch(() => ({ course: ci, enrolments: [] })))
      );

      const ops = results.map(r => ({
        updateOne: {
          filter: { course_id: r.course.id },
          update: {
            $set: {
              course_name: r.course.name,
              lastFetchedAt: new Date(),
              enrollments: (r.enrolments || []).map(u => ({
                moodle_user_id: u.id || null,
                email: (u.email || '').toLowerCase() || null,
                fullname: [u.firstname, u.lastname].filter(Boolean).join(' ') || u.fullname || u.username || '',
                username: u.username || null,
                firstaccess: u.firstaccess || null,
                lastaccess: u.lastaccess || null
              }))
            }
          },
          upsert: true
        }
      }));
      if (ops.length > 0) await MoodleCourseEnrollments.bulkWrite(ops, { ordered: false });
    }
  }
}

export default MoodleCacheService;


