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

char *genieterm_poll_screen_text(GenieTermHandle *handle);
char *genieterm_poll_snapshot_json(GenieTermHandle *handle);
void genieterm_free_string(char *value);

uint16_t genieterm_cursor_row(GenieTermHandle *handle);
uint16_t genieterm_cursor_col(GenieTermHandle *handle);
uint16_t genieterm_rows(GenieTermHandle *handle);
uint16_t genieterm_cols(GenieTermHandle *handle);

#ifdef __cplusplus
}
#endif

#endif
