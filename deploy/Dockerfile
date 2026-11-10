FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY packages/ingestion/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/ingestion && /opt/ingestion/bin/pip install --no-cache-dir -r /tmp/requirements.txt
COPY package.json ./
COPY apps/server ./apps/server
COPY packages ./packages
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4188 ALLOW_DEMO_AUTH=false QISHU_PYTHON=/opt/ingestion/bin/python
EXPOSE 4188
CMD ["node", "apps/server/src/server.js"]
