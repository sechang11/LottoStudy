# Serves the prebuilt static site. Railway sets $PORT.
FROM python:3.12-slim
WORKDIR /site
COPY index.html .
CMD ["sh", "-c", "python -m http.server ${PORT:-8080} --bind 0.0.0.0"]
