FROM node:22-alpine
WORKDIR /app
COPY dev-loop.ts .
RUN npm install -g tsx
CMD ["tsx", "dev-loop.ts"]
