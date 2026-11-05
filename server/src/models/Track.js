import mongoose from 'mongoose';

const trackSchema = new mongoose.Schema({
    trackId: { type: String, required: true, unique: true },
    name: String,
    artists: String,
    album: String,
    genres: [String],
    sourceProvider: String,
    matchScore: Number,
    tonalConfidence: Number,
    popularity: Number,
    durationMs: Number,
    explicit: Boolean,
    features: {
        danceability: Number,
        energy: Number,
        key: Number,
        loudness: Number,
        mode: Number,
        speechiness: Number,
        acousticness: Number,
        instrumentalness: Number,
        liveness: Number,
        valence: Number,
        tempo: Number,
        timeSignature: Number,
    },
});

export default mongoose.model('Track', trackSchema);