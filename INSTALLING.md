# Installing and Configuring OLWO

This document covers technical setup for the ODI Learning Workflow Orchestrator (OLWO).

## Quick start
```bash
cp config.env.example .env
npm install
npm run start
```
Open http://localhost:3080 and sign in with Google once configured.

## Environment configuration (.env)
See `config.env.example`. Keys are grouped below by integration.

### Core app
- PORT: default 3080
- SECUREPORT: 3443 (if you terminate TLS here)
- HOST: e.g. http://localhost:{PORT}
- SESSION_SECRET: random secure string
- MONGODB_URI: local dev MongoDB
- MONGODB_URI_PROD: production MongoDB

### Google OAuth (login)
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_CALLBACK_URL: e.g. /auth/google/callback

Scopes required: profile, email.

### Google Calendar (service account)
- GOOGLE_CALENDAR_ID: primary or specific calendar ID
- GOOGLE_SERVICE_ACCOUNT_EMAIL: service account email
- GOOGLE_PRIVATE_KEY: private key (escape newlines as \n)
- GOOGLE_CALENDAR_IMPERSONATE_USER: user to impersonate (domain-wide delegation)
- GOOGLE_CALENDAR_SEND_INVITATIONS: true|false

Required API/scopes on the service account:
- Enable Google Calendar API.
- Domain-wide delegation with scopes:
  - https://www.googleapis.com/auth/calendar
  - https://www.googleapis.com/auth/calendar.events

### Forecast
- FORECAST_API_KEY

Permissions: Private API key with access to labels (v1), projects (v1), persons (v2), tasks (v3).

### HubSpot
- HUBSPOT_API_KEY: Private App Access Token (Bearer)
- HUBSPOT_PORTAL_ID: numeric portal ID
- HUBSPOT_DEFAULT_PIPELINE_ID: default deals pipeline id
- HUBSPOT_WEBHOOK: optional Zapier/webhook URL for outbound sendToZapier()
- HUBSPOT_WEBHOOK_SECRET: secret used to verify inbound signatures (if you enable webhook signature validation)
- WEBHOOK_API_KEY: shared secret for certain inbound webhook endpoints

Recommended Private App scopes (minimum for current features):
- crm.objects.contacts.read, crm.objects.contacts.write
- crm.objects.companies.read, crm.objects.companies.write
- crm.objects.deals.read, crm.objects.deals.write
- crm.objects.line_items.read, crm.objects.line_items.write
- crm.objects.products.read, crm.objects.products.write
- crm.schemas.custom.read (if using custom properties)
- crm.objects.owners.read
- crm.objects.associations.read, crm.objects.associations.write

Webhooks (optional):
- Configure HubSpot workflows to post to this app’s `/webhooks/*` endpoints and include header/body signature if you plan to verify with `HUBSPOT_WEBHOOK_SECRET`.

### Moodle
- MOODLE_ROOT: base site URL for links (e.g., https://moodle.example.org)
- MOODLE_URI: REST server endpoint, e.g., https://moodle.example.org/webservice/rest/server.php
- MOODLE_TOKEN: token with permissions for:
  - core_course_get_courses
  - core_user_get_users_by_field
  - core_enrol_get_enrolled_users
  - enrol_manual_enrol_users

### Email
- EMAIL_FROM: e.g. training@theodi.org
- EMAIL_FROM_NAME: e.g. ODI Learning
- EMAIL_USER: user to send-as/login as
- EMAIL_USE_OAUTH2: true|false (prefer true)
- EMAIL_USE_SERVICE_ACCOUNT: true|false (mutually exclusive with OAuth2)
- GOOGLE_OAUTH_REFRESH_TOKEN: for Gmail OAuth2
- GOOGLE_OAUTH_ACCESS_TOKEN: optional cached token

SMTP alternative:
- SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (false|true)
- SMTP_USER, SMTP_PASS

## Routes overview (for integrators)
Most GET routes support content negotiation (HTML shell vs JSON). The only public learner-facing route is:
- GET `/enrollments/verify?deal_id=HS_DEAL_ID&email=user@example.com` (HTML/JSON)
- GET `/enrollments/status?course_id=123&email=user@example.com` (JSON; requires `WEBHOOK_API_KEY`)

Internal/admin routes used by the UI include:
- HubSpot: `/hubspot/*` (courses, products, deals, contacts, companies)
- Forecast: `/forecast/*` (projects, persons, tasks CRUD, schemas)
- Moodle: `/moodle/courses`
- Enrollments (ops): `/enrollments`, `/enrollments/new`, `/enrollments/all`, `/enrollments/course/:courseId`
- Webhooks: `/webhooks/form`, `/webhooks/deal-learner-status`, `/webhooks/deal-send-reminders`
- Calendar: `/calendar/test`, `/calendar/events/training`, `/calendar/events/:id`

## External setup checklists

### Google OAuth (login)
1. Create OAuth 2.0 Client ID (Web application) in Google Cloud.
2. Authorized redirect URI: `https://<host>/auth/google/callback` (or `http://localhost:3080/auth/google/callback`).
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`.

### Google Calendar (service account)
1. Create a service account, enable Calendar API.
2. Generate key; set `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (escape newlines).
3. If using Workspace, enable domain-wide delegation and add scopes:
   - https://www.googleapis.com/auth/calendar
   - https://www.googleapis.com/auth/calendar.events
4. Set `GOOGLE_CALENDAR_IMPERSONATE_USER` to a calendar owner account.
5. Share the target calendar with the impersonated user or service account as needed.

### HubSpot Private App
1. Create a Private App → copy Access Token to `HUBSPOT_API_KEY`.
2. Scopes: see list above. Ensure products, line items, deals, contacts, companies, owners, associations.
3. Note your `HUBSPOT_PORTAL_ID` and set `HUBSPOT_DEFAULT_PIPELINE_ID`.
4. Optional: configure HubSpot workflows/webhooks to call this app’s `/webhooks/*` endpoints. If verifying, set `HUBSPOT_WEBHOOK_SECRET`.

### Moodle Web Services
1. Create a dedicated user and token with capabilities to call the listed functions.
2. Set `MOODLE_URI`, `MOODLE_ROOT`, `MOODLE_TOKEN`.

### Forecast API
1. Generate Forecast API key and set `FORECAST_API_KEY`.
2. Ensure access to Labels v1, Projects v1, Persons v2, Tasks v3.

### Email
Preferred: Gmail OAuth2 send-as `EMAIL_USER`.
1. Ensure `EMAIL_FROM`, `EMAIL_FROM_NAME`, `EMAIL_USER`.
2. Set `EMAIL_USE_OAUTH2=true`, and configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` (and optional `GOOGLE_OAUTH_ACCESS_TOKEN`).
3. Alternative: SMTP with `SMTP_*` settings and `EMAIL_USE_OAUTH2=false`.

## Development notes
- Tech: Node 20+, Express, EJS views for shells, client-side AJAX via jQuery + DataTables.
- Content negotiation: Most GETs serve HTML or JSON based on Accept header; UI renders data client-side.
- Auth: `express-session` with `SESSION_SECRET`; Google OAuth for login.
- Method override: enabled for PUT/DELETE forms.

## Testing
```bash
npm run test:config
npm run test:projects
npm run test:email-lookup
npm run test:restful-api
npm run test:run
```

## Security
- Store secrets only in `.env` (never commit).
- Use least-privilege scopes on HubSpot and Google.
- Set `WEBHOOK_API_KEY` and validate inbound webhook calls.
- If exposing publicly, run behind HTTPS and set secure cookies in production.
