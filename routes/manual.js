import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// Render the manual page shell; client will fetch markdown and render to HTML
router.get('/', (req, res) => {
  res.locals.page = { title: 'Help & User Guide', link: '/manual' };
  return res.render('pages/manual');
});

// Serve raw MANUAL.md content for client-side rendering
router.get('/raw', (req, res) => {
  try {
    const manualPath = path.resolve(process.cwd(), 'MANUAL.md');
    const content = fs.readFileSync(manualPath, 'utf8');
    res.set('Content-Type', 'text/plain; charset=utf-8');
    return res.send(content);
  } catch (err) {
    return res.status(404).send('Manual not found');
  }
});

export default router;


