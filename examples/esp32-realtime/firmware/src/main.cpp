// ESP32-S3 client for the AssemblyAI realtime server.
//   mic (I2S0) -> PCM16 16 kHz -> WebSocket -> relay
//   relay -> PCM16 24 kHz -> ring buffer -> speaker (I2S1)

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <driver/i2s.h>

#include "Config.h"

static const i2s_port_t MIC_PORT = I2S_NUM_0;
static const i2s_port_t SPK_PORT = I2S_NUM_1;
static const size_t MIC_FRAME = 800;  // 50 ms @ 16 kHz

WebSocketsClient ws;
volatile bool connected = false;

// Playback ring buffer (~1.5 s of 24 kHz PCM16) fed by the WebSocket callback.
static const size_t RING_BYTES = SPK_RATE * 2 * 3 / 2;
static uint8_t* ring;
static volatile size_t head = 0, tail = 0;

static size_t ringUsed() { return (head + RING_BYTES - tail) % RING_BYTES; }
static void ringPush(const uint8_t* d, size_t n) {
  for (size_t i = 0; i < n && ringUsed() < RING_BYTES - 1; i++) {
    ring[head] = d[i];
    head = (head + 1) % RING_BYTES;
  }
}
static void ringClear() { tail = head; }  // used on interrupt (barge-in)

static void setupI2S() {
  i2s_config_t mic = {};
  mic.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
  mic.sample_rate = MIC_RATE;
  mic.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;  // INMP441 outputs 24-bit in 32
  mic.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;
  mic.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  mic.dma_buf_count = 8;
  mic.dma_buf_len = 256;
  i2s_pin_config_t micPins = {.mck_io_num = I2S_PIN_NO_CHANGE, .bck_io_num = MIC_BCLK, .ws_io_num = MIC_WS,
                              .data_out_num = I2S_PIN_NO_CHANGE, .data_in_num = MIC_DIN};
  i2s_driver_install(MIC_PORT, &mic, 0, nullptr);
  i2s_set_pin(MIC_PORT, &micPins);

  i2s_config_t spk = {};
  spk.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX);
  spk.sample_rate = SPK_RATE;
  spk.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
  spk.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;
  spk.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  spk.dma_buf_count = 8;
  spk.dma_buf_len = 256;
  spk.tx_desc_auto_clear = true;
  i2s_pin_config_t spkPins = {.mck_io_num = I2S_PIN_NO_CHANGE, .bck_io_num = SPK_BCLK, .ws_io_num = SPK_WS,
                              .data_out_num = SPK_DOUT, .data_in_num = I2S_PIN_NO_CHANGE};
  i2s_driver_install(SPK_PORT, &spk, 0, nullptr);
  i2s_set_pin(SPK_PORT, &spkPins);
}

static void onEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: connected = true; Serial.println("server connected"); break;
    case WStype_DISCONNECTED: connected = false; ringClear(); Serial.println("server disconnected"); break;
    case WStype_BIN: ringPush(payload, length); break;  // TTS audio
    case WStype_TEXT: {
      JsonDocument doc;
      if (deserializeJson(doc, payload, length)) break;
      const char* t = doc["type"] | "";
      if (!strcmp(t, "interrupt")) ringClear();
      if (!strcmp(t, "transcript")) Serial.printf("[%s] %s\n", (const char*)doc["role"], (const char*)doc["text"]);
      if (!strcmp(t, "state")) {
        const char* s = doc["state"] | "";
        digitalWrite(LED_PIN, !strcmp(s, "listening") ? LOW : HIGH);
      }
      break;
    }
    default: break;
  }
}

// Core 0: read the mic, convert 32-bit I2S samples to PCM16, stream to the server.
static void micTask(void*) {
  static int32_t raw[MIC_FRAME];
  static int16_t pcm[MIC_FRAME];
  for (;;) {
    size_t got = 0;
    i2s_read(MIC_PORT, raw, sizeof(raw), &got, portMAX_DELAY);
    size_t n = got / 4;
    for (size_t i = 0; i < n; i++) pcm[i] = (int16_t)(raw[i] >> 14);  // 32 -> 16 bit with gain
    if (connected) ws.sendBIN((uint8_t*)pcm, n * 2);
  }
}

// Core 1 loop pushes ring buffer data to the speaker.
static void pumpSpeaker() {
  static uint8_t chunk[1024];
  size_t n = min(ringUsed(), sizeof(chunk));
  if (!n) return;
  for (size_t i = 0; i < n; i++) { chunk[i] = ring[tail]; tail = (tail + 1) % RING_BYTES; }
  size_t written = 0;
  i2s_write(SPK_PORT, chunk, n, &written, 0);
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  ring = (uint8_t*)malloc(RING_BYTES);

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(250); Serial.print("."); }
  Serial.println("\nWi-Fi connected");

  setupI2S();

  String path = String("/?token=") + DEVICE_TOKEN;
  ws.beginSSL(RELAY_HOST, RELAY_PORT, path.c_str());
  ws.onEvent(onEvent);
  ws.setReconnectInterval(2000);
  ws.enableHeartbeat(15000, 3000, 2);

  xTaskCreatePinnedToCore(micTask, "mic", 8192, nullptr, 2, nullptr, 0);
}

void loop() {
  ws.loop();
  pumpSpeaker();

  static bool wasDown = false;
  bool down = digitalRead(BUTTON_PIN) == LOW;
  if (down && !wasDown && connected) {  // button: interrupt the assistant
    ringClear();
    ws.sendTXT("{\"type\":\"interrupt\"}");
  }
  wasDown = down;
}
