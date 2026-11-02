FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-core libreoffice-writer fonts-dejavu-core fonts-liberation ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . /app
RUN mkdir -p /data /app/backups && chown -R node:node /data /app/backups
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3030 \
    DATA_FILE=/app/storage/data.demo.json \
    DB_FILE=/data/prometey.sqlite \
    DOCUMENTS_DIR=/data/documents \
    RECORDINGS_DIR=/data/recordings
USER node
VOLUME ["/data"]
EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3030/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server.js"]
