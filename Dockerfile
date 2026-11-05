FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY views ./views
COPY static/css/tailwind.input.css ./static/css/tailwind.input.css
RUN npm run build:css

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY views ./views
COPY static ./static
COPY --from=build /app/static/css/tailwind.css ./static/css/tailwind.css
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
