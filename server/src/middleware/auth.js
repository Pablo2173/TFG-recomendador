import jwt from 'jsonwebtoken';

const getJwtSecret = () => {
    if (!process.env.JWT_SECRET) {
        throw new Error('Falta JWT_SECRET en la configuración del servidor');
    }
    return process.env.JWT_SECRET;
};

export const signUserToken = (userId) => jwt.sign(
    { sub: userId },
    getJwtSecret(),
    { expiresIn: '24h' },
);

export const requireAuth = (req, res, next) => {
    const header = req.get('Authorization');
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Se requiere un token Bearer' });
    }

    try {
        const payload = jwt.verify(header.slice(7), getJwtSecret());
        if (typeof payload !== 'object' || typeof payload.sub !== 'string') {
            return res.status(401).json({ error: 'Token no válido' });
        }
        req.userId = payload.sub;
        return next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
            return res.status(401).json({ error: 'Token no válido o caducado' });
        }
        console.error('Error verificando autenticación:', error);
        return res.status(500).json({ error: 'No se pudo verificar la autenticación' });
    }
};

export const publicUser = (user) => ({
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    ...(user.favoriteGenres ? { favoriteGenres: user.favoriteGenres } : {}),
    ...(user.age !== undefined ? { age: user.age } : {}),
    ...(user.region ? { region: user.region } : {}),
    favoriteTrackIds: user.favoriteTrackIds,
});
