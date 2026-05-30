FROM node:20-slim

WORKDIR /app

COPY package*.json ./

RUN npm install --no-audit --no-fund --omit=optional \
 && npm cache clean --force \
 && rm -rf /root/.npm /tmp/*

COPY . .

# Run as the non-root "node" user (already present in node:20-slim).
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 3777

CMD ["node", "server.js"]
