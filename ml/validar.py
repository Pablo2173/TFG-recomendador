import os, time, tempfile
import pandas as pd
from preview import buscar_preview, descargar
from analizar import analizar

df = (pd.read_csv('../server/data/tracks.csv')
        .drop_duplicates('track_id').dropna(subset=['track_name', 'artists'])
        .sample(200, random_state=42))

filas = []
for _, r in df.iterrows():
    p = buscar_preview(r['track_name'], r['artists'].split(';')[0])
    if not p:
        continue
    with tempfile.TemporaryDirectory() as d:
        ruta = os.path.join(d, 'p.wav')
        descargar(p['preview'], ruta)
        a = analizar(ruta)
    filas.append({'track_id': r['track_id'], 'fuente': p['fuente'], 'score': p['score'],
                  'key_real': r['key'], 'mode_real': r['mode'], 'tempo_real': r['tempo'],
                  'key_est': a['key'], 'mode_est': a['mode'], 'tempo_est': a['tempo'], 'confidence': a['confidence']})
    time.sleep(0.5)

pd.DataFrame(filas).to_csv('resultados.csv', index=False)
print(f'{len(filas)} de 200 canciones analizadas')