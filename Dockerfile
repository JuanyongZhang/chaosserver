# Dockerfile
FROM node:20

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

RUN ./node_modules/.bin/tsc

# Default port; override at runtime with `docker run -e PORT=8080 -p 8080:8080`
ENV PORT=13526

EXPOSE 13526

CMD [ "node", "./dist/index.js" ]