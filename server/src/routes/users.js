import bcrypt from 'bcryptjs';
import express from 'express';
import Track from '../models/Track.js';
import User from '../models/User.js';
import { publicUser, requireAuth, signUserToken } from '../middleware/auth.js';

const router = express.Router();
const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://127.0.0.1:5000';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parseOptionalProfile = (body) => {
    const profile = {};
    if (body.favoriteGenres !== undefined) {
        if (!Array.isArray(body.favoriteGenres) ||
            body.favoriteGenres.some((genre) => typeof genre !== 'string' || !genre.trim())) {
            throw new TypeError('favoriteGenres debe ser una lista de textos no vacíos');
        }
        const genres = [...new Set(body.favoriteGenres.map((genre) => genre.trim()))];
        if (genres.length > 0) profile.favoriteGenres = genres;
    }
    if (body.age !== undefined && body.age !== null && body.age !== '') {
        if (!Number.isInteger(body.age) || body.age < 13 || body.age > 120) {
            throw new TypeError('age debe ser un entero entre 13 y 120');
        }
        profile.age = body.age;
    }
    if (body.region !== undefined && body.region !== null && body.region !== '') {
        if (typeof body.region !== 'string' || !body.region.trim()) {
            throw new TypeError('region debe ser un texto no vacío');
        }
        profile.region = body.region.trim();
    }
    return profile;
};

const requireCredentials = (body) => {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!name) throw new TypeError('name debe ser un texto no vacío');
    if (!EMAIL_PATTERN.test(email)) throw new TypeError('email no es válido');
    if (password.length < 8) throw new TypeError('password debe tener al menos 8 caracteres');
    return { name, email, password };
};

router.post('/register', async (req, res) => {
    try {
        const { name, email, password } = requireCredentials(req.body ?? {});
        const profile = parseOptionalProfile(req.body ?? {});
        const passwordHash = await bcrypt.hash(password, 12);
        const user = await User.create({ name, email, passwordHash, ...profile });
        const token = signUserToken(user._id.toString());
        return res.status(201).json({ token, user: publicUser(user) });
    } catch (error) {
        if (error instanceof TypeError) return res.status(400).json({ error: error.message });
        if (error?.code === 11000) return res.status(409).json({ error: 'El email ya está registrado' });
        const message = error instanceof Error ? error.message : '';
        if (message === 'Falta JWT_SECRET en la configuración del servidor') {
            return res.status(500).json({ error: message });
        }
        console.error('Error registrando usuario:', error);
        return res.status(500).json({ error: 'No se pudo registrar el usuario' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const email = typeof req.body?.email === 'string'
            ? req.body.email.trim().toLowerCase()
            : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        if (!EMAIL_PATTERN.test(email) || !password) {
            return res.status(400).json({ error: 'email y password son obligatorios' });
        }
        const user = await User.findOne({ email }).select('+passwordHash');
        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: 'Email o contraseña incorrectos' });
        }
        const token = signUserToken(user._id.toString());
        return res.json({ token, user: publicUser(user) });
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'Falta JWT_SECRET en la configuración del servidor') {
            return res.status(500).json({ error: message });
        }
        console.error('Error iniciando sesión:', error);
        return res.status(500).json({ error: 'No se pudo iniciar sesión' });
    }
});

router.use(requireAuth);

router.get('/me', async (req, res) => {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    return res.json({ user: publicUser(user) });
});

router.get('/me/favorites', async (req, res) => {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const tracks = await Track.find({ trackId: { $in: user.favoriteTrackIds } }).lean();
    const byId = new Map(tracks.map((track) => [track.trackId, track]));
    return res.json({
        favorites: user.favoriteTrackIds.map((trackId) => byId.get(trackId)).filter(Boolean),
    });
});

router.get('/me/recommendations', async (req, res) => {
    try {
        const user = await User.findById(req.userId).lean();
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        const favoriteTracks = await Track.find({
            trackId: { $in: user.favoriteTrackIds ?? [] },
        }).select('genres').lean();
        const favoriteGenres = [
            ...new Set([
                ...(user.favoriteGenres ?? []),
                ...favoriteTracks.flatMap((track) => track.genres ?? []),
            ].map((genre) => genre.trim().toLowerCase()).filter(Boolean)),
        ];
        const limit = 20;
        const recommendations = await Track.aggregate([
            {
                $addFields: {
                    popularityValue: { $ifNull: ['$popularity', 0] },
                    genreMatches: favoriteGenres.length > 0
                        ? {
                            $size: {
                                $setIntersection: [
                                    {
                                        $map: {
                                            input: { $ifNull: ['$genres', []] },
                                            as: 'genre',
                                            in: { $toLower: '$$genre' },
                                        },
                                    },
                                    favoriteGenres,
                                ],
                            },
                        }
                        : 0,
                },
            },
            {
                $addFields: {
                    recommendationScore: {
                        $add: [
                            { $multiply: ['$popularityValue', 0.7] },
                            {
                                $multiply: [
                                    { $min: ['$genreMatches', 1] },
                                    30,
                                ],
                            },
                        ],
                    },
                },
            },
            { $sort: { recommendationScore: -1, popularityValue: -1, name: 1 } },
            { $limit: limit },
            {
                $project: {
                    _id: 0,
                    trackId: 1,
                    name: 1,
                    artists: 1,
                    album: 1,
                    genres: 1,
                    popularity: 1,
                    durationMs: 1,
                    explicit: 1,
                    features: 1,
                    sourceProvider: 1,
                    matchScore: 1,
                    tonalConfidence: 1,
                    recommendationScore: 1,
                },
            },
        ]);
        return res.json({
            recommendations,
            criteria: {
                favoriteGenres,
                popularityWeight: 0.7,
                genreWeight: favoriteGenres.length > 0 ? 0.3 : 0,
                unavailableCriteria: ['age', 'region'],
            },
        });
    } catch (error) {
        console.error('Error generando recomendaciones globales:', error);
        return res.status(500).json({ error: 'No se pudieron cargar las recomendaciones' });
    }
});

router.post('/me/favorites', async (req, res) => {
    try {
        const requestedTrackId = typeof req.body?.trackId === 'string'
            ? req.body.trackId.trim()
            : '';
        if (requestedTrackId) {
            const existingTrack = await Track.findOne({ trackId: requestedTrackId });
            if (!existingTrack) {
                return res.status(404).json({ error: 'Canción no encontrada' });
            }
            const user = await User.findByIdAndUpdate(
                req.userId,
                { $addToSet: { favoriteTrackIds: existingTrack.trackId } },
                { new: true },
            );
            if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
            return res.status(201).json({ track: existingTrack, user: publicUser(user) });
        }

        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const artist = typeof req.body?.artist === 'string' ? req.body.artist.trim() : '';
        if (!name || !artist) {
            return res.status(400).json({ error: 'name y artist son obligatorios' });
        }
        const response = await fetch(`${PYTHON_API_URL}/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, artist }),
        });
        const prediction = await response.json();
        if (!response.ok) return res.status(response.status).json(prediction);

        const trackId = `${name} - ${artist}`.toLowerCase().normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const track = await Track.findOneAndUpdate(
            { trackId },
            {
                $setOnInsert: {
                    trackId,
                    name,
                    artists: artist,
                    genres: [],
                    features: { key: prediction.key, mode: prediction.mode },
                    sourceProvider: prediction.source_provider,
                    matchScore: prediction.match_score,
                    tonalConfidence: prediction.confidence,
                },
            },
            { new: true, upsert: true, setDefaultsOnInsert: true },
        );
        const user = await User.findByIdAndUpdate(
            req.userId,
            { $addToSet: { favoriteTrackIds: track.trackId } },
            { new: true },
        );
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        return res.status(201).json({ track, user: publicUser(user) });
    } catch (error) {
        console.error('Error añadiendo favorita:', error);
        return res.status(502).json({ error: 'No se pudo añadir la canción a favoritos' });
    }
});

router.delete('/me/favorites/:trackId', async (req, res) => {
    if (!req.params.trackId) return res.status(400).json({ error: 'trackId es obligatorio' });
    const user = await User.findByIdAndUpdate(
        req.userId,
        { $pull: { favoriteTrackIds: req.params.trackId } },
        { new: true },
    );
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    return res.json({ user: publicUser(user) });
});

export default router;
