FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY src ./src
COPY views ./views
COPY static ./static
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
