import os, tempfile, joblib
from preview import buscar_preview, descargar
from features import extraer

CORTE_MEDIA = 0.0   # sustituir por el primer valor impreso por entrenar.py
CORTE_ALTA = 0.0    # sustituir por el segundo valor

modelo = joblib.load('modelo_tono.joblib')


def predecir_tono(nombre, artista):
    p = buscar_preview(nombre, artista)
    if not p:
        return None
    with tempfile.TemporaryDirectory() as d:
        ruta = os.path.join(d, 'p.wav')
        descargar(p['preview'], ruta)
        x = extraer(ruta).reshape(1, -1)
    prob = modelo.predict_proba(x)[0]
    clase = int(modelo.classes_[prob.argmax()])
    conf = float(prob.max())
    nivel = 'alta' if conf >= CORTE_ALTA else 'media' if conf >= CORTE_MEDIA else 'baja'
    return {'key': clase % 12, 'mode': clase // 12, 'confidence': conf, 'nivel': nivel,
            'source': 'audio', 'fuente': p['fuente'], 'genero': p.get('genero')}


if __name__ == '__main__':
    print(predecir_tono('Blinding Lights', 'The Weeknd'))