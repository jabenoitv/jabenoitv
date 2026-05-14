FROM node:22-slim

RUN npm install -g cashclaw-agent moltlaunch --loglevel=error

WORKDIR /app
COPY start.sh .
RUN chmod +x start.sh

EXPOSE 3777

CMD ["/app/start.sh"]
