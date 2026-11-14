#pragma once

// --- Wi-Fi -------------------------------------------------------------
#define WIFI_SSID "your-wifi"
#define WIFI_PASS "your-password"

// --- Edge server (the Deno server in ../server) -------------------------
// Local development: your computer's LAN IP, port 8000, plain ws://.
// Only use ws:// on a network you trust. Audio and DEVICE_TOKEN are sent unencrypted.
#define RELAY_HOST "192.168.1.100"
#define RELAY_PORT 8000
#define RELAY_TLS 0  // 0 = ws:// (local), 1 = wss:// (hosted)

// Hosted server: use these instead. wss:// encrypts everything with TLS.
// #define RELAY_HOST "your-relay.deno.dev"
// #define RELAY_PORT 443
// #define RELAY_TLS 1

// Optional, for wss://. Paste the PEM root CA certificate of your host here to
// verify the server's identity. Without it the connection is encrypted but the
// server certificate is not checked.
// #define RELAY_CA_CERT "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n"

#define DEVICE_TOKEN "same-value-as-the-server"

// --- INMP441 microphone (I2S port 0) -----------------------------------
#define MIC_BCLK 4
#define MIC_WS 5
#define MIC_DIN 6
#define MIC_RATE 16000  // must match the relay

// --- MAX98357A amplifier (I2S port 1) ----------------------------------
#define SPK_BCLK 15
#define SPK_WS 16
#define SPK_DOUT 7
#define SPK_RATE 24000  // must match the relay

// --- UI ----------------------------------------------------------------
#define BUTTON_PIN 0  // BOOT button: press to interrupt the assistant
#define LED_PIN 48    // on-board RGB LED on many S3 boards
