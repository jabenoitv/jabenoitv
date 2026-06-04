FROM node:20-slim

WORKDIR /app

COPY package*.json ./

RUN npm install --no-audit --no-fund --omit=optional \
 && npm cache clean --force \
 && rm -rf /root/.npm /tmp/*

COPY . .

RUN mkdir -p /cashclaw-data \
 && chown -R node:node /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3777

# Entrypoint runs as root, fixes /cashclaw-data ownership, then drops to node user.
CMD ["/entrypoint.sh"]
