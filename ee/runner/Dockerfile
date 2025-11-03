FROM rust:1.91-bullseye as builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM gcr.io/distroless/cc-debian12
COPY --from=builder /app/target/release/alga-ext-runner /usr/local/bin/alga-ext-runner
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/alga-ext-runner"]
