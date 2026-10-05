import 'dotenv/config';
import fs from 'fs';
import csv from 'csv-parser';
import mongoose from 'mongoose';
import Track from '../models/Track.js';

await mongoose.connect(process.env.MONGO_URI);

let ops = [];
let total = 0;

const flush = async () => {
    if (ops.length === 0) return;
    await Track.bulkWrite(ops);
    total += ops.length;
    ops = [];
};

const stream = fs.createReadStream('data/tracks.csv').pipe(csv());

for await (const r of stream) {
    ops.push({
        updateOne: {
            filter: { trackId: r.track_id },
            update: {
                $setOnInsert: {
                    name: r.track_name,
                    artists: r.artists,
                    album: r.album_name,
                    popularity: Number(r.popularity),
                    durationMs: Number(r.duration_ms),
                    explicit: r.explicit === 'True',
                    features: {
                        danceability: Number(r.danceability),
                        energy: Number(r.energy),
                        key: Number(r.key),
                        loudness: Number(r.loudness),
                        mode: Number(r.mode),
                        speechiness: Number(r.speechiness),
                        acousticness: Number(r.acousticness),
                        instrumentalness: Number(r.instrumentalness),
                        liveness: Number(r.liveness),
                        valence: Number(r.valence),
                        tempo: Number(r.tempo),
                        timeSignature: Number(r.time_signature),
                    },
                },
                $addToSet: { genres: r.track_genre },
            },
            upsert: true,
        },
    });
    if (ops.length === 1000) await flush();
}

await flush();
console.log(`Procesadas ${total} filas`);
await mongoose.disconnect();