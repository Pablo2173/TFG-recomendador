FROM python:3.12-slim

WORKDIR /app/ml

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api.py fiabilidad.py recomendador_armonico.py modelo_tono.joblib ./

EXPOSE 5000

CMD ["sh", "-c", "python api.py --host 0.0.0.0 --port ${PORT:-5000} --model modelo_tono.joblib"]
