FROM node:20-slim

WORKDIR /app

COPY package*.json ./

RUN npm install --no-audit --no-fund --omit=optional \
 && npm cache clean --force \
 && rm -rf /root/.npm /tmp/*

COPY . .

ENV NODE_ENV=production
EXPOSE 3777

CMD ["node", "server.js"]
