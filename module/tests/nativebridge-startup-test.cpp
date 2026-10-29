#include "../cpp/nativebridge-startup.h"
#include <cassert>

int main() {
    assert(nativebridge_startup_seconds("libnb.so") == 30);
    const char *others[] = {nullptr, "", "libhoudini.so", "libndk_translation.so",
                           "libnb.so.extra", "/system/lib64/libnb.so"};
    for (const char *name : others) {
        assert(nativebridge_startup_seconds(name) == 5);
    }
}
