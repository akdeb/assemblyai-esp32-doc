#pragma once

// --- Wi-Fi -------------------------------------------------------------
#define WIFI_SSID "your-wifi"
#define WIFI_PASS "your-password"

// --- Relay (the Deno server in ../server) ------------------------------
#define RELAY_HOST "your-relay.deno.dev"
#define RELAY_PORT 443
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
