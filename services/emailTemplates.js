// Email templates for learner reminders

function buildCourseListHtml(courses) {
  const items = (courses || []).map(c => (
    `        <li>
          <strong>${c.course_name || ('Course #' + c.course_id)}</strong>
          <br/>
          Enrolled: ${c.enrolled ? 'Yes' : 'No'} | Accessed: ${c.accessed ? 'Yes' : 'No'}
        </li>`
  )).join('\n');
  return `<ul>\n${items}\n      </ul>`;
}

export function buildWelcomeEmail({ moodleRootUrl, courses, anyEnrolled, learnerName }) {
  const courseList = buildCourseListHtml(courses);
  
  let subject, bodyHtml;
  
  subject = 'Welcome! Access your ODI course(s)';
  bodyHtml = `
      <h1>Welcome to Your ODI Course!</h1>
      <p>Dear ${learnerName || 'Learner'},</p>
      <p>Your Moodle account has been provisioned with the email we sent this message to.</p>
      <ol>
        <li>
          <strong>Sign in to Moodle with your ODI account</strong>
          <br>
          <a class="btn" href="${moodleRootUrl}/login/index.php" target="_blank">Go to Moodle</a>
          <br>
          <small>Use "Sign in with ODI Account" and the same email address.</small>
        </li>
        <li>
          <strong>Don’t have an ODI account?</strong> Create one, then sign in to Moodle.
          <br>
          <a href="https://theodi.org/account/register/" target="_blank" class="btn">Create ODI Account</a>
        </li>
      </ol>
      <h2>Your Courses</h2>
      ${courseList}
      <p><small>If you have trouble accessing your course, email <a href="mailto:training@theodi.org">training@theodi.org</a>.</small></p>
      <p style="margin-top: 16px;">Kind regards,<br/>The ODI Learning Team</p>
  `;
  
  return { subject, bodyHtml };
}

export function buildReminderEmail({ moodleRootUrl, courses, anyEnrolled, learnerName }) {
  const courseList = buildCourseListHtml(courses);
  
  let subject, bodyHtml;
  
  subject = 'Reminder: Access your ODI course(s)';
  bodyHtml = `
      <h1>Reminder: Access Your Course(s)</h1>
      <p>Dear ${learnerName || 'Learner'},</p>
      <p>Your enrolment is set up. To access your course(s):</p>
      <ol>
        <li>
          <strong>Sign in to Moodle with your ODI account</strong>
          <br>
          <a class="btn" href="${moodleRootUrl}/login/index.php" target="_blank">Go to Moodle</a>
        </li>
        <li>
          <strong>Don’t have an ODI account?</strong> Create one, then sign in to Moodle.
          <br>
          <a href="https://theodi.org/account/register/" target="_blank" class="btn">Create ODI Account</a>
        </li>
      </ol>
      <h2>Your Courses</h2>
      ${courseList}
      <p><small>If you have trouble accessing your course, email <a href="mailto:training@theodi.org">training@theodi.org</a>.</small></p>
      <p style="margin-top: 16px;">Kind regards,<br/>The ODI Learning Team</p>
  `;
  
  return { subject, bodyHtml };
}

export default {
  buildWelcomeEmail,
  buildReminderEmail
};


