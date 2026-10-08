import numpy as np
import librosa

MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def extraer(path):
    y, sr = librosa.load(path, duration=30)
    y_arm = librosa.effects.harmonic(y)
    afin = librosa.estimate_tuning(y=y_arm, sr=sr)
    chroma = librosa.feature.chroma_cqt(y=y_arm, sr=sr, tuning=afin).mean(axis=1)
    chroma = chroma / chroma.sum()
    mayor = np.array([np.corrcoef(chroma, np.roll(MAJOR, k))[0, 1] for k in range(12)])
    menor = np.array([np.corrcoef(chroma, np.roll(MINOR, k))[0, 1] for k in range(12)])
    return np.concatenate([chroma, mayor, menor])   # 36 números