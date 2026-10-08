def tipo_key(f):
    if f.key_est == f.key_real and f.mode_est == f.mode_real:
        return 'exacto'
    relativo = (f.key_real + (9 if f.mode_real == 1 else 3)) % 12
    if f.mode_est != f.mode_real and f.key_est == relativo:
        return 'relativo'
    if f.mode_est == f.mode_real and (f.key_est - f.key_real) % 12 in (5, 7):
        return 'quinta'
    if f.key_est == f.key_real:
        return 'paralelo'
    return 'otro'

CERCANOS = ['exacto', 'relativo', 'quinta', 'paralelo']