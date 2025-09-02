import mongoose from 'mongoose';
import courseBookingSchema from './CourseBookingSchema.js';

// Create the Mongoose model from the schema
const CourseBooking = mongoose.model('CourseBooking', courseBookingSchema);

export default CourseBooking;
