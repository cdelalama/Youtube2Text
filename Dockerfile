FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime

ARG YT_DLP_VERSION=

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
  && python3 -m venv /opt/yt-dlp \
  && /opt/yt-dlp/bin/pip install --no-cache-dir --upgrade pip \
  && if [ -n "$YT_DLP_VERSION" ]; then /opt/yt-dlp/bin/pip install --no-cache-dir "yt-dlp[default]==$YT_DLP_VERSION"; else /opt/yt-dlp/bin/pip install --no-cache-dir "yt-dlp[default]"; fi \
  && printf '%s\n' '--js-runtimes node' > /etc/yt-dlp.conf \
  && node -e "const major=Number(process.versions.node.split('.')[0]); if (major < 22) process.exit(1)" \
  && /opt/yt-dlp/bin/python -c "import yt_dlp_ejs" \
  && /opt/yt-dlp/bin/yt-dlp --version \
  && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/yt-dlp/bin:${PATH}"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

ENV HOST=0.0.0.0
ENV PORT=8787
ENV OUTPUT_DIR=/data/output
ENV AUDIO_DIR=/data/audio
ENV Y2T_API_PERSIST_RUNS=true

EXPOSE 8787

VOLUME ["/data/output", "/data/audio"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/api.js"]
