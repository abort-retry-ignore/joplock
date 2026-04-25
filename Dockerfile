FROM node:20-alpine

WORKDIR /app

COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
RUN npm install --omit=dev

COPY app ./app
COPY server.js ./server.js
COPY public ./public

EXPOSE 3001

CMD ["node", "server.js"]
