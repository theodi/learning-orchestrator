import express from 'express';
import MoodleController from '../controllers/MoodleController.js';

const router = express.Router();
const moodleController = new MoodleController();

// Page shell and data endpoint with content negotiation
router.get('/courses', (req, res) => moodleController.getCourses(req, res));
router.get('/users', (req, res) => moodleController.getUsers(req, res));

// Admin refresh endpoints (authenticated via ensureAuthenticated at mount)
router.post('/cache/refresh-course/:courseId', async (req, res) => {
  try {
    const id = parseInt(req.params.courseId, 10);
    const data = await moodleController.service.getCourseEnrolments(id);
    return res.json({ success: true, count: Array.isArray(data) ? data.length : 0 });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Failed' });
  }
});

router.post('/cache/refresh-membership', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ success: false, message: 'email required' });
    const info = await moodleController.hubspot.getContactMembershipByEmail(String(email).toLowerCase());
    return res.json({ success: true, info });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Failed' });
  }
});

export default router;


