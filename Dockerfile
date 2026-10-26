FROM node:26-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
EXPOSE 3000
CMD ["node", "src/server.ts"]
