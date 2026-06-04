/*
 * Murmur — C shell.
 *
 * Deliberately minimal logic: voice dictation (the one thing that exists only
 * in C, not in Alloy/JS) and a hand-drawn full-screen UI. Everything that rots
 * — models, providers, request shapes — lives in PebbleKit JS (src/pkjs/).
 *
 * The home screen is a drawn "voice" scene: a microphone glyph on a dark field,
 * with concentric rings that pulse outward while listening and an amber arc that
 * spins while the phone is working. When a reply arrives the scene gives way to
 * a full-screen scrolling transcript.
 *
 * Protocol (AppMessage keys from package.json):
 *   watch -> phone:  transcript (cstring), command (int, 1 = reset)
 *   phone -> watch:  status (int: 0 idle / 1 thinking / 2 error)
 *                    response (cstring chunk) + chunkIndex (int) + chunkTotal (int)
 *                    error (cstring)
 *
 * Long replies arrive as ordered chunks: index 0 resets the buffer, the last
 * chunk (index == total-1) marks completion. The watch half of the fix for
 * PebbleAI's truncated-response bug.
 */

#include <pebble.h>

#define STATUS_IDLE 0
#define STATUS_THINKING 1
#define STATUS_ERROR 2

#define CMD_RESET 1

typedef enum {
  STATE_IDLE,
  STATE_LISTENING,
  STATE_THINKING,
  STATE_RESPONSE,
  STATE_ERROR,
} AppState;

// Palette. All three targets (emery/gabbro/flint) are colour screens; the
// PBL_IF_COLOR_ELSE guards keep it sane on a hypothetical B&W build.
#define COLOR_BG       GColorBlack
#define COLOR_ACCENT   PBL_IF_COLOR_ELSE(GColorVividCerulean, GColorWhite)
#define COLOR_TITLE    GColorWhite
#define COLOR_HINT     PBL_IF_COLOR_ELSE(GColorLightGray, GColorWhite)
#define COLOR_THINK    PBL_IF_COLOR_ELSE(GColorChromeYellow, GColorWhite)
#define COLOR_ERR      PBL_IF_COLOR_ELSE(GColorRed, GColorWhite)
#define COLOR_BODY_TXT GColorWhite

// Animation + ring geometry.
#define ANIM_INTERVAL_MS 50
#define RING_COUNT 3
#define RING_MIN 18
#define RING_MAX 60

// Reassembled reply cap, so a runaway response can't exhaust app RAM.
#define RESPONSE_MAX_BYTES 8192

// Watch-side persisted prefs. Versioned from day one so adding a field later
// can migrate instead of corrupting (the lesson from PebbleAI's unversioned
// Settings struct). v1 holds nothing actionable yet — it establishes the ladder.
#define PERSIST_KEY_STATE 1
#define PERSIST_SCHEMA_VERSION 1

typedef struct {
  uint16_t version;
} PersistedState;

static Window *s_window;
static Layer *s_voice_layer;        // hand-drawn home scene
static ScrollLayer *s_scroll_layer; // reply view
static TextLayer *s_response_layer;

static DictationSession *s_dictation_session;

static AppState s_state = STATE_IDLE;
static AppTimer *s_anim_timer = NULL;
static int s_anim_phase = 0;

static char s_error_buf[128];

static char *s_response_buf = NULL;
static size_t s_response_len = 0;   // bytes used (excluding NUL)
static size_t s_response_cap = 0;   // bytes allocated

// Audio (read-aloud) streaming: phone sends 8 kHz / 8-bit signed PCM in chunks.
#define AUDIO_PENDING_MAX 8192
static uint8_t s_audio_pending[AUDIO_PENDING_MAX];
static size_t s_audio_pending_len = 0;
static bool s_audio_open = false;
static bool s_audio_closing = false;
static AppTimer *s_audio_timer = NULL;

// ---------------------------------------------------------------------------
// Persisted state
// ---------------------------------------------------------------------------

static void prv_load_state(void) {
  PersistedState state = { .version = 0 };
  if (persist_exists(PERSIST_KEY_STATE)) {
    persist_read_data(PERSIST_KEY_STATE, &state, sizeof(state));
  }
  // Migration ladder: bump version field by field as the schema grows.
  if (state.version < PERSIST_SCHEMA_VERSION) {
    state.version = PERSIST_SCHEMA_VERSION;
    persist_write_data(PERSIST_KEY_STATE, &state, sizeof(state));
  }
}

// ---------------------------------------------------------------------------
// Response buffer
// ---------------------------------------------------------------------------

static void prv_layout_response(void) {
  if (!s_response_buf) {
    return;
  }
  GRect bounds = layer_get_bounds(scroll_layer_get_layer(s_scroll_layer));
  int w = bounds.size.w - 12;
  // Measure with a tall frame first: text_layer_get_content_size() is clipped to
  // the layer's current height, so a one-screen frame would truncate (and the
  // ellipsis overflow mode would show "..."). Give it lots of room, measure the
  // true height, then size the layer + scroll content to it.
  text_layer_set_size(s_response_layer, GSize(w, 30000));
  text_layer_set_text(s_response_layer, s_response_buf);
  GSize used = text_layer_get_content_size(s_response_layer);
  text_layer_set_size(s_response_layer, GSize(w, used.h + 8));
  scroll_layer_set_content_size(s_scroll_layer, GSize(bounds.size.w, used.h + 16));
  scroll_layer_set_content_offset(s_scroll_layer, GPoint(0, 0), false);
}

static void prv_reset_response(void) {
  s_response_len = 0;
  if (s_response_buf && s_response_cap > 0) {
    s_response_buf[0] = '\0';
  }
}

static void prv_append_response(const char *chunk) {
  size_t add = strlen(chunk);
  size_t needed = s_response_len + add + 1;  // + NUL

  if (needed > RESPONSE_MAX_BYTES) {
    if (s_response_len + 1 >= RESPONSE_MAX_BYTES) {
      return;
    }
    add = RESPONSE_MAX_BYTES - s_response_len - 1;
    needed = RESPONSE_MAX_BYTES;
  }

  if (needed > s_response_cap) {
    size_t new_cap = s_response_cap ? s_response_cap : 256;
    while (new_cap < needed) {
      new_cap *= 2;
    }
    if (new_cap > RESPONSE_MAX_BYTES) {
      new_cap = RESPONSE_MAX_BYTES;
    }
    char *grown = realloc(s_response_buf, new_cap);
    if (!grown) {
      return;  // keep what we have rather than crash
    }
    s_response_buf = grown;
    s_response_cap = new_cap;
  }

  memcpy(s_response_buf + s_response_len, chunk, add);
  s_response_len += add;
  s_response_buf[s_response_len] = '\0';
}

// ---------------------------------------------------------------------------
// Voice scene drawing
// ---------------------------------------------------------------------------

static void prv_draw_mic(GContext *ctx, GPoint mc, GColor color) {
  graphics_context_set_fill_color(ctx, color);
  // Capsule (the mic head).
  graphics_fill_rect(ctx, GRect(mc.x - 6, mc.y - 16, 12, 20), 6, GCornersAll);
  // Cradle: a bottom arc hugging the capsule.
  GRect cradle = GRect(mc.x - 13, mc.y - 6 - 13, 26, 26);
  graphics_fill_radial(ctx, cradle, GOvalScaleModeFitCircle, 3,
                       DEG_TO_TRIGANGLE(100), DEG_TO_TRIGANGLE(260));
  // Stem + base.
  graphics_fill_rect(ctx, GRect(mc.x - 2, mc.y + 7, 4, 9), 0, GCornerNone);
  graphics_fill_rect(ctx, GRect(mc.x - 9, mc.y + 16, 18, 4), 2, GCornersAll);
}

static void prv_draw_centered_text(GContext *ctx, const char *text, GFont font,
                                   GColor color, int y, int h, int w) {
  graphics_context_set_text_color(ctx, color);
  graphics_draw_text(ctx, text, font, GRect(0, y, w, h),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
}

static void prv_voice_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  int w = bounds.size.w;
  int h = bounds.size.h;

  graphics_context_set_fill_color(ctx, COLOR_BG);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  GFont f_title = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  GFont f_state = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  GFont f_hint = fonts_get_system_font(FONT_KEY_GOTHIC_18);
  GFont f_body = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);

  // Error state takes over the whole scene.
  if (s_state == STATE_ERROR) {
    prv_draw_centered_text(ctx, "Error", f_state, COLOR_ERR, PBL_IF_ROUND_ELSE(30, 20), 30, w);
    graphics_context_set_text_color(ctx, COLOR_BODY_TXT);
    graphics_draw_text(ctx, s_error_buf, f_hint, GRect(8, h / 2 - 30, w - 16, h / 2),
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
    return;
  }

  GPoint mc = GPoint(w / 2, h / 2 - 4);

  // Listening: sonar rings pulsing outward.
  if (s_state == STATE_LISTENING) {
    graphics_context_set_stroke_color(ctx, COLOR_ACCENT);
    graphics_context_set_stroke_width(ctx, 2);
    for (int i = 0; i < RING_COUNT; i++) {
      int span = RING_MAX - RING_MIN;
      int r = RING_MIN + ((s_anim_phase + i * (span / RING_COUNT)) % span);
      graphics_draw_circle(ctx, mc, r);
    }
  }

  // Thinking: an amber arc orbiting the mic.
  if (s_state == STATE_THINKING) {
    int sr = 40;
    GRect orbit = GRect(mc.x - sr, mc.y - sr, 2 * sr, 2 * sr);
    int start = (s_anim_phase * 8) % 360;
    graphics_context_set_fill_color(ctx, COLOR_THINK);
    graphics_fill_radial(ctx, orbit, GOvalScaleModeFitCircle, 4,
                         DEG_TO_TRIGANGLE(start), DEG_TO_TRIGANGLE(start + 90));
  }

  prv_draw_mic(ctx, mc, COLOR_ACCENT);

  prv_draw_centered_text(ctx, "MURMUR", f_title, COLOR_TITLE, PBL_IF_ROUND_ELSE(14, 8), 22, w);

  const char *hint = "Press SELECT to talk";
  GColor hint_color = COLOR_HINT;
  GFont hint_font = f_hint;
  if (s_state == STATE_LISTENING) { hint = "Listening..."; hint_color = COLOR_ACCENT; hint_font = f_body; }
  else if (s_state == STATE_THINKING) { hint = "Thinking..."; hint_color = COLOR_THINK; hint_font = f_body; }
  prv_draw_centered_text(ctx, hint, hint_font, hint_color, h - PBL_IF_ROUND_ELSE(40, 32), 26, w);
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

static void prv_anim_tick(void *ctx) {
  s_anim_phase = (s_anim_phase + 1) % 1000000;
  layer_mark_dirty(s_voice_layer);
  if (s_state == STATE_LISTENING || s_state == STATE_THINKING) {
    s_anim_timer = app_timer_register(ANIM_INTERVAL_MS, prv_anim_tick, NULL);
  } else {
    s_anim_timer = NULL;
  }
}

static void prv_start_anim(void) {
  if (!s_anim_timer) {
    s_anim_timer = app_timer_register(ANIM_INTERVAL_MS, prv_anim_tick, NULL);
  }
}

static void prv_set_state(AppState state) {
  s_state = state;
  bool show_response = (state == STATE_RESPONSE);
  layer_set_hidden(scroll_layer_get_layer(s_scroll_layer), !show_response);
  layer_set_hidden(s_voice_layer, show_response);

  if (state == STATE_LISTENING || state == STATE_THINKING) {
    prv_start_anim();
  }
  if (!show_response) {
    layer_mark_dirty(s_voice_layer);
  }
}

// ---------------------------------------------------------------------------
// AppMessage
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Audio playback (read aloud)
// ---------------------------------------------------------------------------

// Push as much of the pending buffer to the speaker as it will accept.
static void prv_audio_drain(void) {
  if (!s_audio_open || s_audio_pending_len == 0) {
    return;
  }
  uint32_t written = speaker_stream_write(s_audio_pending, s_audio_pending_len);
  if (written > 0) {
    if (written < s_audio_pending_len) {
      memmove(s_audio_pending, s_audio_pending + written, s_audio_pending_len - written);
    }
    s_audio_pending_len -= written;
  }
}

// Periodic tick to keep feeding the speaker as its buffer frees, and to close
// once the phone signalled the end and everything has drained.
static void prv_audio_tick(void *ctx) {
  s_audio_timer = NULL;
  if (!s_audio_open) {
    return;
  }
  prv_audio_drain();
  if (s_audio_closing && s_audio_pending_len == 0) {
    speaker_stream_close();
    s_audio_open = false;
    return;
  }
  s_audio_timer = app_timer_register(30, prv_audio_tick, NULL);
}

static void prv_audio_open(void) {
  if (s_audio_open) {
    speaker_stream_close();
    s_audio_open = false;
  }
  s_audio_pending_len = 0;
  s_audio_closing = false;
  // The phone always sends 8 kHz / 8-bit signed mono (lowest Bluetooth load).
  s_audio_open = speaker_stream_open(SpeakerPcmFormat_8kHz_8bit, 80);
  if (s_audio_open && !s_audio_timer) {
    s_audio_timer = app_timer_register(30, prv_audio_tick, NULL);
  }
}

static void prv_audio_chunk(const uint8_t *data, size_t len) {
  if (!s_audio_open || !data) {
    return;
  }
  prv_audio_drain();   // free space first
  if (s_audio_pending_len + len > AUDIO_PENDING_MAX) {
    size_t room = AUDIO_PENDING_MAX - s_audio_pending_len;
    len = (len > room) ? room : len;   // drop overflow (BT is the bottleneck, rare)
  }
  if (len > 0) {
    memcpy(s_audio_pending + s_audio_pending_len, data, len);
    s_audio_pending_len += len;
  }
  prv_audio_drain();
}

static void prv_audio_end(void) {
  s_audio_closing = true;   // the tick drains the tail, then closes
}

static void prv_send_transcript(const char *text) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    snprintf(s_error_buf, sizeof(s_error_buf), "Phone busy, try again.");
    prv_set_state(STATE_ERROR);
    return;
  }
  dict_write_cstring(iter, MESSAGE_KEY_transcript, text);
  app_message_outbox_send();
}

static void prv_inbox_received(DictionaryIterator *iter, void *context) {
  // Audio (read-aloud) stream: rate/bits open it, chunks feed it, end closes it.
  Tuple *arate_t = dict_find(iter, MESSAGE_KEY_audioRate);
  Tuple *achunk_t = dict_find(iter, MESSAGE_KEY_audioChunk);
  Tuple *aend_t = dict_find(iter, MESSAGE_KEY_audioEnd);
  if (arate_t || achunk_t || aend_t) {
    if (arate_t) { prv_audio_open(); }
    if (achunk_t) { prv_audio_chunk(achunk_t->value->data, achunk_t->length); }
    if (aend_t) { prv_audio_end(); }
    return;
  }

  Tuple *error_t = dict_find(iter, MESSAGE_KEY_error);
  if (error_t) {
    strncpy(s_error_buf, error_t->value->cstring, sizeof(s_error_buf) - 1);
    s_error_buf[sizeof(s_error_buf) - 1] = '\0';
    prv_set_state(STATE_ERROR);
    return;
  }

  Tuple *response_t = dict_find(iter, MESSAGE_KEY_response);
  if (response_t) {
    Tuple *index_t = dict_find(iter, MESSAGE_KEY_chunkIndex);
    Tuple *total_t = dict_find(iter, MESSAGE_KEY_chunkTotal);
    int32_t index = index_t ? index_t->value->int32 : 0;
    int32_t total = total_t ? total_t->value->int32 : 1;

    if (index == 0) {
      prv_reset_response();
      prv_set_state(STATE_RESPONSE);
    }
    prv_append_response(response_t->value->cstring);
    prv_layout_response();
    (void) total;
    return;
  }

  Tuple *status_t = dict_find(iter, MESSAGE_KEY_status);
  if (status_t) {
    switch (status_t->value->int32) {
      case STATUS_THINKING:
        if (s_state != STATE_RESPONSE) { prv_set_state(STATE_THINKING); }
        break;
      case STATUS_ERROR:
        break;  // a descriptive error message follows separately
      case STATUS_IDLE:
      default:
        break;
    }
  }
}

static void prv_inbox_dropped(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "inbox dropped: %d", (int) reason);
}

static void prv_outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  snprintf(s_error_buf, sizeof(s_error_buf), "Couldn't reach the phone.");
  prv_set_state(STATE_ERROR);
}

// ---------------------------------------------------------------------------
// Dictation
// ---------------------------------------------------------------------------

static void prv_dictation_callback(DictationSession *session, DictationSessionStatus status,
                                   char *transcription, void *context) {
  if (status == DictationSessionStatusSuccess) {
    prv_reset_response();
    prv_set_state(STATE_THINKING);
    prv_send_transcript(transcription);
  } else {
    prv_set_state(STATE_IDLE);
  }
}

static void prv_start_dictation(void) {
#if defined(PBL_MICROPHONE)
  if (s_dictation_session) {
    prv_set_state(STATE_LISTENING);
    dictation_session_start(s_dictation_session);
  } else {
    snprintf(s_error_buf, sizeof(s_error_buf), "No microphone on this watch.");
    prv_set_state(STATE_ERROR);
  }
#else
  snprintf(s_error_buf, sizeof(s_error_buf), "No microphone on this watch.");
  prv_set_state(STATE_ERROR);
#endif
}

// ---------------------------------------------------------------------------
// Clicks
// ---------------------------------------------------------------------------

static void prv_select_click_handler(ClickRecognizerRef recognizer, void *context) {
  prv_start_dictation();
}

// UP / DOWN scroll the reply. We drive the ScrollLayer manually instead of
// scroll_layer_set_click_config_onto_window(), because that call would hijack
// the window's click config and kill SELECT (dictation).
static void prv_up_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_state != STATE_RESPONSE) { return; }
  GPoint o = scroll_layer_get_content_offset(s_scroll_layer);
  o.y += 60;
  if (o.y > 0) { o.y = 0; }
  scroll_layer_set_content_offset(s_scroll_layer, o, true);
}

static void prv_down_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_state != STATE_RESPONSE) { return; }
  GPoint o = scroll_layer_get_content_offset(s_scroll_layer);
  o.y -= 60;  // ScrollLayer clamps to the content size
  scroll_layer_set_content_offset(s_scroll_layer, o, true);
}

static void prv_back_click_handler(ClickRecognizerRef recognizer, void *context) {
  // From a reply or an error, BACK returns home rather than leaving the app.
  if (s_state == STATE_RESPONSE || s_state == STATE_ERROR) {
    prv_set_state(STATE_IDLE);
    return;
  }
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) == APP_MSG_OK) {
    dict_write_int8(iter, MESSAGE_KEY_command, CMD_RESET);
    app_message_outbox_send();
  }
  window_stack_pop_all(true);
}

static void prv_click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, prv_select_click_handler);
  window_single_click_subscribe(BUTTON_ID_BACK, prv_back_click_handler);
  window_single_click_subscribe(BUTTON_ID_UP, prv_up_click_handler);
  window_single_click_subscribe(BUTTON_ID_DOWN, prv_down_click_handler);
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

static void prv_window_load(Window *window) {
  window_set_background_color(window, COLOR_BG);

  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);

  s_voice_layer = layer_create(bounds);
  layer_set_update_proc(s_voice_layer, prv_voice_update_proc);
  layer_add_child(root, s_voice_layer);

  s_scroll_layer = scroll_layer_create(bounds);
  s_response_layer = text_layer_create(GRect(6, 6, bounds.size.w - 12, bounds.size.h));
  text_layer_set_background_color(s_response_layer, GColorClear);
  text_layer_set_text_color(s_response_layer, COLOR_BODY_TXT);
  text_layer_set_font(s_response_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD));
  text_layer_set_overflow_mode(s_response_layer, GTextOverflowModeWordWrap);
  text_layer_set_text(s_response_layer, "");
  scroll_layer_add_child(s_scroll_layer, text_layer_get_layer(s_response_layer));
  scroll_layer_set_content_size(s_scroll_layer, bounds.size);
  layer_add_child(root, scroll_layer_get_layer(s_scroll_layer));

  prv_set_state(STATE_IDLE);
}

static void prv_window_unload(Window *window) {
  text_layer_destroy(s_response_layer);
  scroll_layer_destroy(s_scroll_layer);
  layer_destroy(s_voice_layer);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

static void prv_init(void) {
  prv_load_state();

  app_message_register_inbox_received(prv_inbox_received);
  app_message_register_inbox_dropped(prv_inbox_dropped);
  app_message_register_outbox_failed(prv_outbox_failed);
  // Inbox sized well above CHUNK_BYTES (1000) in the JS sender; generous outbox
  // for long dictated transcripts.
  app_message_open(4096, 2048);

#if defined(PBL_MICROPHONE)
  s_dictation_session = dictation_session_create(0, prv_dictation_callback, NULL);
#endif

  s_window = window_create();
  window_set_click_config_provider(s_window, prv_click_config_provider);
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = prv_window_load,
    .unload = prv_window_unload,
  });
  window_stack_push(s_window, true);
}

static void prv_deinit(void) {
  if (s_anim_timer) {
    app_timer_cancel(s_anim_timer);
    s_anim_timer = NULL;
  }
  if (s_audio_timer) {
    app_timer_cancel(s_audio_timer);
    s_audio_timer = NULL;
  }
  if (s_audio_open) {
    speaker_stream_close();
    s_audio_open = false;
  }
#if defined(PBL_MICROPHONE)
  if (s_dictation_session) {
    dictation_session_destroy(s_dictation_session);
  }
#endif
  if (s_response_buf) {
    free(s_response_buf);
    s_response_buf = NULL;
  }
  window_destroy(s_window);
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}
