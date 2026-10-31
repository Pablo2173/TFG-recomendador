"""Recomendador musical basado en tono y modo.

Uso desde ``ml/``:

    python recomendador_armonico.py train
    python recomendador_armonico.py predict "Blinding Lights" "The Weeknd"

El modelo usa las convenciones del dataset: ``key`` va de 0 (Do) a
11 (Si), ``mode`` es 0 para menor y 1 para mayor.
"""

from __future__ import annotations

import argparse
import csv
import difflib
import os
import re
import subprocess
import tempfile
import unicodedata
from pathlib import Path
from typing import Any

import joblib
import librosa
import numpy as np
import pandas as pd
import requests
from sklearn.ensemble import RandomForestClassifier

from fiabilidad import calcular_fiabilidad, filtrar_por_fiabilidad


MAJOR = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
MINOR = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)
FEATURE_COLUMNS = [f"f{i}" for i in range(36)]


def _normalizar(texto: str) -> str:
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    texto = texto.lower()
    texto = re.sub(r"\(.*?\)|\[.*?\]|feat.*| - .*", "", texto)
    return re.sub(r"[^a-z0-9 ]", "", texto).strip()


def _similitud(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, _normalizar(a), _normalizar(b)).ratio()


def _buscar_deezer(nombre: str, artista: str) -> list[dict[str, Any]]:
    response = requests.get(
        "https://api.deezer.com/search",
        params={"q": f"{artista} {nombre}", "limit": 5},
        timeout=10,
    )
    response.raise_for_status()
    return [
        {
            "title": item["title"],
            "artist": item["artist"]["name"],
            "preview": item.get("preview"),
            "source": "deezer",
        }
        for item in response.json().get("data", [])
    ]


def _buscar_itunes(nombre: str, artista: str) -> list[dict[str, Any]]:
    response = requests.get(
        "https://itunes.apple.com/search",
        params={"term": f"{artista} {nombre}", "entity": "song", "limit": 5},
        timeout=10,
    )
    response.raise_for_status()
    return [
        {
            "title": item["trackName"],
            "artist": item["artistName"],
            "preview": item.get("previewUrl"),
            "genre": item.get("primaryGenreName"),
            "source": "itunes",
        }
        for item in response.json().get("results", [])
    ]


def buscar_preview(nombre: str, artista: str, umbral: float = 0.6) -> dict[str, Any] | None:
    """Devuelve la mejor preview encontrada o ``None`` si no hay coincidencia fiable."""
    for buscar in (_buscar_deezer, _buscar_itunes):
        try:
            candidatos = [item for item in buscar(nombre, artista) if item["preview"]]
        except requests.RequestException:
            continue
        if not candidatos:
            continue
        candidato = max(
            candidatos,
            key=lambda item: _similitud(item["title"], nombre)
            * _similitud(item["artist"], artista),
        )
        score = _similitud(candidato["title"], nombre) * _similitud(
            candidato["artist"], artista
        )
        if score >= umbral:
            return {**candidato, "match_score": score}
    return None


def _descargar_preview(url: str, destino: str) -> None:
    import imageio_ffmpeg

    extension = ".m4a" if ".m4a" in url.lower() else ".mp3"
    with tempfile.TemporaryDirectory() as carpeta:
        origen = os.path.join(carpeta, f"preview{extension}")
        response = requests.get(url, timeout=20)
        response.raise_for_status()
        with open(origen, "wb") as archivo:
            archivo.write(response.content)
        resultado = subprocess.run(
            [
                imageio_ffmpeg.get_ffmpeg_exe(),
                "-y",
                "-i",
                origen,
                "-ac",
                "1",
                "-ar",
                "22050",
                destino,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if resultado.returncode != 0:
            raise RuntimeError(f"ffmpeg falló:\n{resultado.stderr[-800:]}")


def _extraer_caracteristicas(audio_path: str) -> np.ndarray:
    audio, sample_rate = librosa.load(audio_path, duration=30)
    armonico = librosa.effects.harmonic(audio)
    afinacion = librosa.estimate_tuning(y=armonico, sr=sample_rate)
    chroma = librosa.feature.chroma_cqt(
        y=armonico, sr=sample_rate, tuning=afinacion
    ).mean(axis=1)
    total = chroma.sum()
    if not np.isfinite(total) or total <= 0:
        raise ValueError("No se pudo extraer energía tonal del audio")
    chroma = chroma / total
    mayor = np.array(
        [np.corrcoef(chroma, np.roll(MAJOR, k))[0, 1] for k in range(12)]
    )
    menor = np.array(
        [np.corrcoef(chroma, np.roll(MINOR, k))[0, 1] for k in range(12)]
    )
    features = np.concatenate([chroma, mayor, menor])
    if not np.all(np.isfinite(features)):
        raise ValueError("Las características extraídas no son válidas")
    return features


def _aumentar(X: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    datos: list[np.ndarray] = []
    etiquetas: list[np.ndarray] = []
    for semitonos in range(12):
        transpuesto = np.hstack(
            [np.roll(X[:, inicio : inicio + 12], semitonos, axis=1)
             for inicio in (0, 12, 24)]
        )
        datos.append(transpuesto)
        etiquetas.append((y % 12 + semitonos) % 12 + 12 * (y // 12))
    return np.vstack(datos), np.concatenate(etiquetas)


class RecomendadorArmonico:
    """Entrena y utiliza un Random Forest para recomendar por compatibilidad tonal."""

    def __init__(
        self,
        model_path: str | Path = "modelo_tono.joblib",
        confidence_medium: float = 0.6,
        confidence_high: float = 0.8,
    ) -> None:
        self.model_path = Path(model_path)
        self.confidence_medium = confidence_medium
        self.confidence_high = confidence_high
        self.model: RandomForestClassifier | None = None

    def _model(self) -> RandomForestClassifier:
        if self.model is None:
            if not self.model_path.exists():
                raise FileNotFoundError(
                    f"No existe el modelo {self.model_path}. Ejecuta primero train."
                )
            self.model = joblib.load(self.model_path)
        model = self.model
        if not isinstance(model, RandomForestClassifier):
            raise TypeError(f"El archivo {self.model_path} no contiene un Random Forest")
        return model

    def train(self, features_path: str | Path = "features.csv") -> dict[str, int]:
        dataset = pd.read_csv(features_path)
        dataset = dataset[dataset["score"] >= 0.9].reset_index(drop=True)
        if dataset.empty:
            raise ValueError("No hay ejemplos con score suficiente para entrenar")
        X = dataset[FEATURE_COLUMNS].to_numpy()
        y = (dataset["key"] + 12 * dataset["mode"]).to_numpy()
        X_augmented, y_augmented = _aumentar(X, y)
        self.model = RandomForestClassifier(
            n_estimators=300, n_jobs=-1, random_state=42
        ).fit(X_augmented, y_augmented)
        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self.model, self.model_path)
        return {"songs": len(dataset), "examples": len(y_augmented)}

    def _prediction(self, features: np.ndarray) -> dict[str, Any]:
        model = self._model()
        probabilities = model.predict_proba(features.reshape(1, -1))[0]
        index = int(probabilities.argmax())
        class_id = int(model.classes_[index])
        confidence = float(probabilities[index])
        level = (
            "high"
            if confidence >= self.confidence_high
            else "medium"
            if confidence >= self.confidence_medium
            else "low"
        )
        return {
            "key": class_id % 12,
            "mode": class_id // 12,
            "confidence": confidence,
            "confidence_level": level,
            "source": "audio",
        }

    def predict_audio(self, audio_path: str | Path) -> dict[str, Any]:
        return self._prediction(_extraer_caracteristicas(str(audio_path)))

    def predict_song(self, nombre: str, artista: str) -> dict[str, Any] | None:
        preview = buscar_preview(nombre, artista)
        if preview is None:
            return None
        with tempfile.TemporaryDirectory() as carpeta:
            audio_path = os.path.join(carpeta, "preview.wav")
            _descargar_preview(preview["preview"], audio_path)
            prediction = self.predict_audio(audio_path)
        return {
            **prediction,
            "source_provider": preview["source"],
            "match_score": preview["match_score"],
        }

    @staticmethod
    def rank_tracks(
        tracks_path: str | Path,
        key: int,
        mode: int,
        limit: int = 20,
        minimum_reliability: float = 0,
        maximum_reliability: float = 100,
    ) -> list[dict[str, Any]]:
        """Ordena un CSV y asigna fiabilidad según coincidencias armónicas."""
        if not 0 <= key <= 11 or mode not in (0, 1):
            raise ValueError("key debe estar entre 0 y 11 y mode debe ser 0 o 1")
        if limit < 1:
            raise ValueError("limit debe ser mayor que cero")

        results_by_id: dict[str, dict[str, Any]] = {}
        with open(tracks_path, newline="", encoding="utf-8") as archivo:
            for track in csv.DictReader(archivo):
                track_key = int(track["key"])
                track_mode = int(track["mode"])
                distance = (track_key - key) % 12
                same_key = track_key == key
                same_mode = track_mode == mode
                harmonic_relation = (
                    distance in (0, 5, 7)
                    if same_mode
                    else track_key == (key + (9 if mode else 3)) % 12
                )
                if not harmonic_relation:
                    continue
                reliability = calcular_fiabilidad(
                    {
                        "same_key": same_key,
                        "same_mode": same_mode,
                        "harmonic_relation": harmonic_relation,
                    },
                    {"same_key": 0.45, "same_mode": 0.25, "harmonic_relation": 0.30},
                )
                track_id = track["track_id"]
                result = {
                    "track_id": track_id,
                    "name": track["track_name"],
                    "artist": track["artists"],
                    "genre": track["track_genre"],
                    "key": track_key,
                    "mode": track_mode,
                    "harmonic_score": reliability / 100,
                    "fiabilidad": reliability,
                }
                previous = results_by_id.get(track_id)
                if previous is None or reliability > previous["fiabilidad"]:
                    results_by_id[track_id] = result
        results = sorted(
            results_by_id.values(),
            key=lambda item: item["fiabilidad"],
            reverse=True,
        )
        return filtrar_por_fiabilidad(
            results, minimum_reliability, maximum_reliability
        )[:limit]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    train_parser = subparsers.add_parser("train")
    train_parser.add_argument("--features", default="features.csv")
    train_parser.add_argument("--model", default="modelo_tono.joblib")
    predict_parser = subparsers.add_parser("predict")
    predict_parser.add_argument("title")
    predict_parser.add_argument("artist")
    predict_parser.add_argument("--model", default="modelo_tono.joblib")
    args = parser.parse_args()

    recommender = RecomendadorArmonico(args.model)
    if args.command == "train":
        print(recommender.train(args.features))
    else:
        print(recommender.predict_song(args.title, args.artist))


if __name__ == "__main__":
    main()
