import numpy as np
import librosa

MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def analizar(path):
    y, sr = librosa.load(path, duration=30)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    y_arm = librosa.effects.harmonic(y)
    afin = librosa.estimate_tuning(y=y_arm, sr=sr)
    chroma = librosa.feature.chroma_cqt(y=y_arm, sr=sr, tuning=afin).mean(axis=1)

    best = (-2, 0, 1)
    for mode, perfil in ((1, MAJOR), (0, MINOR)):
        for k in range(12):
            r = np.corrcoef(chroma, np.roll(perfil, k))[0, 1]
            if r > best[0]:
                best = (r, k, mode)

    return {
        'tempo': float(np.atleast_1d(tempo)[0]),
        'key': best[1],       # 0 = Do, igual que tu dataset
        'mode': best[2],      # 1 = mayor, 0 = menor
        'confidence': float(best[0]),
    }