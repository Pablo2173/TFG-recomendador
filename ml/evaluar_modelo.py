"""Evalúa el clasificador tonal sin mezclar canciones transpuestas entre train y test."""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, balanced_accuracy_score, top_k_accuracy_score
from sklearn.model_selection import train_test_split

from recomendador_armonico import FEATURE_COLUMNS, _aumentar


def evaluar(
    features_path: str | Path = "features.csv",
    test_size: float = 0.2,
) -> dict[str, float | int]:
    dataset = pd.read_csv(features_path)
    dataset = dataset[dataset["score"] >= 0.9].reset_index(drop=True)
    if dataset.empty:
        raise ValueError("No hay ejemplos con score suficiente para evaluar")

    X = dataset[FEATURE_COLUMNS].to_numpy()
    y = (dataset["key"].to_numpy() + 12 * dataset["mode"].to_numpy()).astype(int)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, stratify=y, random_state=42
    )
    X_augmented, y_augmented = _aumentar(X_train, y_train)
    model = RandomForestClassifier(
        n_estimators=300, n_jobs=-1, random_state=42, class_weight="balanced"
    ).fit(X_augmented, y_augmented)
    probabilities = model.predict_proba(X_test)
    predictions = model.classes_[probabilities.argmax(axis=1)]
    return {
        "songs": len(dataset),
        "train_songs": len(X_train),
        "test_songs": len(X_test),
        "augmented_train_examples": len(X_augmented),
        "accuracy": round(float(accuracy_score(y_test, predictions)), 4),
        "balanced_accuracy": round(float(balanced_accuracy_score(y_test, predictions)), 4),
        "top_3_accuracy": round(
            float(top_k_accuracy_score(y_test, probabilities, k=3, labels=model.classes_)),
            4,
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--features", default="features.csv")
    args = parser.parse_args()
    print(evaluar(args.features))


if __name__ == "__main__":
    main()
