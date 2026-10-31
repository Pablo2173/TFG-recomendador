"""Cálculo y filtrado común de la fiabilidad de recomendaciones."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


def calcular_fiabilidad(
    coincidencias: Mapping[str, bool],
    pesos: Mapping[str, float],
) -> float:
    """Calcula un porcentaje ponderado de criterios cumplidos.

    ``coincidencias`` y ``pesos`` deben contener los mismos criterios. Los
    pesos tienen que ser positivos; no es necesario que sumen uno.
    """
    criterios = set(coincidencias)
    if criterios != set(pesos):
        faltan = criterios - set(pesos)
        sobran = set(pesos) - criterios
        raise ValueError(
            f"Coincidencias y pesos no coinciden; faltan={sorted(faltan)}, "
            f"sobran={sorted(sobran)}"
        )
    if not criterios:
        raise ValueError("Debe existir al menos un criterio de fiabilidad")
    if any(not isinstance(peso, (int, float)) or peso <= 0 for peso in pesos.values()):
        raise ValueError("Todos los pesos deben ser números positivos")

    peso_total = sum(float(peso) for peso in pesos.values())
    peso_cumplido = sum(
        float(pesos[nombre])
        for nombre, cumplido in coincidencias.items()
        if cumplido
    )
    return round(peso_cumplido / peso_total * 100, 2)


def filtrar_por_fiabilidad(
    canciones: Sequence[Mapping[str, Any]],
    minimo: float = 0,
    maximo: float = 100,
) -> list[dict[str, Any]]:
    """Devuelve canciones cuya ``fiabilidad`` está dentro del rango inclusivo."""
    if not 0 <= minimo <= maximo <= 100:
        raise ValueError("El rango debe cumplir 0 <= minimo <= maximo <= 100")

    resultado = []
    for cancion in canciones:
        fiabilidad = cancion.get("fiabilidad")
        if not isinstance(fiabilidad, (int, float)):
            raise ValueError("Cada canción debe tener una fiabilidad numérica")
        if minimo <= fiabilidad <= maximo:
            resultado.append(dict(cancion))
    return resultado
