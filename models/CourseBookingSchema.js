import mongoose from 'mongoose';

const courseBookingSchema = new mongoose.Schema({
  // Only store the essential integration references
  hubspot_deal_id: {
    type: String,
    default: null,
    trim: true
  },
  forecast_project_id: {
    type: String,
    default: null,
    trim: true
  },
  google_calendar_event_id: {
    type: String,
    default: null,
    trim: true
  },
  
  // Integration URLs for direct access
  hubspot_deal_url: {
    type: String,
    default: '',
    trim: true
  },
  forecast_project_url: {
    type: String,
    default: '',
    trim: true
  },
  google_calendar_url: {
    type: String,
    default: '',
    trim: true
  },
  
  // Timestamps
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'course_bookings'
});

// Indexes for better query performance
courseBookingSchema.index({ created_at: -1 });
courseBookingSchema.index({ hubspot_deal_id: 1 });
courseBookingSchema.index({ forecast_project_id: 1 });

// Pre-save middleware to update the updated_at field
courseBookingSchema.pre('save', function(next) {
  this.updated_at = new Date();
  next();
});

// Instance method to update integration details
courseBookingSchema.methods.updateIntegration = function(type, id, url) {
  switch (type) {
    case 'hubspot':
      this.hubspot_deal_id = id;
      this.hubspot_deal_url = url;
      break;
    case 'forecast':
      this.forecast_project_id = id;
      this.forecast_project_url = url;
      break;
    case 'calendar':
      this.google_calendar_event_id = id;
      this.google_calendar_url = url;
      break;
  }
  this.updated_at = new Date();
  return this.save();
};


export default courseBookingSchema;
