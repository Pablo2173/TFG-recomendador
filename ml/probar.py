import pandas as pd
from predecir import predecir_tono

usadas = set(pd.read_csv('features.csv')['track_id'])
df = (pd.read_csv('../server/data/tracks.csv')
        .drop_duplicates('track_id').dropna(subset=['track_name', 'artists']))
df = df[~df['track_id'].isin(usadas)].sample(20, random_state=1)

for _, r in df.iterrows():
    res = predecir_tono(r['track_name'], r['artists'].split(';')[0])
    if res:
        print(f"{r['track_name'][:30]:30} real=({r['key']},{r['mode']}) "
              f"est=({res['key']},{res['mode']}) conf={res['confidence']:.2f}")