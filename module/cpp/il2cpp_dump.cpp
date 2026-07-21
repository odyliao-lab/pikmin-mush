//
// Created by Perfare on 2020/7/4.
//

#include "il2cpp_dump.h"
#include <dlfcn.h>
#include <cstdlib>
#include <cstring>
#include <cinttypes>
#include <string>
#include <vector>
#include <sstream>
#include <fstream>
#include <unistd.h>
#include "xdl.h"
#include "log.h"
#include "il2cpp-tabledefs.h"
#include "il2cpp-class.h"
#include "And64InlineHook.hpp"

#define DO_API(r, n, p) r (*n) p

#include "il2cpp-api-functions.h"

#undef DO_API

static uint64_t il2cpp_base = 0;

void init_il2cpp_api(void *handle) {
#define DO_API(r, n, p) {                      \
    n = (r (*) p)xdl_sym(handle, #n, nullptr); \
    if(!n) {                                   \
        LOGW("api not found %s", #n);          \
    }                                          \
}

#include "il2cpp-api-functions.h"

#undef DO_API
}

std::string get_method_modifier(uint32_t flags) {
    std::stringstream outPut;
    auto access = flags & METHOD_ATTRIBUTE_MEMBER_ACCESS_MASK;
    switch (access) {
        case METHOD_ATTRIBUTE_PRIVATE:
            outPut << "private ";
            break;
        case METHOD_ATTRIBUTE_PUBLIC:
            outPut << "public ";
            break;
        case METHOD_ATTRIBUTE_FAMILY:
            outPut << "protected ";
            break;
        case METHOD_ATTRIBUTE_ASSEM:
        case METHOD_ATTRIBUTE_FAM_AND_ASSEM:
            outPut << "internal ";
            break;
        case METHOD_ATTRIBUTE_FAM_OR_ASSEM:
            outPut << "protected internal ";
            break;
    }
    if (flags & METHOD_ATTRIBUTE_STATIC) {
        outPut << "static ";
    }
    if (flags & METHOD_ATTRIBUTE_ABSTRACT) {
        outPut << "abstract ";
        if ((flags & METHOD_ATTRIBUTE_VTABLE_LAYOUT_MASK) == METHOD_ATTRIBUTE_REUSE_SLOT) {
            outPut << "override ";
        }
    } else if (flags & METHOD_ATTRIBUTE_FINAL) {
        if ((flags & METHOD_ATTRIBUTE_VTABLE_LAYOUT_MASK) == METHOD_ATTRIBUTE_REUSE_SLOT) {
            outPut << "sealed override ";
        }
    } else if (flags & METHOD_ATTRIBUTE_VIRTUAL) {
        if ((flags & METHOD_ATTRIBUTE_VTABLE_LAYOUT_MASK) == METHOD_ATTRIBUTE_NEW_SLOT) {
            outPut << "virtual ";
        } else {
            outPut << "override ";
        }
    }
    if (flags & METHOD_ATTRIBUTE_PINVOKE_IMPL) {
        outPut << "extern ";
    }
    return outPut.str();
}

bool _il2cpp_type_is_byref(const Il2CppType *type) {
    auto byref = type->byref;
    if (il2cpp_type_is_byref) {
        byref = il2cpp_type_is_byref(type);
    }
    return byref;
}

std::string dump_method(Il2CppClass *klass) {
    std::stringstream outPut;
    outPut << "\n\t// Methods\n";
    void *iter = nullptr;
    while (auto method = il2cpp_class_get_methods(klass, &iter)) {
        //TODO attribute
        if (method->methodPointer) {
            outPut << "\t// RVA: 0x";
            outPut << std::hex << (uint64_t) method->methodPointer - il2cpp_base;
            outPut << " VA: 0x";
            outPut << std::hex << (uint64_t) method->methodPointer;
        } else {
            outPut << "\t// RVA: 0x VA: 0x0";
        }
        /*if (method->slot != 65535) {
            outPut << " Slot: " << std::dec << method->slot;
        }*/
        outPut << "\n\t";
        uint32_t iflags = 0;
        auto flags = il2cpp_method_get_flags(method, &iflags);
        outPut << get_method_modifier(flags);
        //TODO genericContainerIndex
        auto return_type = il2cpp_method_get_return_type(method);
        if (_il2cpp_type_is_byref(return_type)) {
            outPut << "ref ";
        }
        auto return_class = il2cpp_class_from_type(return_type);
        outPut << il2cpp_class_get_name(return_class) << " " << il2cpp_method_get_name(method)
               << "(";
        auto param_count = il2cpp_method_get_param_count(method);
        for (int i = 0; i < param_count; ++i) {
            auto param = il2cpp_method_get_param(method, i);
            auto attrs = param->attrs;
            if (_il2cpp_type_is_byref(param)) {
                if (attrs & PARAM_ATTRIBUTE_OUT && !(attrs & PARAM_ATTRIBUTE_IN)) {
                    outPut << "out ";
                } else if (attrs & PARAM_ATTRIBUTE_IN && !(attrs & PARAM_ATTRIBUTE_OUT)) {
                    outPut << "in ";
                } else {
                    outPut << "ref ";
                }
            } else {
                if (attrs & PARAM_ATTRIBUTE_IN) {
                    outPut << "[In] ";
                }
                if (attrs & PARAM_ATTRIBUTE_OUT) {
                    outPut << "[Out] ";
                }
            }
            auto parameter_class = il2cpp_class_from_type(param);
            outPut << il2cpp_class_get_name(parameter_class) << " "
                   << il2cpp_method_get_param_name(method, i);
            outPut << ", ";
        }
        if (param_count > 0) {
            outPut.seekp(-2, outPut.cur);
        }
        outPut << ") { }\n";
        //TODO GenericInstMethod
    }
    return outPut.str();
}

std::string dump_property(Il2CppClass *klass) {
    std::stringstream outPut;
    outPut << "\n\t// Properties\n";
    void *iter = nullptr;
    while (auto prop_const = il2cpp_class_get_properties(klass, &iter)) {
        //TODO attribute
        auto prop = const_cast<PropertyInfo *>(prop_const);
        auto get = il2cpp_property_get_get_method(prop);
        auto set = il2cpp_property_get_set_method(prop);
        auto prop_name = il2cpp_property_get_name(prop);
        outPut << "\t";
        Il2CppClass *prop_class = nullptr;
        uint32_t iflags = 0;
        if (get) {
            outPut << get_method_modifier(il2cpp_method_get_flags(get, &iflags));
            prop_class = il2cpp_class_from_type(il2cpp_method_get_return_type(get));
        } else if (set) {
            outPut << get_method_modifier(il2cpp_method_get_flags(set, &iflags));
            auto param = il2cpp_method_get_param(set, 0);
            prop_class = il2cpp_class_from_type(param);
        }
        if (prop_class) {
            outPut << il2cpp_class_get_name(prop_class) << " " << prop_name << " { ";
            if (get) {
                outPut << "get; ";
            }
            if (set) {
                outPut << "set; ";
            }
            outPut << "}\n";
        } else {
            if (prop_name) {
                outPut << " // unknown property " << prop_name;
            }
        }
    }
    return outPut.str();
}

std::string dump_field(Il2CppClass *klass) {
    std::stringstream outPut;
    outPut << "\n\t// Fields\n";
    auto is_enum = il2cpp_class_is_enum(klass);
    void *iter = nullptr;
    while (auto field = il2cpp_class_get_fields(klass, &iter)) {
        //TODO attribute
        outPut << "\t";
        auto attrs = il2cpp_field_get_flags(field);
        auto access = attrs & FIELD_ATTRIBUTE_FIELD_ACCESS_MASK;
        switch (access) {
            case FIELD_ATTRIBUTE_PRIVATE:
                outPut << "private ";
                break;
            case FIELD_ATTRIBUTE_PUBLIC:
                outPut << "public ";
                break;
            case FIELD_ATTRIBUTE_FAMILY:
                outPut << "protected ";
                break;
            case FIELD_ATTRIBUTE_ASSEMBLY:
            case FIELD_ATTRIBUTE_FAM_AND_ASSEM:
                outPut << "internal ";
                break;
            case FIELD_ATTRIBUTE_FAM_OR_ASSEM:
                outPut << "protected internal ";
                break;
        }
        if (attrs & FIELD_ATTRIBUTE_LITERAL) {
            outPut << "const ";
        } else {
            if (attrs & FIELD_ATTRIBUTE_STATIC) {
                outPut << "static ";
            }
            if (attrs & FIELD_ATTRIBUTE_INIT_ONLY) {
                outPut << "readonly ";
            }
        }
        auto field_type = il2cpp_field_get_type(field);
        auto field_class = il2cpp_class_from_type(field_type);
        outPut << il2cpp_class_get_name(field_class) << " " << il2cpp_field_get_name(field);
        //TODO 获取构造函数初始化后的字段值
        if (attrs & FIELD_ATTRIBUTE_LITERAL && is_enum) {
            uint64_t val = 0;
            il2cpp_field_static_get_value(field, &val);
            outPut << " = " << std::dec << val;
        }
        outPut << "; // 0x" << std::hex << il2cpp_field_get_offset(field) << "\n";
    }
    return outPut.str();
}

std::string dump_type(const Il2CppType *type) {
    std::stringstream outPut;
    auto *klass = il2cpp_class_from_type(type);
    outPut << "\n// Namespace: " << il2cpp_class_get_namespace(klass) << "\n";
    auto flags = il2cpp_class_get_flags(klass);
    if (flags & TYPE_ATTRIBUTE_SERIALIZABLE) {
        outPut << "[Serializable]\n";
    }
    //TODO attribute
    auto is_valuetype = il2cpp_class_is_valuetype(klass);
    auto is_enum = il2cpp_class_is_enum(klass);
    auto visibility = flags & TYPE_ATTRIBUTE_VISIBILITY_MASK;
    switch (visibility) {
        case TYPE_ATTRIBUTE_PUBLIC:
        case TYPE_ATTRIBUTE_NESTED_PUBLIC:
            outPut << "public ";
            break;
        case TYPE_ATTRIBUTE_NOT_PUBLIC:
        case TYPE_ATTRIBUTE_NESTED_FAM_AND_ASSEM:
        case TYPE_ATTRIBUTE_NESTED_ASSEMBLY:
            outPut << "internal ";
            break;
        case TYPE_ATTRIBUTE_NESTED_PRIVATE:
            outPut << "private ";
            break;
        case TYPE_ATTRIBUTE_NESTED_FAMILY:
            outPut << "protected ";
            break;
        case TYPE_ATTRIBUTE_NESTED_FAM_OR_ASSEM:
            outPut << "protected internal ";
            break;
    }
    if (flags & TYPE_ATTRIBUTE_ABSTRACT && flags & TYPE_ATTRIBUTE_SEALED) {
        outPut << "static ";
    } else if (!(flags & TYPE_ATTRIBUTE_INTERFACE) && flags & TYPE_ATTRIBUTE_ABSTRACT) {
        outPut << "abstract ";
    } else if (!is_valuetype && !is_enum && flags & TYPE_ATTRIBUTE_SEALED) {
        outPut << "sealed ";
    }
    if (flags & TYPE_ATTRIBUTE_INTERFACE) {
        outPut << "interface ";
    } else if (is_enum) {
        outPut << "enum ";
    } else if (is_valuetype) {
        outPut << "struct ";
    } else {
        outPut << "class ";
    }
    outPut << il2cpp_class_get_name(klass); //TODO genericContainerIndex
    std::vector<std::string> extends;
    auto parent = il2cpp_class_get_parent(klass);
    if (!is_valuetype && !is_enum && parent) {
        auto parent_type = il2cpp_class_get_type(parent);
        if (parent_type->type != IL2CPP_TYPE_OBJECT) {
            extends.emplace_back(il2cpp_class_get_name(parent));
        }
    }
    void *iter = nullptr;
    while (auto itf = il2cpp_class_get_interfaces(klass, &iter)) {
        extends.emplace_back(il2cpp_class_get_name(itf));
    }
    if (!extends.empty()) {
        outPut << " : " << extends[0];
        for (int i = 1; i < extends.size(); ++i) {
            outPut << ", " << extends[i];
        }
    }
    outPut << "\n{";
    outPut << dump_field(klass);
    outPut << dump_property(klass);
    outPut << dump_method(klass);
    //TODO EventInfo
    outPut << "}\n";
    return outPut.str();
}

void il2cpp_api_init(void *handle) {
    LOGI("il2cpp_handle: %p", handle);
    init_il2cpp_api(handle);
    if (il2cpp_domain_get_assemblies) {
        Dl_info dlInfo;
        if (dladdr((void *) il2cpp_domain_get_assemblies, &dlInfo)) {
            il2cpp_base = reinterpret_cast<uint64_t>(dlInfo.dli_fbase);
        }
        LOGI("il2cpp_base: %" PRIx64"", il2cpp_base);
    } else {
        LOGE("Failed to initialize il2cpp api.");
        return;
    }
    // NOTE: 不呼叫 il2cpp_is_vm_thread / il2cpp_thread_attach。
    // 冷啟動時 libil2cpp 已載入但 runtime 未 init 完，呼叫 il2cpp_is_vm_thread 會 SIGSEGV。
    // install_hooks 只需 il2cpp_base + API 指標；API 呼叫發生在 hook 內(遊戲自己的 VM thread)。
}

void il2cpp_dump(const char *outDir) {
    LOGI("dumping...");
    size_t size;
    auto domain = il2cpp_domain_get();
    auto assemblies = il2cpp_domain_get_assemblies(domain, &size);
    std::stringstream imageOutput;
    for (int i = 0; i < size; ++i) {
        auto image = il2cpp_assembly_get_image(assemblies[i]);
        imageOutput << "// Image " << i << ": " << il2cpp_image_get_name(image) << "\n";
    }
    std::vector<std::string> outPuts;
    if (il2cpp_image_get_class) {
        LOGI("Version greater than 2018.3");
        //使用il2cpp_image_get_class
        for (int i = 0; i < size; ++i) {
            auto image = il2cpp_assembly_get_image(assemblies[i]);
            std::stringstream imageStr;
            imageStr << "\n// Dll : " << il2cpp_image_get_name(image);
            auto classCount = il2cpp_image_get_class_count(image);
            for (int j = 0; j < classCount; ++j) {
                auto klass = il2cpp_image_get_class(image, j);
                auto type = il2cpp_class_get_type(const_cast<Il2CppClass *>(klass));
                //LOGD("type name : %s", il2cpp_type_get_name(type));
                auto outPut = imageStr.str() + dump_type(type);
                outPuts.push_back(outPut);
            }
        }
    } else {
        LOGI("Version less than 2018.3");
        //使用反射
        auto corlib = il2cpp_get_corlib();
        auto assemblyClass = il2cpp_class_from_name(corlib, "System.Reflection", "Assembly");
        auto assemblyLoad = il2cpp_class_get_method_from_name(assemblyClass, "Load", 1);
        auto assemblyGetTypes = il2cpp_class_get_method_from_name(assemblyClass, "GetTypes", 0);
        if (assemblyLoad && assemblyLoad->methodPointer) {
            LOGI("Assembly::Load: %p", assemblyLoad->methodPointer);
        } else {
            LOGI("miss Assembly::Load");
            return;
        }
        if (assemblyGetTypes && assemblyGetTypes->methodPointer) {
            LOGI("Assembly::GetTypes: %p", assemblyGetTypes->methodPointer);
        } else {
            LOGI("miss Assembly::GetTypes");
            return;
        }
        typedef void *(*Assembly_Load_ftn)(void *, Il2CppString *, void *);
        typedef Il2CppArray *(*Assembly_GetTypes_ftn)(void *, void *);
        for (int i = 0; i < size; ++i) {
            auto image = il2cpp_assembly_get_image(assemblies[i]);
            std::stringstream imageStr;
            auto image_name = il2cpp_image_get_name(image);
            imageStr << "\n// Dll : " << image_name;
            //LOGD("image name : %s", image->name);
            auto imageName = std::string(image_name);
            auto pos = imageName.rfind('.');
            auto imageNameNoExt = imageName.substr(0, pos);
            auto assemblyFileName = il2cpp_string_new(imageNameNoExt.data());
            auto reflectionAssembly = ((Assembly_Load_ftn) assemblyLoad->methodPointer)(nullptr,
                                                                                        assemblyFileName,
                                                                                        nullptr);
            auto reflectionTypes = ((Assembly_GetTypes_ftn) assemblyGetTypes->methodPointer)(
                    reflectionAssembly, nullptr);
            auto items = reflectionTypes->vector;
            for (int j = 0; j < reflectionTypes->max_length; ++j) {
                auto klass = il2cpp_class_from_system_type((Il2CppReflectionType *) items[j]);
                auto type = il2cpp_class_get_type(klass);
                //LOGD("type name : %s", il2cpp_type_get_name(type));
                auto outPut = imageStr.str() + dump_type(type);
                outPuts.push_back(outPut);
            }
        }
    }
    LOGI("write dump file");
    auto outPath = std::string(outDir).append("/files/dump.cs");
    std::ofstream outStream(outPath);
    outStream << imageOutput.str();
    auto count = outPuts.size();
    for (int i = 0; i < count; ++i) {
        outStream << outPuts[i];
    }
    outStream.close();
    LOGI("dump done!");
}

// ==================== Mushroom hook ====================
#include <cstdio>
#include <ctime>
#include <map>

// Pikmin Bloom v149.0 / versionCode 1784082813.
// These RVAs and prologue signatures are version-locked. Refuse to install any hook
// when the loaded libil2cpp does not match, so a future game update fails closed
// instead of patching an unrelated function.
#define TARGET_PIKMIN_VERSION "149.0"
#define TARGET_PIKMIN_VERSION_CODE 1784082813
#define RVA_RegisterMapObject 0xCBCF00C
#define RVA_LocationController_Update 0x704C184
#define RVA_SetOverride 0x704C9DC
#define RVA_MapQueryManager_OnMapQueryResponse 0xC8D8D78

static const uint8_t SIG_RegisterMapObject[] = {
    0xFE, 0x67, 0xBC, 0xA9, 0xF8, 0x5F, 0x01, 0xA9,
    0xF6, 0x57, 0x02, 0xA9, 0xF4, 0x4F, 0x03, 0xA9
};
static const uint8_t SIG_LocationController_Update[] = {
    0xFF, 0x03, 0x03, 0xD1, 0xE8, 0x3B, 0x00, 0xFD,
    0xFE, 0x67, 0x08, 0xA9, 0xF8, 0x5F, 0x09, 0xA9
};
static const uint8_t SIG_SetOverride[] = {
    0xFF, 0xC3, 0x01, 0xD1, 0xFE, 0x23, 0x00, 0xF9,
    0xF6, 0x57, 0x05, 0xA9, 0xF4, 0x4F, 0x06, 0xA9
};
static const uint8_t SIG_MapQueryManager_OnMapQueryResponse[] = {
    0xFE, 0x5F, 0xBD, 0xA9, 0xF6, 0x57, 0x01, 0xA9,
    0xF4, 0x4F, 0x02, 0xA9, 0xB5, 0x3A, 0x01, 0xD0
};

static bool matches_target_signature(const char *name, const void *target,
                                     const uint8_t *expected, size_t expected_size) {
    if (!target || memcmp(target, expected, expected_size) != 0) {
        LOGE("[HOOK] %s signature mismatch; expected Pikmin %s (%d), refusing hooks",
             name, TARGET_PIKMIN_VERSION, TARGET_PIKMIN_VERSION_CODE);
        return false;
    }
    return true;
}
// ProtoBasedMapObject.initialMapObjectProto (raw MapObjectProto*) @0x68
#define OFF_ProtoPtr 0x68
// MapObjectProto: id_@0x18(string), point_@0x20(PointProto*), object_@0x30(oneof*), objectCase_@0x38(int)
#define OFF_Proto_Id 0x18
#define OFF_Proto_Point 0x20
#define OFF_Proto_Object 0x30
#define OFF_Proto_ObjectCase 0x38
// PointProto: latDegrees_@0x18, lngDegrees_@0x20
#define OFF_Point_Lat 0x18
#define OFF_Point_Lng 0x20
// PoiMushroomProto: overrideCooldownSeconds_@0x28(int), mushroomClusterId_@0x30(string)
#define OFF_Mush_Cooldown 0x28
#define OFF_Mush_Cluster 0x30
#define OBJCASE_PoiMushroom 22

static char g_mush_path[512] = {0};    // 每次寫入才開檔，避免外部 rm 造成寫入遺失
static char g_scan_ready_path[512] = {0};
static char g_query_ready_path[512] = {0};
static volatile double g_cur_lat = 0, g_cur_lng = 0;
static volatile bool g_have_target = false;
static volatile bool g_refresh_pending = false;
static volatile long long g_target_token = 0;
static volatile long long g_applied_token = -1;
static volatile long long g_query_written_token = -1;
static long long g_generated_token = 0;
static void *g_map_manager = nullptr;
static const MethodInfo *g_recalculate_viewports_method = nullptr;

static void write_refresh_marker(const char *path, long long token, const char *reason) {
    if (!path[0] || token <= 0) return;
    FILE *f = fopen(path, "w");
    if (!f) return;
    fprintf(f, "%lld\t%s\t%.7f\t%.7f\t%ld\n",
            token, reason, g_cur_lat, g_cur_lng, (long) time(nullptr));
    fclose(f);
}

static bool near_current_target(double lat, double lng) {
    // Map queries cover a wider area than the 400 m mushroom display radius.
    // A two-degree-hundredth window rejects objects left over from the prior city
    // while accepting the first object batch around the new target.
    double lat_diff = lat - g_cur_lat;
    double lng_diff = lng - g_cur_lng;
    if (lat_diff < 0) lat_diff = -lat_diff;
    if (lng_diff < 0) lng_diff = -lng_diff;
    return lat_diff <= 0.02 && lng_diff <= 0.03;
}

static void capture_map_manager(void *thiz) {
    if (g_map_manager || !thiz) return;
    Il2CppClass *klass = il2cpp_object_get_class((Il2CppObject *) thiz);
    const char *name = klass ? il2cpp_class_get_name(klass) : nullptr;
    if (!name || strcmp(name, "MapManager") != 0) return;
    const MethodInfo *recalculate = il2cpp_class_get_method_from_name(
        klass, "InternalRequestRecalculateViewportGroups", 2);
    if (!recalculate) {
        LOGW("[REFRESH] MapManager viewport recalculation metadata unavailable");
        return;
    }
    g_map_manager = thiz;
    g_recalculate_viewports_method = recalculate;
    LOGI("[REFRESH] captured MapManager this=%p", thiz);
}

struct SeenMushroom {
    long long finish_ms;
    long logged_at;
    int challenger_count;
    double total_power;
};
// 相同 ID 若 finishMs 改變（重生/刷新）立即重記；最遲每 10 分鐘重記一次，
// 避免永久 g_seen 讓 scanner 永遠收不到同一 POI 的新狀態。
static std::map<std::string, SeenMushroom> g_seen;

// 讀 il2cpp C# string (Il2CppString: length@0x10, UTF-16 chars@0x14)
static void read_cs_string(void *s, char *out, size_t outsz) {
    out[0] = 0;
    if (!s) return;
    int len = *(int *) ((uint8_t *) s + 0x10);
    if (len <= 0 || (size_t) len > outsz - 1) len = (int) (outsz - 1);
    auto *chars = (uint16_t *) ((uint8_t *) s + 0x14);
    size_t j = 0;
    for (int i = 0; i < len && j < outsz - 1; i++) {
        uint16_t c = chars[i];
        out[j++] = (c < 128) ? (char) c : '?';
    }
    out[j] = 0;
}

typedef void (*RegisterMapObject_t)(void *thiz, void *obj, void *method);
static RegisterMapObject_t orig_RegisterMapObject = nullptr;

static void hooked_RegisterMapObject(void *thiz, void *obj, void *method) {
    capture_map_manager(thiz);
    if (obj) {
        const char *cname = "?";
        if (il2cpp_object_get_class && il2cpp_class_get_name) {
            auto klass = il2cpp_object_get_class((Il2CppObject *) obj);
            if (klass) cname = il2cpp_class_get_name(klass);
        }
        // 只處理蘑菇 (MapPoiBlocker)
        if (cname && strcmp(cname, "MapPoiBlocker") == 0) {
            void *proto = *(void **) ((uint8_t *) obj + OFF_ProtoPtr);
            if (proto) {
                char id[128];
                read_cs_string(*(void **) ((uint8_t *) proto + OFF_Proto_Id), id, sizeof(id));
                void *point = *(void **) ((uint8_t *) proto + OFF_Proto_Point);
                double lat = point ? *(double *) ((uint8_t *) point + OFF_Point_Lat) : 0;
                double lng = point ? *(double *) ((uint8_t *) point + OFF_Point_Lng) : 0;
                if (g_refresh_pending && point && near_current_target(lat, lng)) {
                    long long token = g_target_token;
                    write_refresh_marker(g_scan_ready_path, token, "object");
                    g_refresh_pending = false;
                    LOGI("[REFRESH] target=%lld ready from map object %.7f,%.7f",
                         token, lat, lng);
                }
                int objCase = *(int *) ((uint8_t *) proto + OFF_Proto_ObjectCase);
                char cluster[128] = "";
                int cooldown = 0, level = 0, ctype = 0;
                int challengerCount = 0, challengerCapacity = 0;
                long long startMs = 0, finishMs = 0;
                double totalPower = 0;
                if (objCase == OBJCASE_PoiMushroom) {
                    void *mush = *(void **) ((uint8_t *) proto + OFF_Proto_Object);  // PoiMushroomProto
                    if (mush) {
                        cooldown = *(int *) ((uint8_t *) mush + OFF_Mush_Cooldown);   // 0x28
                        void *chal = *(void **) ((uint8_t *) mush + 0x18);            // poiChallenge_ (PoiChallengeInfoProto)
                        if (chal) {
                            level = *(int *) ((uint8_t *) chal + 0x4C);              // level_
                            ctype = *(int *) ((uint8_t *) chal + 0x48);              // type_ (PoiChallengeType)
                            startMs = *(long long *) ((uint8_t *) chal + 0x38);       // challengeStartTimeMs_
                            finishMs = *(long long *) ((uint8_t *) chal + 0x40);      // challengeFinishTimeMs_
                            challengerCapacity = *(int *) ((uint8_t *) chal + 0x6C);  // challengerCapacity_
                            challengerCount = *(int *) ((uint8_t *) chal + 0x70);     // totalChallengerCount_
                            totalPower = *(double *) ((uint8_t *) chal + 0x90);        // totalChallengerPikminPower_
                            read_cs_string(*(void **) ((uint8_t *) chal + 0x30), cluster, sizeof(cluster)); // mushroomClusterId_
                        }
                    }
                }
                std::string key(id);
                long ts = (long) time(nullptr);
                auto seen = g_seen.find(key);
                // 等級 1（小型）不具雷達參考價值；也排除尚未解析出有效等級的資料。
                bool should_log = level >= 2 && !key.empty() &&
                    (seen == g_seen.end() || seen->second.finish_ms != finishMs ||
                     seen->second.challenger_count != challengerCount ||
                     seen->second.total_power != totalPower ||
                     ts - seen->second.logged_at >= 600);
                if (should_log) {
                    g_seen[key] = {finishMs, ts, challengerCount, totalPower};
                    LOGI("[MUSH] id=%s lat=%.7f lng=%.7f lv=%d type=%d players=%d/%d power=%.0f finish=%lld",
                         id, lat, lng, level, ctype, challengerCount, challengerCapacity, totalPower, finishMs);
                    FILE *f = fopen(g_mush_path, "a");   // 每次重開，被外部 rm 也會重建
                    if (f) {
                        fprintf(f, "%ld\t%s\t%.7f\t%.7f\t%s\t%d\t%d\t%d\t%lld\t%d\t%d\t%.2f\t%lld\n",
                                ts, id, lat, lng, cluster, cooldown, level, ctype, finishMs,
                                challengerCount, challengerCapacity, totalPower, startMs);
                        fclose(f);
                    }
                }
            }
        }
    }
    if (orig_RegisterMapObject) orig_RegisterMapObject(thiz, obj, method);
}

// ==================== Auto teleport ====================
#include <pthread.h>
#include <unistd.h>

// Nullable<LatLngAlt> 佈局(.NET: {bool hasValue; T value})，8-align → value@0x08
// LatLngAlt: LatLng{lat@0,lng@8}, alt@0x10
struct NullableLatLngAlt {
    uint8_t hasValue;
    uint8_t _pad[7];
    double lat;
    double lng;
    double alt;
};

typedef void (*SetOverride_t)(void *thiz, void *nullablePtr, void *method);
static SetOverride_t fn_SetOverride = nullptr;
typedef void (*MapQueryResponse_t)(void *thiz, void *buffer, void *method);
static MapQueryResponse_t orig_MapQueryResponse = nullptr;
static void *g_gmo_manager = nullptr;
static const MethodInfo *g_clear_cache_method = nullptr;

static void *g_locController = nullptr;
static char g_teleport_path[512] = {0};
static double g_applied_lat = 1e9, g_applied_lng = 1e9;

typedef void (*LCUpdate_t)(void *thiz, void *method);
static LCUpdate_t orig_LCUpdate = nullptr;

static void capture_gmo_manager(void *map_query_manager) {
    if (g_gmo_manager || !map_query_manager) return;
    // MapQueryManager.onMapQueryResponseReceived @ 0x18 is a managed delegate.
    // Il2CppDelegate.m_target @ 0x20 is the GmoManager subscriber.
    void *callback = *(void **) ((uint8_t *) map_query_manager + 0x18);
    void *target = callback ? *(void **) ((uint8_t *) callback + 0x20) : nullptr;
    if (!target) return;
    Il2CppClass *klass = il2cpp_object_get_class((Il2CppObject *) target);
    const char *name = klass ? il2cpp_class_get_name(klass) : nullptr;
    if (!name || strcmp(name, "GmoManager") != 0) {
        LOGW("[REFRESH] map query callback target is %s, not GmoManager",
             name ? name : "(null)");
        return;
    }
    const MethodInfo *clear_cache =
        il2cpp_class_get_method_from_name(klass, "ClearCache", 0);
    if (!clear_cache) {
        LOGW("[REFRESH] GmoManager.ClearCache metadata unavailable");
        return;
    }
    g_gmo_manager = target;
    g_clear_cache_method = clear_cache;
    LOGI("[REFRESH] captured GmoManager this=%p via MapQuery delegate", target);
}

static void hooked_MapQueryResponse(void *thiz, void *buffer, void *method) {
    capture_gmo_manager(thiz);
    if (orig_MapQueryResponse) orig_MapQueryResponse(thiz, buffer, method);
    long long token = g_target_token;
    if (g_refresh_pending && token > 0 && token != g_query_written_token) {
        g_query_written_token = token;
        write_refresh_marker(g_query_ready_path, token, "query");
        LOGI("[REFRESH] target=%lld map query response received", token);
    }
}

// 在遊戲主執行緒(Update hook 內)呼叫遊戲原生的覆蓋 API
static void hooked_LCUpdate(void *thiz, void *method) {
    long long applied_refresh_token = 0;
    if (thiz) {
        if (!g_locController) {
            g_locController = thiz;
            const char *cn = "?";
            if (il2cpp_object_get_class && il2cpp_class_get_name) {
                auto k = il2cpp_object_get_class((Il2CppObject *) thiz);
                if (k) cn = il2cpp_class_get_name(k);
            }
            LOGI("[TP] captured controller this=%p class=%s", thiz, cn);
        }
        if (g_have_target && thiz == g_locController && fn_SetOverride &&
            (g_cur_lat != g_applied_lat || g_cur_lng != g_applied_lng ||
             g_target_token != g_applied_token)) {
            NullableLatLngAlt nv;
            memset(&nv, 0, sizeof(nv));
            nv.hasValue = 1; nv.lat = g_cur_lat; nv.lng = g_cur_lng; nv.alt = 0;
            fn_SetOverride(thiz, &nv, nullptr);
            g_applied_lat = g_cur_lat; g_applied_lng = g_cur_lng;
            g_applied_token = g_target_token;
            applied_refresh_token = g_target_token;
            g_refresh_pending = true;
            g_query_written_token = -1;
            if (g_gmo_manager && g_clear_cache_method) {
                Il2CppException *exc = nullptr;
                il2cpp_runtime_invoke(g_clear_cache_method, g_gmo_manager, nullptr, &exc);
                if (!exc) {
                    LOGI("[REFRESH] target=%lld ClearCache requested at %.7f,%.7f",
                         g_target_token, nv.lat, nv.lng);
                } else {
                    LOGW("[REFRESH] target=%lld ClearCache raised an exception",
                         g_target_token);
                }
            } else {
                LOGW("[REFRESH] target=%lld GmoManager unavailable; Agent will fall back",
                     g_target_token);
            }
            LOGI("[TP] SetOverride applied %.7f,%.7f target=%lld",
                 nv.lat, nv.lng, g_target_token);
        }
    }
    if (orig_LCUpdate) orig_LCUpdate(thiz, method);
    // LocationController.Update publishes the newly overridden DeviceLocation.
    // Recalculate only after that publication so MapManager observes the new GPS,
    // not the previous frame's location.
    if (applied_refresh_token && g_map_manager && g_recalculate_viewports_method) {
        uint8_t recalculate_immediately = 1;
        uint8_t force_reposition = 1;
        void *params[] = {&recalculate_immediately, &force_reposition};
        Il2CppException *exc = nullptr;
        il2cpp_runtime_invoke(g_recalculate_viewports_method, g_map_manager,
                              params, &exc);
        if (!exc) {
            LOGI("[REFRESH] target=%lld post-location viewport refresh requested",
                 applied_refresh_token);
        } else {
            LOGW("[REFRESH] target=%lld post-location viewport refresh raised an exception",
                 applied_refresh_token);
        }
    }
}

static void *teleport_thread(void *) {
    char last[128] = {0};
    for (;;) {
        FILE *fp = fopen(g_teleport_path, "r");
        if (fp) {
            char buf[128] = {0};
            if (fgets(buf, sizeof(buf), fp)) {
                for (char *p = buf; *p; ++p) { if (*p == '\n' || *p == '\r') { *p = 0; break; } }
                if (buf[0] && strcmp(buf, last) != 0) {
                    double lat, lng;
                    long long token = 0;
                    int parsed = sscanf(buf, "%lf,%lf,%lld", &lat, &lng, &token);
                    if (parsed >= 2) {
                        if (parsed < 3 || token <= 0) token = ++g_generated_token;
                        g_cur_lat = lat; g_cur_lng = lng; g_have_target = true;
                        g_target_token = token;
                        strncpy(last, buf, sizeof(last) - 1);
                        LOGI("[TP] target -> %.7f,%.7f token=%lld", lat, lng, token);
                    }
                }
            }
            fclose(fp);
        }
        usleep(300 * 1000);
    }
    return nullptr;
}

void install_hooks(const char *game_data_dir) {
    if (il2cpp_base == 0) {
        LOGE("[HOOK] il2cpp_base is 0, abort");
        return;
    }
    void *target = (void *) (il2cpp_base + RVA_RegisterMapObject);
    void *upd = (void *) (il2cpp_base + RVA_LocationController_Update);
    void *set_override = (void *) (il2cpp_base + RVA_SetOverride);
    if (!matches_target_signature("RegisterMapObject", target, SIG_RegisterMapObject,
                                  sizeof(SIG_RegisterMapObject)) ||
        !matches_target_signature("LocationController.Update", upd,
                                  SIG_LocationController_Update,
                                  sizeof(SIG_LocationController_Update)) ||
        !matches_target_signature("SetDeviceLocationOverrideForDebug", set_override,
                                  SIG_SetOverride, sizeof(SIG_SetOverride))) {
        return;
    }
    LOGI("[HOOK] verified Pikmin %s (%d) libil2cpp signatures",
         TARGET_PIKMIN_VERSION, TARGET_PIKMIN_VERSION_CODE);
    snprintf(g_mush_path, sizeof(g_mush_path), "%s/files/mushrooms.tsv", game_data_dir);
    snprintf(g_scan_ready_path, sizeof(g_scan_ready_path), "%s/files/scan.ready", game_data_dir);
    snprintf(g_query_ready_path, sizeof(g_query_ready_path), "%s/files/map_query.ready", game_data_dir);
    LOGI("[HOOK] mush log=%s", g_mush_path);

    LOGI("[HOOK] RegisterMapObject target=%p (base=%" PRIx64 " + rva=%x)",
         target, il2cpp_base, RVA_RegisterMapObject);
    A64HookFunction(target, (void *) hooked_RegisterMapObject, (void **) &orig_RegisterMapObject);
    LOGI("[HOOK] installed, orig=%p", (void *) orig_RegisterMapObject);

    // 自動瞬移
    snprintf(g_teleport_path, sizeof(g_teleport_path), "%s/files/teleport.txt", game_data_dir);
    fn_SetOverride = (SetOverride_t) set_override;
    A64HookFunction(upd, (void *) hooked_LCUpdate, (void **) &orig_LCUpdate);
    LOGI("[TP] Update hooked at %p, SetOverride=%p, control=%s", upd, (void *) fn_SetOverride, g_teleport_path);

    void *map_query_response =
        (void *) (il2cpp_base + RVA_MapQueryManager_OnMapQueryResponse);
    if (matches_target_signature("MapQueryManager.OnMapQueryResponse", map_query_response,
                                 SIG_MapQueryManager_OnMapQueryResponse,
                                 sizeof(SIG_MapQueryManager_OnMapQueryResponse))) {
        A64HookFunction(map_query_response, (void *) hooked_MapQueryResponse,
                        (void **) &orig_MapQueryResponse);
        LOGI("[REFRESH] experimental map refresh hooks installed");
    } else {
        LOGW("[REFRESH] experimental hooks unavailable; cold restart fallback remains");
    }
    pthread_t th;
    pthread_create(&th, nullptr, teleport_thread, nullptr);
}
