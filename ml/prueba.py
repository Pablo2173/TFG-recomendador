from preview import buscar_preview, descargar
from analizar import analizar

p = buscar_preview('Blinding Lights', 'The Weeknd')
print(p)

descargar(p['preview'], 'prueba.wav')
print(analizar('prueba.wav'))