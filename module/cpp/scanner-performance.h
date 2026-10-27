#pragma once
#include <cstdio>
#include <cstring>

// Deliberately small allowlist; missing, malformed and trailing data opt out.
inline int scanner_render_fps(FILE *file) {
    if (!file) return 0;
    char value[32] = {};
    size_t n = fread(value, 1, sizeof(value)-1, file);
    if (fgetc(file) != EOF || ferror(file) || memchr(value,0,n)) return 0;
    while (n && (value[n-1]=='\n' || value[n-1]=='\r' || value[n-1]==' ')) value[--n]=0;
    if (!strcmp(value,"15")) return 15;
    if (!strcmp(value,"20")) return 20;
    if (!strcmp(value,"30")) return 30;
    return 0;
}
