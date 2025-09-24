import mongoose from 'mongoose';

const HubSpotMembershipSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, index: true },
  contact_id: { type: String },
  membership_status: { type: String },
  membership_type: { type: String },
  company_membership_active: { type: Boolean, default: false },
  checkedAt: { type: Date, index: true },
  nextAllowedAt: { type: Date, index: true }
}, { timestamps: true });

export default mongoose.model('HubSpotMembership', HubSpotMembershipSchema);


