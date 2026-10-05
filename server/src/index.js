import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 4000;
await mongoose.connect(process.env.MONGO_URI);
app.listen(PORT, () => console.log(`API en http://localhost:${PORT}`));