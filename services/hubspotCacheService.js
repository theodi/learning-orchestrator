import HubSpotMembership from '../models/HubSpotMembership.js';
import HubSpotService from './hubspotService.js';

export class HubSpotCacheService {
  constructor() {
    this.hubspot = new HubSpotService();
  }

  async refreshMemberships(emails = [], { concurrency = 4 } = {}) {
    const list = Array.from(new Set((emails || []).map(e => String(e || '').toLowerCase()).filter(Boolean)));
    for (let i = 0; i < list.length; i += concurrency) {
      const batch = list.slice(i, i + concurrency);
      const infos = await Promise.all(batch.map(email => this.hubspot.getContactMembershipByEmail(email).catch(() => null)));
      const ops = [];
      batch.forEach((email, idx) => {
        const info = infos[idx];
        if (!info) return;
        ops.push({
          updateOne: {
            filter: { email },
            update: {
              $set: {
                contact_id: info.contact_id || null,
                membership_status: info.membership_status || null,
                membership_type: info.membership_type || null,
                company_membership_active: Boolean(info.company_membership_active || false),
                checkedAt: new Date()
              }
            },
            upsert: true
          }
        });
      });
      if (ops.length > 0) await HubSpotMembership.bulkWrite(ops, { ordered: false });
    }
  }
}

export default HubSpotCacheService;


