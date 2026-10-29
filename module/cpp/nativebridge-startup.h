#pragma once
#include <cstring>

// Gemini's libnb loader needs a longer settling period before loading the ARM
// payload. Delaying only the later scanner hooks did not fix its cold startup.
// Keep other bridges at their existing delay; physical ARM devices do not use
// NativeBridgeLoad. This does not inspect or change game authentication state.
static inline unsigned nativebridge_startup_seconds(const char *library) {
    return library && std::strcmp(library, "libnb.so") == 0 ? 30u : 5u;
}
