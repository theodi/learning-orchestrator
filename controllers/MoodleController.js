import BaseController from './BaseController.js';
import { MoodleService } from '../services/moodleService.js';
import HubSpotService from '../services/hubspotService.js';
import MoodleCourseEnrollments from '../models/MoodleCourseEnrollments.js';
import MoodleUserAggregate from '../models/MoodleUserAggregate.js';
import HubSpotMembership from '../models/HubSpotMembership.js';

export class MoodleController extends BaseController {
  constructor() {
    super();
    this.service = new MoodleService();
    this.hubspot = new HubSpotService();
    this.MoodleCourseEnrollments = MoodleCourseEnrollments;
    this.MoodleUserAggregate = MoodleUserAggregate;
    this.HubSpotMembership = HubSpotMembership;
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

  // GET /moodle/users with content negotiation
  async getUsers(req, res) {
    try {
      const acceptHeader = (req.get('accept') || '').toLowerCase();
      if (!acceptHeader.includes('application/json')) {
        return this.renderPage(req, res, 'pages/moodle/users', {
          title: 'Moodle Users & Enrollments',
          link: '/moodle/users',
          portalId: process.env.HUBSPOT_PORTAL_ID || ''
        });
      }

      // Cache-first aggregation: use cached course enrolments if available
      const usersByKey = new Map(); // key: email||moodleId
      const useCacheFirst = (process.env.MOODLE_CACHE_FIRST || 'true').toLowerCase() !== 'false';
      let usedCache = false;
      if (useCacheFirst) {
        try {
          const cachedCourses = await this.MoodleCourseEnrollments.find({}).lean();
          if (cachedCourses && cachedCourses.length > 0) {
            for (const doc of cachedCourses) {
              const courseId = doc.course_id;
              if (courseId === 1) continue;
              const courseName = doc.course_name || String(courseId);
              for (const u of (doc.enrollments || [])) {
                const email = (u.email || '').toLowerCase();
                const key = email || `moodle:${u.moodle_user_id}`;
                if (!usersByKey.has(key)) {
                  usersByKey.set(key, {
                    moodle_user_id: u.moodle_user_id || null,
                    email: email || null,
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
            usedCache = true;
          }
        } catch (_) {}
      }

      // If no cache, fall back to live fetch (slow path)
      if (!usedCache) {
        const courses = await this.service.fetchCourses();
        const courseInfos = (courses || [])
          .map(c => ({ id: parseInt(c.id), name: c.fullname || c.shortname || String(c.id) }))
          .filter(c => Number.isFinite(c.id) && c.id !== 1);

        const concurrency = Math.max(1, parseInt(process.env.MOODLE_CONCURRENCY || '5', 10));

        for (let i = 0; i < courseInfos.length; i += concurrency) {
          const batch = courseInfos.slice(i, i + concurrency);
          const results = await Promise.all(
            batch.map(ci => this.service.getCourseEnrolments(ci.id)
              .then(list => ({ course: ci, enrolments: Array.isArray(list) ? list : [] }))
              .catch(() => ({ course: ci, enrolments: [] })))
          );

          for (const r of results) {
            const courseId = r.course.id;
            const courseName = r.course.name;
            for (const u of r.enrolments) {
              const email = (u.email || '').toLowerCase();
              const key = email || `moodle:${u.id}`;
              if (!usersByKey.has(key)) {
                usersByKey.set(key, {
                  moodle_user_id: u.id || null,
                  email: email || null,
                  fullname: [u.firstname, u.lastname].filter(Boolean).join(' ') || u.fullname || u.username || '',
                  username: u.username || null,
                  firstaccess: u.firstaccess || null,
                  lastaccess: u.lastaccess || null,
                  courses: []
                });
              }
              usersByKey.get(key).courses.push({ id: courseId, fullname: courseName, accessed: Boolean(u.lastaccess) });
            }
          }

          // Persist batch to cache
          try {
            const Model = this.MoodleCourseEnrollments;
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
            if (ops.length > 0) await Model.bulkWrite(ops, { ordered: false });
          } catch (_) {}
        }
      }

      // Build minimal rows first
      const baseRows = Array.from(usersByKey.values()).map(r => ({
        fullname: r.fullname || '',
        email: r.email || null,
        course_count: Array.isArray(r.courses) ? r.courses.length : 0,
        courses: r.courses || []
      }));

      // Enrich with HubSpot membership using batch APIs
      const now = Date.now();
      const ttlMs = (parseInt(process.env.HUBSPOT_CACHE_HOURS || '24', 10)) * 3600 * 1000;
      const cachedRows = [];
      const needEmails = [];
      for (const row of baseRows) {
        if (!row.email) { cachedRows.push({ ...row, membership_status: null, membership_type: null }); continue; }
        try {
          const cached = await this.HubSpotMembership.findOne({ email: row.email }).lean();
          if (cached && cached.checkedAt && (now - new Date(cached.checkedAt).getTime()) < ttlMs) {
            cachedRows.push({
              ...row,
              contact_id: cached.contact_id || null,
              membership_status: cached.membership_status || null,
              membership_type: cached.membership_type || null,
              company_membership_active: Boolean(cached.company_membership_active || false)
            });
          } else {
            needEmails.push(row.email);
          }
        } catch (_) {
          needEmails.push(row.email);
        }
      }

      if (needEmails.length > 0) {
        const contactMap = await this.hubspot.getContactsMembershipByEmails(needEmails);
        const contactIds = Array.from(contactMap.values()).map(v => v.contact_id).filter(Boolean);
        const assocMap = await this.hubspot.getAssociatedCompaniesForContacts(contactIds);
        const companyIds = Array.from(new Set(Array.from(assocMap.values()).filter(Boolean)));
        const companyMap = await this.hubspot.getCompaniesByIdsBatch(companyIds);

        for (const row of baseRows) {
          if (!row.email) continue;
          if (!needEmails.includes(row.email)) continue;
          const c = contactMap.get(String(row.email).toLowerCase()) || null;
          const contact_id = c?.contact_id || null;
          let membership_status = c?.contact_membership_status || null;
          let membership_type = c?.contact_membership_type || null;
          let company_membership_active = false;
          if (contact_id) {
            const compId = assocMap.get(contact_id) || null;
            if (compId) {
              const p = companyMap.get(compId) || {};
              if ((p.odi_membership_status__active_or_lapsed__ || '').toLowerCase() === 'active') {
                company_membership_active = true;
                membership_status = 'Active';
                membership_type = p.member_partner_type_org_ || membership_type || null;
              }
            }
          }
          cachedRows.push({ ...row, contact_id, membership_status, membership_type, company_membership_active });
          try {
            await this.HubSpotMembership.updateOne(
              { email: row.email },
              { $set: { contact_id, membership_status, membership_type, company_membership_active, checkedAt: new Date() } },
              { upsert: true }
            );
          } catch (_) {}
        }
      }

      const data = cachedRows;

      return this.sendSuccess(res, data, 'Moodle users with enrollments');

    } catch (error) {
      return this.sendError(res, error.message || 'Failed to fetch Moodle users');
    }
  }
}

export default MoodleController;


