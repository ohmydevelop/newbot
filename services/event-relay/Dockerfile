FROM node:24-slim
WORKDIR /app
COPY dist/event-relay/main.mjs ./main.mjs
ENV RELAY_HOST=0.0.0.0 RELAY_DATA=/data
VOLUME /data
EXPOSE 3180
CMD ["node","main.mjs"]
