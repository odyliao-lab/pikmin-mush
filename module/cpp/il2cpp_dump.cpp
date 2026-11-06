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
#include "scanner-performance.h"

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

// Each profile is verified against exact version-specific RVAs and prologues.
// Refuse to install any hook when the loaded libil2cpp matches neither profile.
#define TARGET_PIKMIN_152_VERSION "152.0"
#define TARGET_PIKMIN_152_VERSION_CODE 1787540739
#define TARGET_PIKMIN_153_VERSION "153.0"
#define TARGET_PIKMIN_153_VERSION_CODE 1788751814
#define TARGET_PIKMIN_154_VERSION "154.0"
#define TARGET_PIKMIN_154_VERSION_CODE 1789606828
#define TARGET_PIKMIN_155_VERSION "155.0"
#define TARGET_PIKMIN_155_VERSION_CODE 1791279164
#define TARGET_PIKMIN_156_VERSION "156.0"
#define TARGET_PIKMIN_156_VERSION_CODE 1792142832
#define TARGET_PIKMIN_1561_VERSION "156.1"
#define TARGET_PIKMIN_1561_VERSION_CODE 1793076318
// 152.0 retains the MapManager registration callback that receives the
// MapPoiBlocker instances used by the scanner.  MapObjectManager has a distinct
// two-argument UI registration method, but it is not the callback that
// materializes the live mushroom objects on the map.
#define RVA_RegisterMapObject 0xCE60E20
#define RVA_LocationController_Update 0x71B5C34
#define RVA_SetOverride 0x71B6794
#define RVA_MapQueryManager_OnMapQueryResponse 0xCBF17E8

// 153.0 migrated map-object materialization from MapManager's one-argument
// callback to MapObjectManager.RegisterMapObject(MapObjectBase, MapObjectTag).
// The proto layouts and LocationController methods remain compatible.
#define RVA153_MapObjectManager_RegisterMapObject 0x5A02CA0
#define RVA153_LocationController_Update 0x7178874
#define RVA153_SetOverride 0x71793D4
// 154 ARM64: Cpp2IL reports file offsets as RVAs for this ELF. The executable
// PT_LOAD has p_vaddr - p_offset = 0x4000; use mapped virtual addresses here.
// Signatures, managed argument counts and all consumed proto fields verified
// against 154.0/1789606828. Keep the 153/152 profiles independently guarded.
#define RVA154_MapObjectManager_RegisterMapObject 0x5A77300
#define RVA154_LocationController_Update 0x71DADB8
#define RVA154_SetOverride 0x71DB918
#define RVA155_MapObjectManager_RegisterMapObject 0x5AF3F60
#define RVA155_LocationController_Update 0x726D168
#define RVA155_SetOverride 0x726DCC8
// 156 ARM64: exact installed APK ELF and metadata verified independently.
// These are mapped RVAs; executable file offsets are RVA minus 0x4000.
#define RVA156_MapObjectManager_RegisterMapObject 0x5B32FF4
#define RVA156_LocationController_Update 0x72B6564
#define RVA156_SetOverride 0x72B70C4
// 156.1 exact ARM64 ELF; mapped RVAs verified against installed APK.
#define RVA1561_MapObjectManager_RegisterMapObject 0x5B42820
#define RVA1561_LocationController_Update 0x72CEF78
#define RVA1561_SetOverride 0x72CFAD8

static const uint8_t SIG_RegisterMapObject[] = {
    0xFE, 0x67, 0xBC, 0xA9, 0xF8, 0x5F, 0x01, 0xA9,
    0xF6, 0x57, 0x02, 0xA9, 0xF4, 0x4F, 0x03, 0xA9
};
static const uint8_t SIG_LocationController_Update[] = {
    0xFF, 0x43, 0x03, 0xD1, 0xE8, 0x4B, 0x00, 0xFD,
    0xFE, 0x5F, 0x0A, 0xA9, 0xF6, 0x57, 0x0B, 0xA9
};
static const uint8_t SIG_SetOverride[] = {
    0xFF, 0xC3, 0x01, 0xD1, 0xFE, 0x23, 0x00, 0xF9,
    0xF6, 0x57, 0x05, 0xA9, 0xF4, 0x4F, 0x06, 0xA9
};
static const uint8_t SIG_MapQueryManager_OnMapQueryResponse[] = {
    0xFF, 0x43, 0x02, 0xD1, 0xFE, 0x23, 0x00, 0xF9,
    0xFA, 0x67, 0x05, 0xA9, 0xF8, 0x5F, 0x06, 0xA9
};
static const uint8_t SIG153_MapObjectManager_RegisterMapObject[] = {
    0xFE, 0x0F, 0x1D, 0xF8, 0xF6, 0x57, 0x01, 0xA9,
    0xF4, 0x4F, 0x02, 0xA9, 0x01, 0x03, 0x00, 0xB4,
    0xF3, 0x03, 0x01, 0xAA, 0xF4, 0x03, 0x00, 0xAA,
    0xE0, 0x03, 0x01, 0xAA, 0xE1, 0x03, 0x1F, 0xAA,
};

// Exact 156.1 entrypoint bytes independently checked against the installed ELF.
static const uint8_t SIG1561_Register[] = {
    0xFE, 0x0F, 0x1D, 0xF8, 0xF6, 0x57, 0x01, 0xA9,
    0xF4, 0x4F, 0x02, 0xA9, 0x01, 0x03, 0x00, 0xB4,
    0xF3, 0x03, 0x01, 0xAA, 0xF4, 0x03, 0x00, 0xAA,
    0xE0, 0x03, 0x01, 0xAA, 0xE1, 0x03, 0x1F, 0xAA
};
static const uint8_t SIG1561_Update[] = {
    0xFF, 0x43, 0x03, 0xD1, 0xE8, 0x4B, 0x00, 0xFD,
    0xFE, 0x5F, 0x0A, 0xA9, 0xF6, 0x57, 0x0B, 0xA9,
    0xF4, 0x4F, 0x0C, 0xA9, 0x55, 0xD0, 0x3B, 0xD5,
    0x94, 0x0E, 0x04, 0xB0, 0xF3, 0x03, 0x00, 0xAA
};
static const uint8_t SIG1561_Override[] = {
    0xFF, 0xC3, 0x01, 0xD1, 0xFE, 0x23, 0x00, 0xF9,
    0xF6, 0x57, 0x05, 0xA9, 0xF4, 0x4F, 0x06, 0xA9,
    0x95, 0x0E, 0x04, 0x90, 0xF4, 0x03, 0x01, 0xAA,
    0xF3, 0x03, 0x00, 0xAA, 0xA8, 0xBA, 0x60, 0x39
};

static bool target_signature_matches(const void *target, const uint8_t *expected,
                                     size_t expected_size) {
    return target && memcmp(target, expected, expected_size) == 0;
}

static bool matches_target_signature(const char *name, const void *target,
                                     const uint8_t *expected, size_t expected_size) {
    if (!target_signature_matches(target, expected, expected_size)) {
        LOGE("[HOOK] %s signature mismatch; refusing hooks", name);
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
static char g_native_ready_path[512] = {0};
static const char *g_native_version = "";
static int g_render_fps = 0;
static char g_render_status_path[512] = {0};

static void native_ready_marker() {
    char tmp[540];
    snprintf(tmp, sizeof(tmp), "%s.%d.tmp", g_native_ready_path, getpid());
    FILE *f = fopen(tmp, "w");
    if (!f) return;
    fprintf(f, "%d\t%s\n", getpid(), g_native_version);
    if (fclose(f) == 0) rename(tmp, g_native_ready_path);
}

// Executed only in LocationController.Update on Unity's main thread, only for
// an opted-in exact155 profile. No thermal/charger/CPU-frequency controls.
static void apply_scanner_render_limit() {
    if (!g_render_fps || !il2cpp_domain_get || !il2cpp_runtime_invoke || !il2cpp_object_unbox) return;
    static time_t last_check = 0;
    time_t now = time(nullptr);
    if (last_check && now >= last_check && now-last_check < 5) return;
    last_check = now;
    static const MethodInfo *setter = nullptr, *getter = nullptr;
    static int attempts = 0;
    if (!setter || !getter) {
        if (++attempts > 12) { g_render_fps=0; LOGW("[PERF] render metadata unavailable; opt-out"); return; }
        auto domain = il2cpp_domain_get();
        if (!domain) return;
        size_t count=0;
        auto assemblies = il2cpp_domain_get_assemblies(domain, &count);
        for (size_t i=0; i<count; ++i) {
            auto image = il2cpp_assembly_get_image(assemblies[i]);
            const char *name = image ? il2cpp_image_get_name(image) : nullptr;
            if (!name || strcmp(name,"UnityEngine.CoreModule.dll")) continue;
            auto klass = il2cpp_class_from_name(image,"UnityEngine","Application");
            if (!klass) break;
            setter = il2cpp_class_get_method_from_name(klass,"set_targetFrameRate",1);
            getter = il2cpp_class_get_method_from_name(klass,"get_targetFrameRate",0);
            break;
        }
        if (!setter || !getter) return;
        if (!(il2cpp_method_get_flags(setter,nullptr)&METHOD_ATTRIBUTE_STATIC) ||
            !(il2cpp_method_get_flags(getter,nullptr)&METHOD_ATTRIBUTE_STATIC)) {
            g_render_fps=0; LOGW("[PERF] invalid render metadata; opt-out"); return;
        }
    }
    Il2CppException *exc=nullptr;
    auto boxed = il2cpp_runtime_invoke(getter,nullptr,nullptr,&exc);
    if (exc || !boxed) { g_render_fps=0; LOGW("[PERF] render read failed; opt-out"); return; }
    int current = *static_cast<int *>(il2cpp_object_unbox(boxed));
    if (current == g_render_fps) return;
    int requested=g_render_fps;
    void *args[]={&requested};
    il2cpp_runtime_invoke(setter,nullptr,args,&exc);
    boxed = exc ? nullptr : il2cpp_runtime_invoke(getter,nullptr,nullptr,&exc);
    if (exc || !boxed || *static_cast<int *>(il2cpp_object_unbox(boxed)) != requested) {
        g_render_fps=0; LOGW("[PERF] render limit verification failed; opt-out"); return;
    }
    LOGI("[PERF] verified targetFrameRate=%d previous=%d",requested,current);
    FILE *f=fopen(g_render_status_path,"w");
    if (f) { fprintf(f,"%d\t%d\t%ld\n",getpid(),requested,(long)now); fclose(f); }
}
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
// Keep a bounded native trace for version upgrades.  The scanner only accepts
// MapPoiBlocker, but recording the first registrations tells us whether a new
// game build stopped calling this callback or merely changed the object class.
static volatile int g_map_registration_trace_count = 0;

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

typedef void (*MapManagerRegisterMapObject_t)(void *thiz, void *obj, void *method);
static MapManagerRegisterMapObject_t orig_MapManagerRegisterMapObject = nullptr;
static void hooked_MapManagerRegisterMapObject(void *thiz, void *obj, void *method);

// 153 materializes objects through MapObjectManager.RegisterMapObject with two
// managed arguments.  Keep its ABI separate from MapManager's one-argument
// callback; using the latter drops the tag/method arguments and is unsafe.
typedef void (*MapObjectManagerRegisterMapObject_t)(void *thiz, void *obj,
                                                     void *tag, void *method);
static MapObjectManagerRegisterMapObject_t orig_MapObjectManagerRegisterMapObject = nullptr;
static void hooked_MapObjectManagerRegisterMapObject(void *thiz, void *obj,
                                                      void *tag, void *method);

// 153 retains the MapManager registration callback that receives the live
// MapPoiBlocker instances, but its native RVA is not stable enough to hardcode.
// Resolve it from the loaded IL2CPP metadata and require the expected assembly,
// class and one-argument method before installing the hook.
static void *resolve_153_map_manager_registration() {
    if (!il2cpp_domain_get || !il2cpp_domain_get_assemblies ||
        !il2cpp_assembly_get_image || !il2cpp_image_get_name ||
        !il2cpp_class_from_name || !il2cpp_class_get_method_from_name) {
        LOGE("[HOOK] 153 metadata APIs unavailable; refusing map hook");
        return nullptr;
    }
    Il2CppDomain *domain = il2cpp_domain_get();
    size_t count = 0;
    const Il2CppAssembly **assemblies = domain ?
        il2cpp_domain_get_assemblies(domain, &count) : nullptr;
    if (!assemblies) {
        LOGE("[HOOK] 153 assembly list unavailable; refusing map hook");
        return nullptr;
    }
    for (size_t i = 0; i < count; ++i) {
        const Il2CppImage *image = il2cpp_assembly_get_image(assemblies[i]);
        const char *image_name = image ? il2cpp_image_get_name(image) : nullptr;
        if (!image_name || strcmp(image_name, "Niantic.TokyoStudio.Map.dll") != 0) continue;
        Il2CppClass *klass = il2cpp_class_from_name(
            image, "Niantic.TokyoStudio.Map", "MapManager");
        const MethodInfo *method = klass ?
            il2cpp_class_get_method_from_name(klass, "RegisterMapObject", 1) : nullptr;
        if (!method || !method->methodPointer) {
            LOGE("[HOOK] 153 MapManager.RegisterMapObject metadata unavailable");
            return nullptr;
        }
        void *target = (void *) method->methodPointer;
        if ((uint64_t) target < il2cpp_base ||
            (uint64_t) target - il2cpp_base > 0x20000000ULL) {
            LOGE("[HOOK] 153 MapManager method pointer outside libil2cpp; refusing map hook");
            return nullptr;
        }
        LOGI("[HOOK] 153 resolved MapManager.RegisterMapObject RVA=0x%llx",
             (unsigned long long) ((uint64_t) target - il2cpp_base));
        return target;
    }
    LOGE("[HOOK] 153 MapManager assembly unavailable; refusing map hook");
    return nullptr;
}

static void *install_153_map_manager_hook_after_startup(void *) {
    // libil2cpp can be mapped before the managed domain exists.  Querying the
    // domain during the splash phase crashes 153, so wait for normal startup
    // and resolve only from this detached, one-shot worker.
    sleep(75);
    void *target = resolve_153_map_manager_registration();
    if (!target) return nullptr;
    A64HookFunction(target, (void *) hooked_MapManagerRegisterMapObject,
                    (void **) &orig_MapManagerRegisterMapObject);
    LOGI("[HOOK] 153 MapManager hook installed after startup, orig=%p",
         (void *) orig_MapManagerRegisterMapObject);
    if (orig_MapManagerRegisterMapObject) native_ready_marker();
    return nullptr;
}

static void observe_map_object(void *thiz, void *obj, bool legacy_map_manager) {
    if (legacy_map_manager) capture_map_manager(thiz);
    if (obj) {
        const char *cname = "?";
        if (il2cpp_object_get_class && il2cpp_class_get_name) {
            auto klass = il2cpp_object_get_class((Il2CppObject *) obj);
            if (klass) cname = il2cpp_class_get_name(klass);
        }
        if (__sync_fetch_and_add(&g_map_registration_trace_count, 1) < 24) {
            LOGI("[HOOK] map registration class=%s", cname ? cname : "?");
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
}

static void hooked_MapManagerRegisterMapObject(void *thiz, void *obj, void *method) {
    observe_map_object(thiz, obj, true);
    if (orig_MapManagerRegisterMapObject) {
        orig_MapManagerRegisterMapObject(thiz, obj, method);
    }
}

static void hooked_MapObjectManagerRegisterMapObject(void *thiz, void *obj,
                                                      void *tag, void *method) {
    observe_map_object(nullptr, obj, false);
    if (orig_MapObjectManagerRegisterMapObject) {
        orig_MapObjectManagerRegisterMapObject(thiz, obj, tag, method);
    }
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
    if (thiz) apply_scanner_render_limit();
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
    void *target152 = (void *) (il2cpp_base + RVA_RegisterMapObject);
    void *update152 = (void *) (il2cpp_base + RVA_LocationController_Update);
    void *override152 = (void *) (il2cpp_base + RVA_SetOverride);
    void *target153 = (void *) (il2cpp_base + RVA153_MapObjectManager_RegisterMapObject);
    void *update153 = (void *) (il2cpp_base + RVA153_LocationController_Update);
    void *override153 = (void *) (il2cpp_base + RVA153_SetOverride);
    void *target154 = (void *) (il2cpp_base + RVA154_MapObjectManager_RegisterMapObject);
    void *update154 = (void *) (il2cpp_base + RVA154_LocationController_Update);
    void *override154 = (void *) (il2cpp_base + RVA154_SetOverride);
    void *target155 = (void *) (il2cpp_base + RVA155_MapObjectManager_RegisterMapObject);
    void *update155 = (void *) (il2cpp_base + RVA155_LocationController_Update);
    void *override155 = (void *) (il2cpp_base + RVA155_SetOverride);
    void *target156 = (void *) (il2cpp_base + RVA156_MapObjectManager_RegisterMapObject);
    void *update156 = (void *) (il2cpp_base + RVA156_LocationController_Update);
    void *override156 = (void *) (il2cpp_base + RVA156_SetOverride);
    void *target1561 = (void *) (il2cpp_base + RVA1561_MapObjectManager_RegisterMapObject);
    void *update1561 = (void *) (il2cpp_base + RVA1561_LocationController_Update);
    void *override1561 = (void *) (il2cpp_base + RVA1561_SetOverride);
    const bool is152 =
        target_signature_matches(target152, SIG_RegisterMapObject,
                                 sizeof(SIG_RegisterMapObject)) &&
        target_signature_matches(update152, SIG_LocationController_Update,
                                 sizeof(SIG_LocationController_Update)) &&
        target_signature_matches(override152, SIG_SetOverride,
                                 sizeof(SIG_SetOverride));
    const bool is153 = !is152 &&
        target_signature_matches(target153, SIG153_MapObjectManager_RegisterMapObject,
                                 sizeof(SIG153_MapObjectManager_RegisterMapObject)) &&
        target_signature_matches(update153, SIG_LocationController_Update,
                                 sizeof(SIG_LocationController_Update)) &&
        target_signature_matches(override153, SIG_SetOverride,
                                 sizeof(SIG_SetOverride));
    const bool is154 = !is152 && !is153 &&
        target_signature_matches(target154, SIG153_MapObjectManager_RegisterMapObject,
                                 sizeof(SIG153_MapObjectManager_RegisterMapObject)) &&
        target_signature_matches(update154, SIG_LocationController_Update,
                                 sizeof(SIG_LocationController_Update)) &&
        target_signature_matches(override154, SIG_SetOverride,
                                 sizeof(SIG_SetOverride));
    const bool is155 = !is152 && !is153 && !is154 &&
        target_signature_matches(target155, SIG153_MapObjectManager_RegisterMapObject,
                                 sizeof(SIG153_MapObjectManager_RegisterMapObject)) &&
        target_signature_matches(update155, SIG_LocationController_Update,
                                 sizeof(SIG_LocationController_Update)) &&
        target_signature_matches(override155, SIG_SetOverride,
                                 sizeof(SIG_SetOverride));
    const bool is156 = !is152 && !is153 && !is154 && !is155 &&
        target_signature_matches(target156, SIG153_MapObjectManager_RegisterMapObject,
                                 sizeof(SIG153_MapObjectManager_RegisterMapObject)) &&
        target_signature_matches(update156, SIG_LocationController_Update,
                                 sizeof(SIG_LocationController_Update)) &&
        target_signature_matches(override156, SIG_SetOverride,
                                 sizeof(SIG_SetOverride));
    const bool is1561 = !is152 && !is153 && !is154 && !is155 && !is156 &&
        target_signature_matches(target1561, SIG1561_Register,
                                 sizeof(SIG1561_Register)) &&
        target_signature_matches(update1561, SIG1561_Update,
                                 sizeof(SIG1561_Update)) &&
        target_signature_matches(override1561, SIG1561_Override,
                                 sizeof(SIG1561_Override));
    if (!is152 && !is153 && !is154 && !is155 && !is156 && !is1561) {
        LOGE("[HOOK] no supported Pikmin profile matched; refusing hooks");
        return;
    }
    void *target = is1561 ? target1561 : (is156 ? target156 : (is155 ? target155 : (is152 ? target152 : (is153 ? target153 : target154))));
    void *upd = is1561 ? update1561 : (is156 ? update156 : (is155 ? update155 : (is152 ? update152 : (is153 ? update153 : update154))));
    void *set_override = is1561 ? override1561 : (is156 ? override156 : (is155 ? override155 : (is152 ? override152 : (is153 ? override153 : override154))));
    const char *profile_version = is1561 ? TARGET_PIKMIN_1561_VERSION : (is156 ? TARGET_PIKMIN_156_VERSION :
        (is155 ? TARGET_PIKMIN_155_VERSION : (is152 ? TARGET_PIKMIN_152_VERSION :
        (is153 ? TARGET_PIKMIN_153_VERSION : TARGET_PIKMIN_154_VERSION))));
    const int profile_version_code = is1561 ? TARGET_PIKMIN_1561_VERSION_CODE : (is156 ? TARGET_PIKMIN_156_VERSION_CODE :
        (is155 ? TARGET_PIKMIN_155_VERSION_CODE : (is152 ? TARGET_PIKMIN_152_VERSION_CODE :
        (is153 ? TARGET_PIKMIN_153_VERSION_CODE : TARGET_PIKMIN_154_VERSION_CODE))));
    LOGI("[HOOK] verified Pikmin %s (%d) libil2cpp signatures",
         profile_version, profile_version_code);
    snprintf(g_mush_path, sizeof(g_mush_path), "%s/files/mushrooms.tsv", game_data_dir);
    snprintf(g_scan_ready_path, sizeof(g_scan_ready_path), "%s/files/scan.ready", game_data_dir);
    snprintf(g_query_ready_path, sizeof(g_query_ready_path), "%s/files/map_query.ready", game_data_dir);
    snprintf(g_native_ready_path, sizeof(g_native_ready_path), "%s/files/native.ready", game_data_dir);
    unlink(g_native_ready_path);
    g_native_version=profile_version;
    if (is155 || is156 || is1561) {
        char path[512];
        snprintf(path,sizeof(path),"%s/files/scanner-render-fps.txt",game_data_dir);
        FILE *f=fopen(path,"r");
        g_render_fps=scanner_render_fps(f);
        if (f) fclose(f);
        snprintf(g_render_status_path,sizeof(g_render_status_path),"%s/files/scanner-render.status",game_data_dir);
        unlink(g_render_status_path);
        LOGI("[PERF] configured targetFrameRate=%d (0=unchanged)",g_render_fps);
    }
    LOGI("[HOOK] mush log=%s", g_mush_path);

    LOGI("[HOOK] map registration target=%p", target);
    if (is152) {
        A64HookFunction(target, (void *) hooked_MapManagerRegisterMapObject,
                        (void **) &orig_MapManagerRegisterMapObject);
        LOGI("[HOOK] 152 MapManager hook installed, orig=%p",
             (void *) orig_MapManagerRegisterMapObject);
        if (orig_MapManagerRegisterMapObject) native_ready_marker();
    } else {
        A64HookFunction(target, (void *) hooked_MapObjectManagerRegisterMapObject,
                        (void **) &orig_MapObjectManagerRegisterMapObject);
        LOGI("[HOOK] 153/154/155/156 MapObjectManager hook installed, orig=%p",
             (void *) orig_MapObjectManagerRegisterMapObject);
        pthread_t map_hook_thread;
        pthread_create(&map_hook_thread, nullptr,
                       install_153_map_manager_hook_after_startup, nullptr);
        pthread_detach(map_hook_thread);
        LOGI("[HOOK] 153 MapManager resolver deferred until managed startup");
    }

    // 自動瞬移
    snprintf(g_teleport_path, sizeof(g_teleport_path), "%s/files/teleport.txt", game_data_dir);
    fn_SetOverride = (SetOverride_t) set_override;
    A64HookFunction(upd, (void *) hooked_LCUpdate, (void **) &orig_LCUpdate);
    LOGI("[TP] Update hooked at %p, SetOverride=%p, control=%s", upd, (void *) fn_SetOverride, g_teleport_path);

    if (is152) {
        void *map_query_response =
            (void *) (il2cpp_base + RVA_MapQueryManager_OnMapQueryResponse);
        if (matches_target_signature("MapQueryManager.OnMapQueryResponse", map_query_response,
                                     SIG_MapQueryManager_OnMapQueryResponse,
                                     sizeof(SIG_MapQueryManager_OnMapQueryResponse))) {
            A64HookFunction(map_query_response, (void *) hooked_MapQueryResponse,
                            (void **) &orig_MapQueryResponse);
            LOGI("[REFRESH] 152 map-query hook installed");
        } else {
            LOGW("[REFRESH] 152 map-query hook unavailable; cold restart fallback remains");
        }
    } else {
        LOGI("[REFRESH] 153 uses map-object readiness; map-query hook intentionally disabled");
    }
    pthread_t th;
    pthread_create(&th, nullptr, teleport_thread, nullptr);
}
