#!/usr/bin/env bash
set -euo pipefail

CA_PATH="${1:-$HOME/proxy-ca.pem}"

if [[ ! -f "${CA_PATH}" ]]; then
  echo "[error] CA certificate not found at ${CA_PATH}."
  echo "Copy it from the server first: scp ubuntu@server-ip:/home/minhqnd/.http-mitm-proxy/certs/ca.pem ~/proxy-ca.pem"
  exit 1
fi

echo "Installing CA certificate from ${CA_PATH} into the macOS System keychain (requires sudo)."
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${CA_PATH}"

echo "Installation complete. You may need to restart your browsers for changes to take effect."