# 階段1 成果：Hook 目標與欄位偏移 (Pikmin Bloom v148, arm64)

> 執行期位址 = libil2cpp.so 載入基址 + RVA。offset 欄是結構內欄位位移。
> 版本相依：147/148 偏移不同，每次遊戲更新需重新 dump。

## 候選 hook 點
1. **MapManager.RegisterMapObject(MapObjectBase obj)** — RVA `0xCB4596C`
   - Namespace: `Niantic.TokyoStudio.Map`，class `MapManager : MonoBehaviour`
   - 每個地圖物件註冊時呼叫（含蘑菇）。簽章 (this, MapObjectBase*)。最易 hook。
   - MapManager.mapObjects (Dictionary<string,MapObjectBase>) 偏移 0x78。
   - 缺點：MapObjectBase 是 client 包裝物件，需再解其結構取座標/型別。
2. **RpcManager.SendPlantFlower2RpcForResultAsync** — RVA `0x704xxxx`(見下) 回傳 `PlantFlower2ResponseProto`
   - PlantFlower2 是邊走邊種花的高頻 RPC，回應帶周邊地圖物件（原始伺服器資料，最準）。
   - 回傳 Task<T> 較難 hook；改 hook proto 解析或 continuation。

## 原始資料結構 (Google/Niantic protobuf, IMessage)
- **PlantFlower2ResponseProto** (Ichigo.Proto):
  - status_ @0x18, **mapObject_ (RepeatedField<MapObjectProto>) @0x20**, numBaseCoins_ @0x28 ...
- **MapObjectProto** (TypeDefIndex 1926):
  - point_ (PointProto) @0x20, id_ (string) @0x18, poiInfo_ @0x28, object_ @0x30, objectCase_ (enum) @0x38
  - oneof ObjectCase: PoiFlower=13, FlowerField=14, **PoiMushroom=22**, PoiCampaign=23, PoiIrlEventFacility=24
- **PointProto** (TypeDefIndex 117): **latDegrees_ (double) @0x18, lngDegrees_ (double) @0x20**
- **PoiMushroomProto** (TypeDefIndex 1932):
  - poiChallenge_ @0x18, visibilityControl_ @0x20, overrideCooldownSeconds_ (int) @0x28, mushroomClusterId_ (string) @0x30

## Crypto (本地存檔用，非 rpc2)
- `Niantic.Ichigo.Utils.Crypto`: DefaultEncrypt @0x6AAB1E8, DefaultDecrypt @0x6AAB6E0, DEFAULT_AES_KEY。rpc2 加密在 native libNianticLabsPlugin。

## 待驗證的關鍵假設
- **native inline hook 是否能繞過 Niantic 反竄改**（程式碼 checksum、掃描未知 .so）。階段2 需先用「注入無害 .so + 單一無害 hook」低成本驗證，再投入完整實作。
