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

export function buildWelcomeEmail({ moodleRootUrl, courses, verifyUrl, anyEnrolled, learnerName }) {
  const courseList = buildCourseListHtml(courses);
  
  let subject, bodyHtml;
  
  if (anyEnrolled) {
    subject = 'Welcome! Your ODI course is ready to access';
    bodyHtml = `
        <h1>Welcome to Your ODI Course!</h1>
        <p>Dear ${learnerName || 'Learner'},</p>
        <p>You are receiving this email as you have (or have been by someone else) signed up to the course(s) listed below.</p>
        <p><strong>As you already have an account in our system, this course is now accessible at the link below.</strong></p>
        <p>
          <a class="btn" href="${moodleRootUrl}/login/index.php" target="_blank">Go to Moodle</a>
        </p>
        <h2>Your Courses</h2>
        ${courseList}
        <p><small>Use the "Sign in with ODI Account" option. If you have trouble signing in or accessing your course, email <a href="mailto:training@theodi.org">training@theodi.org</a>.</small></p>
        <p style="margin-top: 16px;">Kind regards,<br/>The ODI Learning Team</p>
    `;
  } else {
    subject = 'Welcome! Complete your ODI course enrollment';
    bodyHtml = `
        <h1>Welcome to Your ODI Course!</h1>
        <p>Dear ${learnerName || 'Learner'},</p>
        <p>You are receiving this email as you have (or have been by someone else) signed up to the course(s) listed below.</p>
        <p><strong>To access the course you first need to create an account.</strong></p>
        <ol>
          <li>
            <strong>Create an ODI Account</strong> (if you haven't already)
            <br>
            <a href="https://theodi.org/account/register/" target="_blank" class="btn">Create ODI Account</a>
          </li>
          <li>
                <strong>Login to Moodle</strong> using your ODI account
                <br>  
                <a href="${moodleRootUrl}/login/index.php" target="_blank" class="btn">
                  Go to Moodle
                </a>
                <br>
                <small class="text-muted">Use the "Sign in with ODI Account" option.</small>
              </li>
          <li>
            <strong>Complete your enrollment</strong> by visiting the verification page
            <br>
            <a href="${verifyUrl}" target="_blank" class="btn">Complete Enrollment</a>
          </li>
        </ol>
        <h2>Your Courses</h2>
        ${courseList}
        <p><small>If you have trouble completing your enrollment, email <a href="mailto:training@theodi.org">training@theodi.org</a>.</small></p>
        <p style="margin-top: 16px;">Kind regards,<br/>The ODI Learning Team</p>
    `;
  }
  
  return { subject, bodyHtml };
}

export function buildReminderEmail({ moodleRootUrl, courses, verifyUrl, anyEnrolled, learnerName }) {
  const courseList = buildCourseListHtml(courses);
  
  let subject, bodyHtml;
  
  if (anyEnrolled) {
    subject = 'Reminder: Access your ODI course(s)';
    bodyHtml = `
        <h1>Reminder: Access Your Course</h1>
        <p>Dear ${learnerName || 'Learner'},</p>
        <p>This is a reminder that you're enrolled but haven't accessed one or more courses. Please log in and get started:</p>
        <p>
          <a class="btn" href="${moodleRootUrl}/login/index.php" target="_blank">Go to Moodle</a>
        </p>
        <h2>Your Courses</h2>
        ${courseList}
        <p><small>Use the "Sign in with ODI Account" option. If you have trouble signing in or accessing your course, email <a href="mailto:training@theodi.org">training@theodi.org</a>.</small></p>
        <p style="margin-top: 16px;">Kind regards,<br/>The ODI Learning Team</p>
    `;
  } else {
    subject = 'Reminder: Complete your ODI course enrollment';
    bodyHtml = `
        <h1>Reminder: Complete Your Course Enrollment</h1>
        <p>Dear ${learnerName || 'Learner'},</p>
        <p>This is a reminder that you have courses waiting but are not yet enrolled. Please follow these steps:</p>
        <ol>
          <li>
            <strong>Create an ODI Account</strong> (if you haven't already)
            <br>
            <a href="https://theodi.org/account/register/" target="_blank" class="btn">Create ODI Account</a>
          </li>
          <li>
            <strong>Login to Moodle</strong> using your ODI account
            <br>  
            <a href="${moodleRootUrl}/login/index.php" target="_blank" class="btn">
              Go to Moodle
            </a>
            <br>
            <small class="text-muted">Use the "Sign in with ODI Account" option.</small>
          </li>
          <li>
            <strong>Complete your enrollment</strong> by visiting the verification page
            <br>
            <a href="${verifyUrl}" target="_blank" class="btn">Complete Enrollment</a>
          </li>
        </ol>
        <h2>Your Courses</h2>
        ${courseList}
        <p><small>If you have trouble completing your enrollment, email <a href="mailto:training@theodi.org">training@theodi.org</a>.</small></p>
        <p style="margin-top: 16px;">Kind regards,<br/>The ODI Learning Team</p>
    `;
  }
  
  return { subject, bodyHtml };
}

export default {
  buildWelcomeEmail,
  buildReminderEmail
};


