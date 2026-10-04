FROM node:22-bookworm-slim

WORKDIR /opt/sceneready
COPY src ./src
USER node
EXPOSE 8000

CMD ["node", "--experimental-strip-types", "src/health.ts"]
