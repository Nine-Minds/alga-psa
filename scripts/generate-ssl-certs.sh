#!/usr/bin/env bash
set -euo pipefail

# Generate self-signed SSL certificates for development/testing
# For production, use Let's Encrypt or your CA-signed certificates

CERT_DIR="${1:-./my_certs}"
DAYS_VALID="${2:-365}"
DOMAIN="${3:-localhost}"

echo "Generating self-signed SSL certificates..."
echo "Certificate directory: ${CERT_DIR}"
echo "Valid for: ${DAYS_VALID} days"
echo "Domain: ${DOMAIN}"
echo ""
read -p "Press [ENTER] to continue or [CTRL+C] to abort..."

# Create directory if it doesn't exist
mkdir -p "${CERT_DIR}"

# Generate private key
openssl genrsa -out "${CERT_DIR}/server.key" 2048

# Generate certificate signing request (CSR)
openssl req -new \
  -key "${CERT_DIR}/server.key" \
  -out "${CERT_DIR}/server.csr" \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=${DOMAIN}"

# Generate self-signed certificate
openssl x509 -req \
  -days ${DAYS_VALID} \
  -in "${CERT_DIR}/server.csr" \
  -signkey "${CERT_DIR}/server.key" \
  -out "${CERT_DIR}/server.crt" \
  -extfile <(printf "subjectAltName=DNS:${DOMAIN},DNS:*.${DOMAIN},DNS:localhost,IP:127.0.0.1")

# Set appropriate permissions
chmod 600 "${CERT_DIR}/server.key"
chmod 644 "${CERT_DIR}/server.crt"

# Remove CSR (no longer needed)
rm "${CERT_DIR}/server.csr"

echo "SSL certificates generated successfully!"
echo "  Private key: ${CERT_DIR}/server.key"
echo "  Certificate: ${CERT_DIR}/server.crt"
echo ""
echo "Note: This is a self-signed certificate for development/testing only."
echo "For production, use Let's Encrypt or CA-signed certificates and a reverse proxy."
