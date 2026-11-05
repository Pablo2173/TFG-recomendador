import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        passwordHash: { type: String, required: true, select: false },
        favoriteGenres: { type: [String], default: undefined },
        age: { type: Number, min: 13, max: 120 },
        region: { type: String, trim: true },
        favoriteTrackIds: { type: [String], default: [] },
    },
    { timestamps: true },
);

export default mongoose.model('User', userSchema);
