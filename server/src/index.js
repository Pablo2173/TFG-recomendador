import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import Track from './models/Track.js';
import usersRouter from './routes/users.js';
import { findPreview } from './services/previewService.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/users', usersRouter);

app.get('/api/tracks/:trackId', async (req, res) => {
    try {
        const track = await Track.findOne({ trackId: req.params.trackId }).lean();
        if (!track) return res.status(404).json({ error: 'Canción no encontrada' });
        return res.json({ track });
    } catch (error) {
        console.error('Error consultando canción:', error);
        return res.status(500).json({ error: 'No se pudo consultar la canción' });
    }
});

app.get('/api/tracks/:trackId/preview', async (req, res) => {
    try {
        const track = await Track.findOne({ trackId: req.params.trackId })
            .select('name artists')
            .lean();
        if (!track) return res.status(404).json({ error: 'Canción no encontrada' });

        const preview = await findPreview(track.name, track.artists);
        if (!preview) {
            return res.status(404).json({ error: 'No hay una preview disponible para esta canción' });
        }
        return res.json(preview);
    } catch (error) {
        console.error('Error buscando preview:', error);
        return res.status(502).json({ error: 'No se pudo obtener la preview' });
    }
});

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://127.0.0.1:5000';
const PYTHON_REQUEST_TIMEOUT_MS = 120000;

const wait = (milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
});

const warmUpPythonApi = async () => {
    const response = await fetch(`${PYTHON_API_URL}/health`, {
        signal: AbortSignal.timeout(PYTHON_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(`La API tonal respondió HTTP ${response.status} en /health`);
    }
};

const requestPrediction = async (payload) => {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            await warmUpPythonApi();
            const response = await fetch(`${PYTHON_API_URL}/predict`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(PYTHON_REQUEST_TIMEOUT_MS),
            });
            const text = await response.text();
            let parsed = {};
            try {
                parsed = text ? JSON.parse(text) : {};
            } catch {
                throw new Error('La API tonal devolvió una respuesta no válida');
            }
            if (response.ok || ![502, 503, 504].includes(response.status)) {
                return { response, parsed };
            }
            lastError = new Error(`La API tonal respondió HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        if (attempt < 3) await wait(attempt * 5000);
    }
    throw lastError;
};

app.post('/api/recommendations', async (req, res) => {
    let predictionBody;
    try {
        const { name, artist, trackId, limit = 20 } = req.body ?? {};
        if (typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'name debe ser un texto no vacío' });
        }
        if (typeof artist !== 'string' || !artist.trim()) {
            return res.status(400).json({ error: 'artist debe ser un texto no vacío' });
        }
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            return res.status(400).json({ error: 'limit debe ser un entero entre 1 y 100' });
        }

        try {
            const { response: predictionResponse, parsed: parsedPrediction } =
                await requestPrediction({ name: name.trim(), artist: artist.trim() });
            if (!predictionResponse.ok) {
                return res.status(predictionResponse.status).json(parsedPrediction);
            }
            predictionBody = parsedPrediction;
        } catch (error) {
            console.error('Error conectando con la API tonal:', error);
            return res.status(503).json({
                error: 'La API Python del recomendador armónico no está disponible. Iníciala antes de solicitar recomendaciones.',
            });
        }

        const key = predictionBody.key;
        const mode = predictionBody.mode;
        const compatibleKeys = [
            key,
            (key + 5) % 12,
            (key + 7) % 12,
            (key + (mode ? 9 : 3)) % 12,
        ];
        const tracks = await Track.find({
            ...(typeof trackId === 'string' && trackId.trim()
                ? { trackId: { $ne: trackId.trim() } }
                : {}),
            $or: [
                { 'features.mode': mode, 'features.key': { $in: compatibleKeys.slice(0, 3) } },
                { 'features.mode': mode ? 0 : 1, 'features.key': compatibleKeys[3] },
            ],
        }).lean();

        const recommendations = tracks.map((track) => {
            const trackKey = track.features.key;
            const trackMode = track.features.mode;
            const sameKey = trackKey === key;
            const sameMode = trackMode === mode;
            const harmonicRelation = sameMode
                ? [0, 5, 7].includes((trackKey - key + 12) % 12)
                : trackKey === (key + (mode ? 9 : 3)) % 12;
            const fiabilidad = Math.round(
                ((sameKey ? 0.45 : 0) +
                    (sameMode ? 0.25 : 0) +
                    (harmonicRelation ? 0.30 : 0)) *
                    10000,
            ) / 100;
            return {
                trackId: track.trackId,
                name: track.name,
                artists: track.artists,
                album: track.album,
                genres: track.genres,
                key: trackKey,
                mode: trackMode,
                harmonic_score: fiabilidad / 100,
                fiabilidad,
            };
        }).sort((a, b) => b.fiabilidad - a.fiabilidad).slice(0, limit);

        return res.json({
            input: { name: name.trim(), artist: artist.trim() },
            prediction: predictionBody,
            recommendations,
        });
    } catch (error) {
        console.error('Error en /api/recommendations:', error);
        return res.status(502).json({ error: 'No se pudo completar la recomendación' });
    }
});

app.use((error, req, res, next) => {
    console.error('Error no controlado en la API:', error);
    if (res.headersSent) return next(error);
    return res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = process.env.PORT || 4000;
if (!process.env.MONGO_URI) {
    throw new Error('Falta MONGO_URI en la configuración del servidor');
}
await mongoose.connect(process.env.MONGO_URI);
app.listen(PORT, () => console.log(`API en http://localhost:${PORT}`));