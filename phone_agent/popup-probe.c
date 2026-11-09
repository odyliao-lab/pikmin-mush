/* Read-only classifier for calibrated Traditional Chinese Pikmin notices.
 * No OCR guesses, network, Android input or account data. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { int x, y, r, g, b; } PopupSample;
typedef struct {
    const char *kind;
    int width, height, x, y;
    const PopupSample *frame, *text, *button;
    size_t frame_count, text_count, button_count;
} PopupTemplate;
#include "popup-templates.h"

static int matches(const unsigned char *pixels, uint32_t width, uint32_t height,
                   const PopupSample *samples, size_t count, int dy) {
    if (count < 12) return 0;
    for (size_t i = 0; i < count; ++i) {
        PopupSample s = samples[i];
        int y = s.y + dy;
        if (s.x < 0 || (uint32_t)s.x >= width || y < 0 || (uint32_t)y >= height) return 0;
        size_t k = ((size_t)y * width + (size_t)s.x) * 4;
        if (abs((int)pixels[k] - s.r) > 24 ||
            abs((int)pixels[k+1] - s.g) > 24 ||
            abs((int)pixels[k+2] - s.b) > 24) return 0;
    }
    return 1;
}

int main(int argc, char **argv) {
    FILE *file = argc == 2 ? (!strcmp(argv[1], "-") ? stdin : fopen(argv[1], "rb")) : NULL;
    if (!file) { puts("unknown"); return 0; }
    uint32_t h[4];
    if (fread(h, sizeof(uint32_t), 4, file) != 4 || h[2] != 1 ||
        !((h[0] == 1080 && (h[1] == 1920 || h[1] == 2160 || h[1] == 2400)) ||
          (h[0] == 1440 && h[1] == 3120))) {
        fclose(file); puts("unknown"); return 0;
    }
    size_t n = (size_t)h[0] * h[1] * 4;
    unsigned char *pixels = malloc(n);
    if (!pixels || fread(pixels, 1, n, file) != n || fgetc(file) != EOF) {
        free(pixels); fclose(file); puts("unknown"); return 0;
    }
    fclose(file);
    const PopupTemplate *found = NULL;
    int found_y = 0, ambiguous = 0;
    for (size_t i = 0; i < sizeof(popup_templates)/sizeof(popup_templates[0]); ++i) {
        const PopupTemplate *t = &popup_templates[i];
        if (t->width != (int)h[0]) continue;
        int fixed = !strcmp(t->kind, "dashboard") ||
                    !strcmp(t->kind, "recap") || !strcmp(t->kind, "recapmood") ||
                    !strcmp(t->kind, "announcement");
        if (fixed && t->height != (int)h[1]) continue;
        /* Notices may move with navigation-bar insets; all three independent
         * control/text groups must agree at the SAME translation. */
        int center = fixed ? 0 : ((int)h[1] - t->height)/2;
        int range = fixed ? 0 : 24;
        for (int dy = center-range; dy <= center+range; ++dy) {
            if (!matches(pixels,h[0],h[1],t->frame,t->frame_count,dy) ||
                !matches(pixels,h[0],h[1],t->text,t->text_count,dy) ||
                !matches(pixels,h[0],h[1],t->button,t->button_count,dy)) continue;
            if (found && (strcmp(found->kind,t->kind) || found->x != t->x || found_y != t->y+dy)) ambiguous = 1;
            found = t; found_y = t->y + dy;
        }
    }
    if (found && !ambiguous) printf("%s %d %d\n", found->kind, found->x, found_y);
    else puts("unknown");
    free(pixels);
    return 0;
}
