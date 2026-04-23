FROM node:22-alpine
WORKDIR /app
COPY dev-loop.ts ./
COPY src ./src
RUN npm install -g tsx
CMD ["tsx", "dev-loop.ts"]
