#ifndef GENIETERM_FFI_H
#define GENIETERM_FFI_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct GenieTermHandle {
    void *opaque;
} GenieTermHandle;

GenieTermHandle *genieterm_create(uint16_t cols, uint16_t rows);
void genieterm_destroy(GenieTermHandle *handle);

void genieterm_send_command(GenieTermHandle *handle, const char *command);
void genieterm_send_input(GenieTermHandle *handle, const unsigned char *data, size_t len);

void genieterm_resize(GenieTermHandle *handle, uint16_t cols, uint16_t rows);

char *genieterm_poll_snapshot_json(GenieTermHandle *handle);
char *genieterm_recent_scrollback_json(GenieTermHandle *handle, size_t limit);
uint64_t genieterm_snapshot_version(GenieTermHandle *handle);
uint8_t genieterm_bracketed_paste_enabled(GenieTermHandle *handle);
uint8_t genieterm_mouse_tracking_mode(GenieTermHandle *handle);
uint8_t genieterm_mouse_sgr_enabled(GenieTermHandle *handle);
uint8_t genieterm_focus_reporting_enabled(GenieTermHandle *handle);
void genieterm_free_string(char *value);

#ifdef __cplusplus
}
#endif

#endif
