"""Pruebas metamórficas del recomendador armónico.

Se ejecuta desde la raíz o desde ``ml/``:

    python -m unittest discover -s ml -p "test_*.py" -v
"""

from __future__ import annotations

import csv
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))

from recomendador_armonico import FEATURE_COLUMNS, RecomendadorArmonico, _aumentar


ROOT = Path(__file__).resolve().parents[1]
FEATURES_PATH = ROOT / "ml" / "features.csv"
MODEL_PATH = ROOT / "ml" / "modelo_tono.joblib"


class RecomendadorMetamorphicTests(unittest.TestCase):
    """Comprueba relaciones que deben conservarse aunque cambie la entrada."""

    @classmethod
    def setUpClass(cls) -> None:
        dataset = pd.read_csv(FEATURES_PATH)
        dataset = dataset[dataset["score"] >= 0.9].reset_index(drop=True)
        cls.features = dataset[FEATURE_COLUMNS].to_numpy()
        cls.labels = (
            dataset["key"].to_numpy() + 12 * dataset["mode"].to_numpy()
        ).astype(int)
        cls.recommender = RecomendadorArmonico(MODEL_PATH)
        cls.model = cls.recommender._model()

    def test_aumento_es_componible(self) -> None:
        """Transponer t y después u equivale a transponer t + u."""
        original_features = self.features[:20]
        original_labels = self.labels[:20]
        direct_features, direct_labels = _aumentar(
            original_features, original_labels
        )

        for first_shift in range(12):
            first_features = direct_features[first_shift * 20 : (first_shift + 1) * 20]
            first_labels = direct_labels[first_shift * 20 : (first_shift + 1) * 20]
            composed_all_features, composed_all_labels = _aumentar(
                first_features, first_labels
            )
            for second_shift in range(12):
                composed_index = second_shift * 20
                direct_index = ((first_shift + second_shift) % 12) * 20
                np.testing.assert_allclose(
                    composed_all_features[composed_index : composed_index + 20],
                    direct_features[direct_index : direct_index + 20],
                )
                np.testing.assert_array_equal(
                    composed_all_labels[composed_index : composed_index + 20],
                    direct_labels[direct_index : direct_index + 20],
                )

    def test_prediccion_es_equivariante_a_transposicion(self) -> None:
        """La tónica predicha gira y el modo permanece igual."""
        original = self.model.predict(self.features)
        augmented_features, _ = _aumentar(self.features, self.labels)

        for shift in range(12):
            start = shift * len(self.features)
            predicted = self.model.predict(
                augmented_features[start : start + len(self.features)]
            )
            expected = (original % 12 + shift) % 12 + 12 * (original // 12)
            np.testing.assert_array_equal(predicted, expected)

    def test_ranking_es_invariante_a_transposicion_global(self) -> None:
        """El orden y la fiabilidad no dependen del nombre absoluto del tono."""
        fieldnames = [
            "track_id",
            "track_name",
            "artists",
            "track_genre",
            "key",
            "mode",
        ]
        rows = [
            ["a", "A", "Artist", "test", "0", "1"],
            ["b", "B", "Artist", "test", "7", "1"],
            ["c", "C", "Artist", "test", "3", "0"],
            ["d", "D", "Artist", "test", "2", "1"],
        ]
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", newline="", encoding="utf-8", delete=False
        ) as file:
            csv.writer(file).writerows([fieldnames, *rows])
            tracks_path = Path(file.name)
        self.addCleanup(tracks_path.unlink)

        base = RecomendadorArmonico.rank_tracks(tracks_path, 0, 1, limit=10)
        shift = 5
        shifted_rows = [
            [row[0], row[1], row[2], row[3], str((int(row[4]) + shift) % 12), row[5]]
            for row in rows
        ]
        with tracks_path.open("w", newline="", encoding="utf-8") as file:
            csv.writer(file).writerows([fieldnames, *shifted_rows])
        shifted = RecomendadorArmonico.rank_tracks(
            tracks_path, shift, 1, limit=10
        )

        self.assertEqual(
            [item["track_id"] for item in base],
            [item["track_id"] for item in shifted],
        )
        self.assertEqual(
            [item["fiabilidad"] for item in base],
            [item["fiabilidad"] for item in shifted],
        )

    def test_ranking_no_duplica_un_track(self) -> None:
        """Duplicar una fila no cambia el resultado observable."""
        fieldnames = [
            "track_id",
            "track_name",
            "artists",
            "track_genre",
            "key",
            "mode",
        ]
        rows = [["a", "A", "Artist", "test", "0", "1"], ["b", "B", "Artist", "test", "7", "1"]]
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", newline="", encoding="utf-8", delete=False
        ) as file:
            csv.writer(file).writerows([fieldnames, *rows])
            tracks_path = Path(file.name)
        self.addCleanup(tracks_path.unlink)

        original = RecomendadorArmonico.rank_tracks(tracks_path, 0, 1, limit=10)
        with tracks_path.open("a", newline="", encoding="utf-8") as file:
            csv.writer(file).writerow(rows[0])
        duplicated = RecomendadorArmonico.rank_tracks(tracks_path, 0, 1, limit=10)

        self.assertEqual(original, duplicated)


if __name__ == "__main__":
    unittest.main()
