"""API HTTP mínima para predicción tonal del recomendador."""

from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests

from recomendador_armonico import RecomendadorArmonico


def create_handler(recommender: RecomendadorArmonico):
    class PredictionHandler(BaseHTTPRequestHandler):
        def _json(self, status: int, payload: dict) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path == "/health":
                self._json(200, {"status": "ok"})
            else:
                self._json(404, {"error": "Ruta no encontrada"})

        def do_POST(self) -> None:
            if self.path != "/predict":
                self._json(404, {"error": "Ruta no encontrada"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length))
                name = payload.get("name")
                artist = payload.get("artist")
                if not isinstance(name, str) or not name.strip():
                    raise ValueError("name debe ser un texto no vacío")
                if not isinstance(artist, str) or not artist.strip():
                    raise ValueError("artist debe ser un texto no vacío")
                prediction = recommender.predict_song(name.strip(), artist.strip())
                if prediction is None:
                    self._json(404, {"error": "No se encontró una preview fiable"})
                    return
                self._json(200, prediction)
            except (ValueError, json.JSONDecodeError) as error:
                self._json(400, {"error": str(error)})
            except (
                FileNotFoundError,
                OSError,
                RuntimeError,
                TypeError,
                requests.RequestException,
            ) as error:
                self._json(500, {"error": f"Error prediciendo la canción: {error}"})

        def log_message(self, format: str, *args: object) -> None:
            return

    return PredictionHandler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--model", default="modelo_tono.joblib")
    args = parser.parse_args()
    recommender = RecomendadorArmonico(args.model)
    server = ThreadingHTTPServer((args.host, args.port), create_handler(recommender))
    print(f"API Python en http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
