# User Manual

OLWO (ODI Learning Workflow Orchestrator) helps the Learning team move bookings from HubSpot into delivery: creating projects, scheduling tutors, enrolling learners, and keeping everyone informed.

This manual focuses on how to use OLWO. For installation or technical details, see INSTALLING.md.

## Key concept
- HubSpot is the single source of truth for bookings (deals) and learners (contacts). OLWO reads from HubSpot and, when you submit a booking form in OLWO, writes back to HubSpot as well as creating linked records in Forecast and Calendar where appropriate.

---

## Workflow A: Create a new tutor‑led course booking
Use this when scheduling a tutor‑led course for a client.

1) Complete the booking form
- Open OLWO → Create → Tutored Course Booking.
- Choose the correct pipeline.
- Select the client organisation and the course (tutor‑led only will appear here).
- Set date, start time, duration, and the named tutor. You may include an optional booking reference.
- Provide the main client requestor (name and email). You do not collect learner emails at this stage. If you want named learners attached, add them to the deal later in HubSpot and set their association label to “Learner”.

2) Submit — OLWO orchestrates three actions
- HubSpot: Creates the deal, associates the main contact, adds the selected course as a line item, and marks it as a tutor‑led booking using the relevant learning course fields.
- Forecast: Creates a delivery project and adds the delivery tasks on the selected date.
- Google Calendar: Creates a calendar event for the tutor you selected and sends an invite if enabled.

3) Review the booking
- OLWO shows a bookings list that pulls deals from the selected pipeline, including links to:
  - HubSpot deal (the master record)
  - Forecast project (ID is stored on the deal)
  - Calendar event (ID is also stored on the deal)

4) Make updates in the right place
- Update the HubSpot deal, Forecast project, or Calendar event directly for any changes. As long as the stored IDs do not change, OLWO’s links keep working. If an ID changes, update the HubSpot deal so everything stays in sync.

5) Learner invitations
- For tutor‑led bookings, inviting learners is a manual coordination step with the client. Use your normal platform/process to invite learners.

---

## Workflow B: Create a new self‑paced course booking
Use this when selling access to one or more self‑paced courses.

1) Complete the booking form
- Open OLWO → Create → Self‑Paced Course Booking.
- Pick the pipeline and client. Add a booking reference if you have one.
- Select the primary contact (or create a new one as needed).
- Add one or more self‑paced courses. For each course, enter the total price for the group on this deal. Example: 12 learners × £100 = enter £1200 for that course.
- Add the learners (name + email). All learners on this deal will be enrolled in each selected course. If different learner groups need different courses, create separate bookings.

2) Submit — OLWO creates the deal and prepares automation
- HubSpot: Creates the deal, adds each selected course as a line item, and associates each learner as a contact on the deal.
- Flags: Sets the “Includes self paced courses” property on the deal to signal self‑paced delivery.

3) Automatic communications (via HubSpot workflows)
- If you have a HubSpot workflow configured to watch the “Includes self paced courses” property, HubSpot can call OLWO at `/webhooks/deal-send-reminders` with the deal ID on a schedule you choose (e.g., once on creation, and then reminders every N days).
- OLWO sends the appropriate Welcome/Reminder emails to each learner with instructions for accessing their course(s). Enrollment is already completed in Moodle.
- Emails are logged in HubSpot against the deal and the learner’s contact record. From OLWO’s bookings view, use “View details” to see learner status (enrolled/accessed) and email history.

4) No delivery project/calendar for self‑paced
- OLWO does not create Forecast projects or Calendar events for self‑paced bookings.

---

## How learner enrollment in Moodle works (self‑paced)
Enrollment and account provisioning are automatic once the deal is set and workflows are in place.

- If the learner already has a Moodle account with the same email: OLWO enrolls them into the course(s) immediately for the specified duration.
- If the learner does not have a Moodle account: OLWO creates a placeholder Moodle user with OAuth2 auth (username = their email). No password is set/needed.
- To access Moodle, the learner must: (1) create an ODI website account with the same email (if they don’t already have one), and (2) use “Sign in with ODI Account” on Moodle. This first sign‑in links their ODI identity to the pre‑created Moodle user (“activation”) and they will immediately see their enrolled course(s).
- A verification page still exists for coordinators and learners to view status, but is not required to complete enrollment.
- The verification page shows:
  - Courses included in the booking
  - Whether the learner is enrolled
  - First/last access (if available)
  - Enrollment end date

---

## Managing course data (HubSpot products)
Accurate product data is essential, especially for self‑paced bookings.

- Browse → Courses lets you view course products from HubSpot and create/edit them.
- Key fields to maintain:
  - Course type (tutor‑led vs self‑paced)
  - Price points (e.g., standard, members, Gov Campus) for guidance
  - Moodle course ID (required for self‑paced auto‑enrollment)
  - Default enrollment duration (months) for self‑paced
- Keeping these fields up to date ensures bookings flow correctly and learners are enrolled without manual intervention.

---

## Other useful screens
- Browse → Moodle courses: Look up Moodle course IDs and see who is enrolled and when they last accessed. This view is independent of HubSpot.
- Browse → Projects and Labels (Forecast): General visibility of Forecast projects and labels.
- Create → Course: Add a new HubSpot course product from OLWO.
- Create → Tasks: Bulk import tasks into a Forecast project from a CSV (instructions on the screen).

---

## Integrating with other systems (advanced)
HubSpot remains the central system. If another system creates a deal correctly, OLWO and your HubSpot workflows will handle the rest.

A deal should have:
- The correct course product(s) added as line items
- Learners associated as contacts with label “Learner”
- For self‑paced bookings, the “Includes self paced courses” property set on the deal

When those conditions are met, your HubSpot workflow can trigger OLWO to send instructions and reminders, enroll learners where possible, and expose the learner verification page for self‑service.

---

## Quick reference: learner status link (optional)
You can share this for visibility of status (enrollment/access) or use it as a coordinator/tutor. It is not required for enrollment:

`https://<your-host>/enrollments/verify?deal_id=<HUBSPOT_DEAL_ID>&email=their.email@example.com`
