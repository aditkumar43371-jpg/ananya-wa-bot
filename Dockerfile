FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
# the "node" user in this image is uid 1000, as Hugging Face Spaces require
RUN mkdir -p /app/auth && chown -R 1000:1000 /app
USER 1000
EXPOSE 7860
CMD ["node", "index.js"]
