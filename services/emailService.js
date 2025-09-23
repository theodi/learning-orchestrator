import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';
import { google } from 'googleapis';

export class EmailService {
  constructor() {
    const fromEmail = process.env.EMAIL_FROM || 'training@theodi.org';
    const fromName = process.env.EMAIL_FROM_NAME || 'ODI Learning';
    this.fromAddress = `${fromName} <${fromEmail}>`;

    // Support either OAuth2 (recommended) or app password/SMTP
    const useServiceAccount = String(process.env.EMAIL_USE_SERVICE_ACCOUNT || 'false').toLowerCase() === 'true';
    const useOAuth2 = !useServiceAccount && String(process.env.EMAIL_USE_OAUTH2 || 'true').toLowerCase() === 'true';

    if (useServiceAccount) {
      // Domain-wide delegation: use service account to impersonate EMAIL_USER and mint access tokens
      this.mode = 'service_account';
      this.jwtAuth = new google.auth.JWT(
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        null,
        (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        ['https://mail.google.com/'],
        process.env.EMAIL_USER
      );
      this.debugLogConfig('service_account');
      // Reuse a transporter without fixed auth; we'll pass per-message auth with accessToken
      this.transporter = nodemailer.createTransport({ service: 'gmail' });
    } else if (useOAuth2) {
      this.debugLogConfig('oauth2');
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user: process.env.EMAIL_USER,
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          refreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
          accessToken: process.env.GOOGLE_OAUTH_ACCESS_TOKEN || undefined,
        },
      });
    } else {
      this.debugLogConfig('smtp');
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
        auth: process.env.SMTP_USER && process.env.SMTP_PASS ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        } : undefined,
      });
    }
  }

  debugLogConfig(mode) {
    try {
      const masked = (v) => (v ? `${String(v).slice(0, 4)}…${String(v).slice(-4)}` : '');
      const summary = {
        mode,
        from: this.fromAddress,
        user: process.env.EMAIL_USER || '',
        clientId_set: !!process.env.GOOGLE_CLIENT_ID,
        clientSecret_set: !!process.env.GOOGLE_CLIENT_SECRET,
        refreshToken_set: !!process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
        accessToken_set: !!process.env.GOOGLE_OAUTH_ACCESS_TOKEN,
        smtpHost: process.env.SMTP_HOST || '',
        smtpUser_set: !!process.env.SMTP_USER,
        smtpSecure: process.env.SMTP_SECURE,
      };
      // Only log minimal info
      //console.info('[EmailService] Config summary', summary);
    } catch (_) {}
  }

  // Basic site-themed wrapper around provided HTML body
  buildHtml({ title, bodyHtml }) {
    const logoUrl = 'https://training.theodi.org/odi-logo.png';
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title || ' Learning'}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background:#f5f7fb; margin:0; padding:20px; color:#000; }
    .container { max-width: 640px; margin: 0 auto; background:#ffffff; overflow:hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
    .header { background:#072589; color:#fff; padding:16px 20px; display:flex; align-items:center; }
    .header img { height:32px; max-height:32px; width:auto; margin-right:10px; display:inline-block; }
    .content { padding:24px 20px; color:#000; }
    .content a { color:#000; }
    .btn { display:inline-block; background:#072589; color:#fff !important; text-decoration:none; padding:10px 16px; }
    .muted { color:#6a737d; font-size:12px; }
    h1 { font-size:20px; margin:0 0 12px; }
    h2 { font-size:16px; margin:20px 0 8px; }
    ul { padding-left:18px; }
  </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <img src="${logoUrl}" alt="ODI" height="32" style="height:32px;max-height:32px;width:auto;display:inline-block;" />
      </div>
      <div class="content">
        ${bodyHtml}
      </div>
    </div>
  </body>
</html>`;
  }

  async sendHtmlEmail({ to, subject, html }) {
    try {
      let mailOptions = { from: this.fromAddress, to, subject, html };

      // For service account mode, mint an access token per send and include per-message auth
      if (this.mode === 'service_account' && this.jwtAuth) {
        const { token } = await this.jwtAuth.getAccessToken();
        mailOptions.auth = {
          type: 'OAuth2',
          user: process.env.EMAIL_USER,
          accessToken: token,
        };
      }

      const info = await this.transporter.sendMail(mailOptions);
      return info;
    } catch (err) {
      console.error('[EmailService] sendHtmlEmail failed', {
        message: err?.message,
        code: err?.code,
        response: err?.response,
        stack: err?.stack,
      });
      throw err;
    }
  }
}

export default EmailService;


