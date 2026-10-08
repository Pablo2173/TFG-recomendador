import pandas as pd

r = pd.read_csv('resultados.csv')

def tipo_key(f):
    if f.key_est == f.key_real and f.mode_est == f.mode_real:
        return 'exacto'
    relativo = (f.key_real + (9 if f.mode_real == 1 else 3)) % 12
    if f.mode_est != f.mode_real and f.key_est == relativo:
        return 'relativo'
    if f.mode_est == f.mode_real and (f.key_est - f.key_real) % 12 in (5, 7):
        return 'quinta'
    if f.key_est == f.key_real and f.mode_est != f.mode_real:
        return 'paralelo'
    return 'otro'

def tipo_tempo(x):
    if abs(x - 1) < 0.04: return 'correcto'
    if abs(x - 2) < 0.08: return 'doble'
    if abs(x - 0.5) < 0.02: return 'mitad'
    return 'otro'

print('Canciones analizadas:', len(r))
print(r.apply(tipo_key, axis=1).value_counts(normalize=True))
print((r.tempo_est / r.tempo_real).apply(tipo_tempo).value_counts(normalize=True))

r['tipo'] = r.apply(tipo_key, axis=1)
r['cercano'] = r.tipo.isin(['exacto', 'relativo', 'quinta', 'paralelo'])
r['tramo'] = pd.qcut(r.confidence, 3, labels=['baja', 'media', 'alta'])
print(r.groupby('tramo', observed=True).cercano.mean())