import numpy as np
import pandas as pd
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import GroupKFold
from metricas import tipo_key, CERCANOS

df = pd.read_csv('features.csv')
df = df[df['score'] >= 0.9].reset_index(drop=True)     # descarta emparejamientos dudosos
cols = [f'f{i}' for i in range(36)]
X = df[cols].to_numpy()
y = (df['key'] + 12 * df['mode']).to_numpy()           # clase 0..23 (12-23 = mayor)
grupos = df['artista']


def transponer(X, t):
    return np.hstack([np.roll(X[:, b:b + 12], t, axis=1) for b in (0, 12, 24)])


def aumentar(X, y):
    Xs, ys = [], []
    for t in range(12):
        Xs.append(transponer(X, t))
        ys.append((y % 12 + t) % 12 + 12 * (y // 12))
    return np.vstack(Xs), np.concatenate(ys)


def plantilla(X):
    i = X[:, 12:36].argmax(axis=1)                     # método anterior
    return np.where(i < 12, i + 12, i - 12)


def informe(nombre, pred, conf=None):
    f = pd.DataFrame({'key_real': df['key'], 'mode_real': df['mode'],
                      'key_est': pred % 12, 'mode_est': pred // 12})
    tipos = f.apply(tipo_key, axis=1)
    print(nombre)
    print(tipos.value_counts(normalize=True).round(3))
    if conf is not None:
        tramo = pd.qcut(conf, 3, labels=['baja', 'media', 'alta'])
        print(tipos.isin(CERCANOS).groupby(tramo, observed=True).mean().round(3))
    print()


oof = np.zeros(len(df), dtype=int)
conf = np.zeros(len(df))
for ent, test in GroupKFold(n_splits=5).split(X, y, grupos):
    Xa, ya = aumentar(X[ent], y[ent])
    rf = RandomForestClassifier(n_estimators=300, n_jobs=-1, random_state=42)
    rf.fit(Xa, ya)
    prob = rf.predict_proba(X[test])
    oof[test] = rf.classes_[prob.argmax(axis=1)]
    conf[test] = prob.max(axis=1)

print('Canciones usadas:', len(df), '\n')
informe('Plantillas (método anterior)', plantilla(X))
informe('Random forest', oof, conf)

print('Cortes de confianza (tercios):', np.quantile(conf, [1/3, 2/3]).round(3))

from scipy.stats import binomtest
rf_ok, pl_ok = (oof == y), (plantilla(X) == y)
b, c = int((rf_ok & ~pl_ok).sum()), int((~rf_ok & pl_ok).sum())
print('RF acierta y plantillas no:', b, '| plantillas aciertan y RF no:', c,
      '| p =', round(binomtest(b, b + c).pvalue, 4))

Xa, ya = aumentar(X, y)
final = RandomForestClassifier(n_estimators=300, n_jobs=-1, random_state=42).fit(Xa, ya)
joblib.dump(final, 'modelo_tono.joblib')
print('Modelo guardado en modelo_tono.joblib')