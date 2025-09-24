import mongoose from 'mongoose';

const EnrollmentSchema = new mongoose.Schema({
  moodle_user_id: { type: Number },
  email: { type: String, index: true },
  fullname: { type: String },
  username: { type: String },
  firstaccess: { type: Number },
  lastaccess: { type: Number }
}, { _id: false });

const MoodleCourseEnrollmentsSchema = new mongoose.Schema({
  course_id: { type: Number, required: true, unique: true, index: true },
  course_name: { type: String },
  lastFetchedAt: { type: Date, index: true },
  enrollments: { type: [EnrollmentSchema], default: [] }
}, { timestamps: true });

export default mongoose.model('MoodleCourseEnrollments', MoodleCourseEnrollmentsSchema);


