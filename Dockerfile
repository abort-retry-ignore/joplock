FROM node:20-alpine

ARG JOPLOCK_VERSION=0.1.0-dev

WORKDIR /app

RUN apk add --no-cache postgresql18-client pandoc weasyprint font-dejavu

COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
RUN npm install --omit=dev

COPY app ./app
COPY server.js ./server.js
COPY public ./public

RUN echo "$JOPLOCK_VERSION" > /app/version.txt

EXPOSE 3001

CMD ["node", "server.js"]
