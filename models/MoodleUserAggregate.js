import mongoose from 'mongoose';

const UserCourseSchema = new mongoose.Schema({
  id: { type: Number },
  fullname: { type: String },
  accessed: { type: Boolean }
}, { _id: false });

const MoodleUserAggregateSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true }, // email or moodle:{id}
  email: { type: String, index: true, sparse: true },
  moodle_user_id: { type: Number, index: true, sparse: true },
  fullname: { type: String },
  username: { type: String },
  firstaccess: { type: Number },
  lastaccess: { type: Number },
  courses: { type: [UserCourseSchema], default: [] },
  aggregatedAt: { type: Date, index: true }
}, { timestamps: true });

export default mongoose.model('MoodleUserAggregate', MoodleUserAggregateSchema);


