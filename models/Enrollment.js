import mongoose from 'mongoose';

const enrollmentSchema = new mongoose.Schema({
  user_email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  course_id: {
    type: Number,
    required: true
  },
  course_name: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending_account_creation', 'enrolled', 'failed'],
    default: 'pending_account_creation'
  },
  enrollment_date: {
    type: Date,
    default: Date.now
  },
  expiry_date: {
    type: Date,
    required: true
  },
  secret_token: {
    type: String,
    required: true,
    unique: true
  },
  moodle_user_id: {
    type: Number,
    default: null
  },
  last_moodle_sync: {
    type: Date,
    default: null
  },
  moodle_last_access: {
    type: Date,
    default: null
  },
  hubspot_deal_id: {
    type: String,
    default: null
  },
  retry_count: {
    type: Number,
    default: 0
  },
  last_email_sent: {
    type: Date,
    default: Date.now
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
enrollmentSchema.index({ user_email: 1, course_id: 1 }, { unique: true });
enrollmentSchema.index({ status: 1 });
enrollmentSchema.index({ course_id: 1 });
enrollmentSchema.index({ secret_token: 1 });

// Generate unique secret token
enrollmentSchema.methods.generateSecretToken = function() {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
};

// Check if enrollment is expired
enrollmentSchema.methods.isExpired = function() {
  return new Date() > this.expiry_date;
};

// Get enrollment status with expiry check
enrollmentSchema.methods.getEffectiveStatus = function() {
  if (this.isExpired()) {
    return 'expired';
  }
  return this.status;
};

const Enrollment = mongoose.model('Enrollment', enrollmentSchema);

export default Enrollment;
