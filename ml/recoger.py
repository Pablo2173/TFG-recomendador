import os, csv, time, tempfile
import pandas as pd
from preview import buscar_preview, descargar
from features import extraer

N = 600                      # sube este número cuando quieras más datos
SALIDA = 'features.csv'

df = (pd.read_csv('../server/data/tracks.csv')
        .drop_duplicates('track_id').dropna(subset=['track_name', 'artists'])
        .sample(frac=1, random_state=7).head(N))

nuevo = not os.path.exists(SALIDA)
hechos = set() if nuevo else set(pd.read_csv(SALIDA)['track_id'])
cabecera = ['track_id', 'artista', 'fuente', 'score', 'key', 'mode'] + [f'f{i}' for i in range(36)]

with open(SALIDA, 'a', newline='', encoding='utf-8') as fh:
    w = csv.writer(fh)
    if nuevo:
        w.writerow(cabecera)
    for n, (_, r) in enumerate(df.iterrows(), 1):
        if r['track_id'] in hechos:
            continue
        artista = r['artists'].split(';')[0]
        try:
            p = buscar_preview(r['track_name'], artista)
            if not p:
                continue
            with tempfile.TemporaryDirectory() as d:
                ruta = os.path.join(d, 'p.wav')
                descargar(p['preview'], ruta)
                x = extraer(ruta)
        except Exception as e:
            print('fallo', r['track_id'], e)
            continue
        w.writerow([r['track_id'], artista, p['fuente'], round(p['score'], 3),
                    r['key'], r['mode']] + list(x))
        fh.flush()
        if n % 25 == 0:
            print(f'{n}/{len(df)}')
        time.sleep(0.3)