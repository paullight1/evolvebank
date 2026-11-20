# Build the exact source snapshot recorded in upstreams.lock.json.
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /blnk ./cmd

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 blnk
WORKDIR /app
COPY --from=build /blnk /usr/local/bin/blnk
USER blnk
EXPOSE 5001
CMD ["blnk", "start"]
