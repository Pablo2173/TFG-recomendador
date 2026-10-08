import re, difflib, unicodedata, requests
import os, subprocess, tempfile
import imageio_ffmpeg

def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\(.*?\)|\[.*?\]|feat.*| - .*', '', s)
    return re.sub(r'[^a-z0-9 ]', '', s).strip()

def similitud(a, b):
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio()

def deezer(nombre, artista):
    r = requests.get('https://api.deezer.com/search', timeout=10,
                     params={'q': f'{artista} {nombre}', 'limit': 5})
    return [{'titulo': t['title'], 'artista': t['artist']['name'],
             'preview': t.get('preview'), 'fuente': 'deezer'}
            for t in r.json().get('data', [])]

def itunes(nombre, artista):
    r = requests.get('https://itunes.apple.com/search', timeout=10,
                     params={'term': f'{artista} {nombre}', 'entity': 'song', 'limit': 5})
    return [{'titulo': t['trackName'], 'artista': t['artistName'],
             'preview': t.get('previewUrl'), 'genero': t.get('primaryGenreName'),
             'fuente': 'itunes'}
            for t in r.json().get('results', [])]

def buscar_preview(nombre, artista, umbral=0.6):
    for buscar in (deezer, itunes):
        try:
            cands = [c for c in buscar(nombre, artista) if c['preview']]
        except requests.RequestException:
            continue
        if not cands:
            continue
        score, m = max(((similitud(c['titulo'], nombre) * similitud(c['artista'], artista), c)
                        for c in cands), key=lambda x: x[0])
        if score >= umbral:
            return m | {'score': score}
    return None

def descargar(url, destino):
    """Descarga la preview (mp3 o m4a) y la guarda como WAV en 'destino'."""
    with tempfile.TemporaryDirectory() as d:
        origen = os.path.join(d, 'preview.m4a' if '.m4a' in url else 'preview.mp3')
        resp = requests.get(url, timeout=20)
        resp.raise_for_status()
        with open(origen, 'wb') as f:
            f.write(resp.content)
        res = subprocess.run(
            [imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-i', origen,
             '-ac', '1', '-ar', '22050', destino],
            capture_output=True, text=True)
        if res.returncode != 0:
            raise RuntimeError(f'ffmpeg falló:\n{res.stderr[-800:]}')