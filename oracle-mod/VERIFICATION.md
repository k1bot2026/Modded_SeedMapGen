# oracle-mod symbol verification (Yarn 1.21.1 + Fabric Loader 0.16.14 + Fabric API 0.116.14+1.21.1)

Every Minecraft / Fabric symbol used by this mod, with the evidence that proves its exact
1.21.1 name and signature. Nothing below was written from memory.

Evidence sources (all fetched 2026-07-16):

- **[yarn]** `https://raw.githubusercontent.com/FabricMC/yarn/1.21.1/mappings/<path>.mapping`
  (enigma format; the quoted `CLASS`/`METHOD`/`FIELD` lines are verbatim).
- **[tiny]** `https://raw.githubusercontent.com/FabricMC/intermediary/master/mappings/1.21.1.tiny`
  (record components, which yarn enigma files omit when the name passes through).
- **[src]** `https://raw.githubusercontent.com/youxuezhe7/Minecraft1.21.1-source/main/<path>.java`
  (yarn-decompiled 1.21.1 source mirror; used for generics, class hierarchy, and vanilla
  call-site patterns that mappings cannot encode).
- **[fabric]** exact FabricMC GitHub source files (URLs inline).

Mapping-agent reports with the full raw evidence blocks were produced in this workspace as
`mappings/worldgen-biome.md`, `mappings/structures.md`, `mappings/registry-fabric.md`
(scratchpad artifacts); the load-bearing lines are reproduced here so this file stands alone.

---

## 1. Server / lifecycle / threading

### net.minecraft.server.MinecraftServer (class name unobfuscated)
[yarn] `net/minecraft/server/MinecraftServer.mapping`:

```
METHOD method_3738 getWorlds ()Ljava/lang/Iterable;
METHOD method_30002 getOverworld ()Lnet/minecraft/class_3218;
METHOD method_30611 getRegistryManager ()Lnet/minecraft/class_5455$class_6890;
METHOD method_27727 getStructureTemplateManager ()Lnet/minecraft/class_3485;
```

Used: `getWorlds()` → `Iterable<ServerWorld>`, `getOverworld()` → `ServerWorld`,
`getRegistryManager()` → `DynamicRegistryManager.Immutable` (class_5455$class_6890),
`getStructureTemplateManager()` → `StructureTemplateManager`.

### net.minecraft.util.thread.ThreadExecutor (class_1255) — supertype of MinecraftServer
[yarn] `net/minecraft/util/thread/ThreadExecutor.mapping`:

```
CLASS net/minecraft/class_1255 net/minecraft/util/thread/ThreadExecutor
	METHOD method_5385 submit (Ljava/util/function/Supplier;)Ljava/util/concurrent/CompletableFuture;
```

Used: `server.submit(Supplier<V>)` → `CompletableFuture<V>` — the server-thread hop in
`ServerTasks`. MinecraftServer extends ReentrantThreadExecutor (class_4093) extends
ThreadExecutor ([yarn] `ReentrantThreadExecutor.mapping` header).

### net.minecraft.server.world.ServerWorld (class_3218)
[yarn] `net/minecraft/server/world/ServerWorld.mapping` header + supertype files:

```
CLASS net/minecraft/class_3218 net/minecraft/server/world/ServerWorld
	FIELD field_24624 chunkManager Lnet/minecraft/class_3215;

CLASS net/minecraft/class_1937 net/minecraft/world/World
	METHOD method_27983 getRegistryKey ()Lnet/minecraft/class_5321;

CLASS net/minecraft/class_5281 net/minecraft/world/StructureWorldAccess
	METHOD method_8412 getSeed ()J

CLASS net/minecraft/class_1936 net/minecraft/world/WorldAccess
	METHOD method_8398 getChunkManager ()Lnet/minecraft/class_2802;
```

Used: `getRegistryKey()` → `RegistryKey<World>` (inherited from World),
`getSeed()` → `long` (from StructureWorldAccess, implemented by ServerWorld),
`getChunkManager()` → `ServerChunkManager` (ServerWorld's covariant override; [src]
`ServerWorld.java`: `public ServerChunkManager getChunkManager()`; the chunkManager field is
class_3215). ServerWorld is also passed where a `HeightLimitView` (class_5539) is required:
[src] `ServerWorld extends World implements StructureWorldAccess` and
`BlockView extends HeightLimitView` — World implements WorldView → BlockView.

### net.minecraft.SharedConstants (class_155) / net.minecraft.GameVersion (class_6489)
[yarn] `SharedConstants.mapping`, `GameVersion.mapping`:

```
CLASS net/minecraft/class_155 net/minecraft/SharedConstants
	METHOD method_16673 getGameVersion ()Lnet/minecraft/class_6489;
CLASS net/minecraft/class_6489 net/minecraft/GameVersion
	METHOD method_48019 getName ()Ljava/lang/String;
```

Used: `SharedConstants.getGameVersion().getName()` → `"1.21.1"`.

---

## 2. Chunk manager / generator / noise

### net.minecraft.server.world.ServerChunkManager (class_3215)
[yarn] `net/minecraft/server/world/ServerChunkManager.mapping`:

```
METHOD method_12129 getChunkGenerator ()Lnet/minecraft/class_2794;
METHOD method_41248 getNoiseConfig ()Lnet/minecraft/class_7138;
METHOD method_46642 getStructurePlacementCalculator ()Lnet/minecraft/class_7869;
```

All three `public` per [src] `ServerChunkManager.java` (lines 403/407/411).

### net.minecraft.world.gen.chunk.ChunkGenerator (class_2794)
[yarn] `net/minecraft/world/gen/chunk/ChunkGenerator.mapping`:

```
METHOD method_12098 getBiomeSource ()Lnet/minecraft/class_1966;
METHOD method_12103 locateStructure (Lnet/minecraft/class_3218;Lnet/minecraft/class_6885;Lnet/minecraft/class_2338;IZ)Lcom/mojang/datafixers/util/Pair;
	ARG 1 world  ARG 2 structures  ARG 3 center  ARG 4 radius  ARG 5 skipReferencedStructures
METHOD method_46696 createStructurePlacementCalculator (Lnet/minecraft/class_7225;Lnet/minecraft/class_7138;J)Lnet/minecraft/class_7869;
	ARG 1 structureSetRegistry  ARG 2 noiseConfig  ARG 3 seed
```

Used: `getBiomeSource()`; `locateStructure(ServerWorld, RegistryEntryList<Structure>,
BlockPos, int, boolean)` → `@Nullable Pair<BlockPos, RegistryEntry<Structure>>` (the /locate
backend; generics from [src] `ChunkGenerator.java`); `createStructurePlacementCalculator(
RegistryWrapper<StructureSet>, NoiseConfig, long)` (the /seed/verify candidate calculator).

Vanilla start-seed evidence — [src] `ChunkGenerator.java` `setStructureStarts` passes
`placementCalculator.getStructureSeed()` (not the raw world seed) into
`trySetStructureStart`, which calls `structure.createStructureStart(dynamicRegistryManager,
this, this.biomeSource, noiseConfig, structureManager, seed, pos, i, chunk, predicate)` with
`Predicate<RegistryEntry<Biome>> predicate = registryEntryList::contains` and checks
`structureStart.hasChildren()`. `StructureEndpoints#computesRealStart` mirrors this exactly.

### net.minecraft.world.gen.chunk.NoiseChunkGenerator (class_3754)
[yarn] `net/minecraft/world/gen/chunk/NoiseChunkGenerator.mapping`:

```
CLASS net/minecraft/class_3754 net/minecraft/world/gen/chunk/NoiseChunkGenerator
	METHOD method_41541 getSettings ()Lnet/minecraft/class_6880;
```

Used: `getSettings()` → `RegistryEntry<ChunkGeneratorSettings>` (generic from [src]
`ServerChunkLoadingManager.java`: `noiseChunkGenerator.getSettings().value()`).

### net.minecraft.world.gen.chunk.ChunkGeneratorSettings (class_5284)
[yarn] `net/minecraft/world/gen/chunk/ChunkGeneratorSettings.mapping`:

```
CLASS net/minecraft/class_5284 net/minecraft/world/gen/chunk/ChunkGeneratorSettings
	METHOD method_44323 createMissingSettings ()Lnet/minecraft/class_5284;
```

Used: static `createMissingSettings()` for non-noise generators — the exact vanilla
fallback, [src] `ServerChunkLoadingManager.java` constructor:

```java
if (chunkGenerator instanceof NoiseChunkGenerator noiseChunkGenerator) {
    this.noiseConfig = NoiseConfig.create(noiseChunkGenerator.getSettings().value(),
        dynamicRegistryManager.getWrapperOrThrow(RegistryKeys.NOISE_PARAMETERS), l);
} else {
    this.noiseConfig = NoiseConfig.create(ChunkGeneratorSettings.createMissingSettings(),
        dynamicRegistryManager.getWrapperOrThrow(RegistryKeys.NOISE_PARAMETERS), l);
}
this.structurePlacementCalculator = chunkGenerator.createStructurePlacementCalculator(
    dynamicRegistryManager.getWrapperOrThrow(RegistryKeys.STRUCTURE_SET), this.noiseConfig, l);
```

`SeedVerifyEndpoint#candidateContext` reproduces this pattern with the candidate seed.

### net.minecraft.world.gen.noise.NoiseConfig (class_7138)
[yarn] `net/minecraft/world/gen/noise/NoiseConfig.mapping`:

```
METHOD method_41556 create (Lnet/minecraft/class_5284;Lnet/minecraft/class_7871;J)Lnet/minecraft/class_7138;
	ARG 0 chunkGeneratorSettings  ARG 1 noiseParametersLookup  ARG 2 legacyWorldSeed
METHOD method_42371 getMultiNoiseSampler ()Lnet/minecraft/class_6544$class_6552;
```

Used: `create(ChunkGeneratorSettings, RegistryEntryLookup<DoublePerlinNoiseSampler.NoiseParameters>, long)`
and `getMultiNoiseSampler()`.

### net.minecraft.world.biome.source.BiomeSource (class_1966) / BiomeSupplier (class_6780)
[yarn] `BiomeSource.mapping`, `BiomeSupplier.mapping`:

```
CLASS net/minecraft/class_6780 net/minecraft/world/biome/source/BiomeSupplier
	METHOD method_38109 getBiome (IIILnet/minecraft/class_6544$class_6552;)Lnet/minecraft/class_6880;
		ARG 1 x  ARG 2 y  ARG 3 z  ARG 4 noise
```

Used: `biomeSource.getBiome(int, int, int, MultiNoiseUtil.MultiNoiseSampler)` →
`RegistryEntry<Biome>`. Declared on the BiomeSupplier interface which BiomeSource
implements; the override keeps name and intermediary id. Coordinates are quart coordinates
(block >> 2) — source-level convention, applied everywhere in this mod.

### net.minecraft.world.biome.source.util.MultiNoiseUtil.MultiNoiseSampler (class_6544$class_6552)
[yarn] `MultiNoiseUtil.mapping`: `CLASS class_6552 MultiNoiseSampler`. Used as a type only
(obtained from `NoiseConfig#getMultiNoiseSampler`, passed to `getBiome`); no member calls,
per the mapping-agent caveat that its record-component accessors are unverifiable.

---

## 3. Structure placement

### net.minecraft.world.gen.chunk.placement.StructurePlacementCalculator (class_7869)
[yarn] `StructurePlacementCalculator.mapping`:

```
METHOD method_46697 getStructureSets ()Ljava/util/List;
METHOD method_46708 getPlacements (Lnet/minecraft/class_6880;)Ljava/util/List;
METHOD method_46707 getPlacementPositions (Lnet/minecraft/class_6871;)Ljava/util/List;
METHOD method_46714 getStructureSeed ()J
```

Used: `getStructureSets()` → `List<RegistryEntry<StructureSet>>` (pre-filtered per dimension
by biome validity, [src] `StructurePlacementCalculator.java` `create`); `getPlacements(
RegistryEntry<Structure>)` → `List<StructurePlacement>`; `getPlacementPositions(
ConcentricRingsStructurePlacement)` → `@Nullable List<ChunkPos>` (the stronghold ring
enumerator); `getStructureSeed()` → `long`. Generics and `public` visibility of all four
confirmed from [src] `StructurePlacementCalculator.java` (lines 77/177/183/206).

### net.minecraft.world.gen.chunk.placement.StructurePlacement (class_6874)
[yarn] `StructurePlacement.mapping`:

```
METHOD method_41639 shouldGenerate (Lnet/minecraft/class_7869;II)Z
	ARG 1 calculator  ARG 2 chunkX  ARG 3 chunkZ
METHOD method_41636 getLocatePos (Lnet/minecraft/class_1923;)Lnet/minecraft/class_2338;
	ARG 1 chunkPos
```

Used: `shouldGenerate(StructurePlacementCalculator, int, int)` (public, [src]) — the game's
own candidate gate (isStartChunk + frequency reduction + exclusion zone); `getLocatePos(
ChunkPos)` → `BlockPos` (public, [src]) — the marker/anchor position.

### net.minecraft.world.gen.chunk.placement.RandomSpreadStructurePlacement (class_6872)
[yarn] `RandomSpreadStructurePlacement.mapping`:

```
METHOD method_40169 getStartChunk (JII)Lnet/minecraft/class_1923;
	ARG 1 seed  ARG 3 chunkX  ARG 4 chunkZ
METHOD method_41632 getSpacing ()I
```

Used: `getStartChunk(long, int, int)` → `ChunkPos` (public; floors its chunk args to the
region via `Math.floorDiv(chunkX, spacing)`, [src] — so passing the region-origin chunk
selects the region), `getSpacing()`. The seed passed is `calculator.getStructureSeed()`,
exactly what vanilla `isStartChunk` does ([src]).

### net.minecraft.world.gen.chunk.placement.ConcentricRingsStructurePlacement (class_6871)
[yarn] header `CLASS net/minecraft/class_6871 net/minecraft/world/gen/chunk/placement/ConcentricRingsStructurePlacement`.
Used as an `instanceof` target and as the argument of `getPlacementPositions` only.

### net.minecraft.structure.StructureSet (class_7059) + WeightedEntry (class_7060)
[yarn] header `CLASS net/minecraft/class_7059 net/minecraft/structure/StructureSet`
(inner `CLASS class_7060 WeightedEntry`). Record accessors are not in the enigma file
(unrenamed record components); verified via [tiny] (class `ejx` = class_7059):

```
METHOD	ejx	()Ljava/util/List;	a	comp_510          → structures()
METHOD	ejx	()Leko;	b	comp_511                      → placement()   (eko = class_6874)
METHOD	ejx$a	()Ljm;	a	comp_512                      → WeightedEntry.structure()  (jm = class_6880)
```

and [src]: `public record StructureSet(List<StructureSet.WeightedEntry> structures,
StructurePlacement placement)` with `record WeightedEntry(RegistryEntry<Structure> structure,
int weight)`. Used: `structures()`, `placement()`, `WeightedEntry.structure()`.

### net.minecraft.world.gen.structure.Structure (class_3195)
[yarn] `world/gen/structure/Structure.mapping`:

```
METHOD method_41607 getValidBiomes ()Lnet/minecraft/class_6885;
METHOD method_41614 createStructureStart (Lnet/minecraft/class_5455;Lnet/minecraft/class_2794;Lnet/minecraft/class_1966;Lnet/minecraft/class_7138;Lnet/minecraft/class_3485;JLnet/minecraft/class_1923;ILnet/minecraft/class_5539;Ljava/util/function/Predicate;)Lnet/minecraft/class_3449;
	ARG 1 dynamicRegistryManager  ARG 2 chunkGenerator  ARG 3 biomeSource  ARG 4 noiseConfig
	ARG 5 structureTemplateManager  ARG 6 seed  ARG 8 chunkPos  ARG 9 references
	ARG 10 world  ARG 11 validBiomes
```

Used: `getValidBiomes()` → `RegistryEntryList<Biome>`; `createStructureStart(
DynamicRegistryManager, ChunkGenerator, BiomeSource, NoiseConfig, StructureTemplateManager,
long, ChunkPos, int, HeightLimitView, Predicate<RegistryEntry<Biome>>)` → `StructureStart`
(generics from [src]; returns `StructureStart.DEFAULT` when no valid position/children).

### net.minecraft.structure.StructureStart (class_3449)
[yarn] `structure/StructureStart.mapping`:

```
METHOD method_16657 hasChildren ()Z
```

Used: `hasChildren()` — the validity check (vanilla gates on exactly this, [src]).

### net.minecraft.structure.StructureTemplateManager (class_3485)
[yarn] header `CLASS net/minecraft/class_3485 net/minecraft/structure/StructureTemplateManager`.
Used as a type only (parameter of createStructureStart, from
`MinecraftServer#getStructureTemplateManager`).

---

## 4. Registries

### net.minecraft.registry.DynamicRegistryManager (class_5455)
[yarn] `registry/DynamicRegistryManager.mapping`:

```
METHOD method_30530 get (Lnet/minecraft/class_5321;)Lnet/minecraft/class_2378;
	COMMENT ... @throws IllegalStateException if the registry does not exist
CLASS class_6890 Immutable
```

Used: `get(RegistryKey)` → `Registry<E>` (1.21.1 name — the `getOrThrow` rename is 1.21.2+).
Hierarchy — [src] `DynamicRegistryManager.java` line 21:
`public interface DynamicRegistryManager extends RegistryWrapper.WrapperLookup` — which is
what makes `getWrapperOrThrow` available on `server.getRegistryManager()`.

### net.minecraft.registry.RegistryWrapper (class_7225) + WrapperLookup (class_7874) + Impl (class_7226)
[yarn] `registry/RegistryWrapper.mapping`:

```
CLASS class_7874 WrapperLookup
	METHOD method_46762 getWrapperOrThrow (Lnet/minecraft/class_5321;)Lnet/minecraft/class_7225$class_7226;
		ARG 1 registryRef
```

Hierarchy — [src] `RegistryWrapper.java`:
`public interface RegistryWrapper<T> extends RegistryEntryLookup<T>` and
`public interface Impl<T> extends RegistryWrapper<T>, RegistryEntryOwner<T>`.
So `getWrapperOrThrow(...)` → `RegistryWrapper.Impl<T>` satisfies BOTH the
`RegistryEntryLookup<NoiseParameters>` parameter of `NoiseConfig.create` and the
`RegistryWrapper<StructureSet>` parameter of `createStructurePlacementCalculator`.

### net.minecraft.registry.RegistryEntryLookup (class_7871)
[yarn] header `CLASS net/minecraft/class_7871 net/minecraft/registry/RegistryEntryLookup`.
Used as a parameter type only (see above).

### net.minecraft.registry.RegistryKeys (class_7924)
[yarn] `registry/RegistryKeys.mapping`:

```
FIELD field_41236 BIOME Lnet/minecraft/class_5321;
FIELD field_41246 STRUCTURE Lnet/minecraft/class_5321;
FIELD field_41248 STRUCTURE_SET Lnet/minecraft/class_5321;
FIELD field_41244 NOISE_PARAMETERS Lnet/minecraft/class_5321;
```

### net.minecraft.registry.Registry (class_2378)
[yarn] `registry/Registry.mapping`:

```
METHOD method_55841 getEntry (Lnet/minecraft/class_2960;)Ljava/util/Optional;
METHOD method_40266 getEntryList (Lnet/minecraft/class_6862;)Ljava/util/Optional;
METHOD method_40270 streamEntries ()Ljava/util/stream/Stream;
```

Used: `getEntry(Identifier)` → `Optional<RegistryEntry.Reference<T>>`,
`getEntryList(TagKey<T>)` → `Optional<RegistryEntryList.Named<T>>`,
`streamEntries()` → `Stream<RegistryEntry.Reference<T>>`.

### net.minecraft.registry.RegistryKey (class_5321)
[yarn] `registry/RegistryKey.mapping`:

```
METHOD method_29177 getValue ()Lnet/minecraft/class_2960;
```

Used: `getValue()` → `Identifier` (dimension ids, structure-set ids).

### net.minecraft.registry.entry.RegistryEntry (class_6880) + Reference (class_6883)
[yarn] `registry/entry/RegistryEntry.mapping`:

```
METHOD method_55840 getIdAsString ()Ljava/lang/String;
CLASS class_6883 Reference
	METHOD method_40237 registryKey ()Lnet/minecraft/class_5321;
```

`value()` has no enigma line (record component comp_349 keeps its name); [tiny]:
`METHOD	jm	()Ljava/lang/Object;	a	comp_349`, plus usage proof compiled against yarn
1.21.1 — [fabric] `https://raw.githubusercontent.com/FabricMC/fabric/1.21.1/fabric-biome-api-v1/src/main/java/net/fabricmc/fabric/impl/biome/modification/BiomeSelectionContextImpl.java`:
`... .getBiomes().stream().anyMatch(entry -> entry.value() == biome)`.
Used: `value()`, `getIdAsString()`, `Reference.registryKey()`.

### net.minecraft.registry.entry.RegistryEntryList (class_6885)
[yarn] `registry/entry/RegistryEntryList.mapping`:

```
METHOD method_40241 contains (Lnet/minecraft/class_6880;)Z
METHOD method_40246 of ([Lnet/minecraft/class_6880;)Lnet/minecraft/class_6885$class_6886;
CLASS class_6888 Named
```

Used: `contains(RegistryEntry<T>)` (biome predicate), static varargs `of(...)` →
`RegistryEntryList.Direct<T>` (single-structure /locate), `Named<T>` as a subtype of
`RegistryEntryList<T>` (tag /locate).

### net.minecraft.registry.tag.TagKey (class_6862)
[yarn] `registry/tag/TagKey.mapping`:

```
METHOD method_40092 of (Lnet/minecraft/class_5321;Lnet/minecraft/class_2960;)Lnet/minecraft/class_6862;
```

Used: `TagKey.of(RegistryKey<? extends Registry<T>>, Identifier)` for `#tag` /locate queries.

---

## 5. Biomes / colors

### net.minecraft.world.biome.Biome (class_1959)
[yarn] `world/biome/Biome.mapping`:

```
METHOD method_24377 getEffects ()Lnet/minecraft/class_4763;
```

Used: `getEffects()` only. (Note from the mapping agent: `getDownfall()` does NOT exist in
yarn 1.21.1 — downfall is a private field of Biome.Weather. This mod does not need downfall.)

### net.minecraft.world.biome.BiomeEffects (class_4763)
[yarn] `world/biome/BiomeEffects.mapping`:

```
METHOD method_30812 getGrassColor ()Ljava/util/Optional;
METHOD method_30811 getFoliageColor ()Ljava/util/Optional;
METHOD method_24388 getWaterColor ()I
```

Used: `getGrassColor()` → `Optional<Integer>`, `getFoliageColor()` → `Optional<Integer>`,
`getWaterColor()` → `int` (not optional). Palette order per the API contract. All getters
plus `Biome#getEffects` confirmed `public` from [src] `Biome.java` / `BiomeEffects.java`.

---

## 6. Math / util types

### net.minecraft.util.Identifier (class_2960)
[yarn] `util/Identifier.mapping`:

```
METHOD method_12829 tryParse (Ljava/lang/String;)Lnet/minecraft/class_2960;
METHOD method_12836 getNamespace ()Ljava/lang/String;
```

Used: `tryParse(String)` (null on invalid — mapped to bad_param/unknown_* errors),
`getNamespace()`, `toString()` (documented "namespace:path" form, class javadoc).
The constructor is not used (privatized in 1.21; javadoc Creation list has only the
factories).

### net.minecraft.util.math.BlockPos (class_2338) / Vec3i (class_2382)
[yarn] `util/math/Vec3i.mapping`:

```
CLASS net/minecraft/class_2382 net/minecraft/util/math/Vec3i
	METHOD method_10263 getX ()I
	METHOD method_10260 getZ ()I
```

[src] `BlockPos.java` line 69: `public BlockPos(int i, int j, int k)` — the (int,int,int)
constructor is public. Used: `new BlockPos(int,int,int)`, `getX()`, `getZ()` (inherited from
Vec3i).

### net.minecraft.util.math.ChunkPos (class_1923)
[yarn] `util/math/ChunkPos.mapping`:

```
FIELD field_9181 x I
FIELD field_9180 z I
METHOD <init> (II)V
	ARG 1 x  ARG 2 z
METHOD method_8326 getStartX ()I
METHOD method_8328 getStartZ ()I
```

Used: public fields `x`/`z` ([src] usage `chunkPos.x`), `new ChunkPos(int, int)`,
`getStartX()`, `getStartZ()`.

### net.minecraft.world.HeightLimitView (class_5539)
[yarn] header `CLASS net/minecraft/class_5539 net/minecraft/world/HeightLimitView`. Used as
a parameter type only; a `ServerWorld` is passed (hierarchy evidence in section 1).

### com.mojang.datafixers.util.Pair — third-party (DataFixerUpper), unobfuscated
Not a mapped Minecraft symbol. `getFirst()` / `getSecond()` usage proven by the vanilla
locate code compiled against the same library — [src] `server/command/LocateCommand.java`:
`BlockPos blockPos = result.getFirst();` and `result.getSecond().getIdAsString()`, plus
`private static final int LOCATE_STRUCTURE_RADIUS = 100;` and the call
`.locateStructure(serverWorld, registryEntryList, blockPos, 100, false)` — the radius and
skipReferencedStructures values this mod's /locate reproduces.

---

## 7. Fabric Loader / Fabric API

### net.fabricmc.api.DedicatedServerModInitializer
[fabric] `https://raw.githubusercontent.com/FabricMC/fabric-loader/0.16.14/src/main/java/net/fabricmc/api/DedicatedServerModInitializer.java`:
`void onInitializeServer()`; entrypoint key `"server"` per its javadoc.

### net.fabricmc.loader.api.FabricLoader / ModContainer / ModMetadata / Version
[fabric] `.../fabric-loader/0.16.14/src/main/java/net/fabricmc/loader/api/FabricLoader.java`:
`static FabricLoader getInstance()`, `Collection<ModContainer> getAllMods()`,
`Optional<ModContainer> getModContainer(String)`, `Path getConfigDir()`, `Path getGameDir()`.
[fabric] `.../ModContainer.java`: `ModMetadata getMetadata()`.
[fabric] `.../metadata/ModMetadata.java`: `String getId()`, `Version getVersion()`,
`String getName()`.
[fabric] `.../Version.java` line 31: `String getFriendlyString();`.

### net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents
[fabric] `https://raw.githubusercontent.com/FabricMC/fabric/1.21.1/fabric-lifecycle-events-v1/src/main/java/net/fabricmc/fabric/api/event/lifecycle/v1/ServerLifecycleEvents.java`:
`SERVER_STARTED` (`void onServerStarted(MinecraftServer)` — "all worlds are live"; fired on
the server thread from MinecraftServer#runServer) and `SERVER_STOPPING`
(`void onServerStopping(MinecraftServer)`). Registered via `.register(...)`.

### fabric.mod.json schema
[fabric] `https://raw.githubusercontent.com/FabricMC/fabric-example-mod/1.21/src/main/resources/fabric.mod.json`
(fields: schemaVersion/id/version/name/entrypoints/depends/...), with version bounds relaxed
to this project's pins (`fabricloader >=0.16.0`, `minecraft ~1.21.1`) per the mapping-agent
caveat that the example branch pins newer tooling.

---

## 8. Non-Minecraft libraries on the mod classpath

- **Gson** (`com.google.gson`) — bundled with Minecraft (JsonObject/JsonArray/JsonParser/
  JsonNull/Gson; `JsonParser.parseReader`/`parseString` and `JsonElement.deepCopy` are
  Gson ≥2.8.6 API, MC 1.21.1 bundles 2.10.x).
- **SLF4J** (`org.slf4j.Logger`, `LoggerFactory`) — provided by Fabric Loader's environment.
- **JDK**: `com.sun.net.httpserver.*`, `javax.imageio.ImageIO`, `java.awt.image.BufferedImage`
  and `java.*` — Java 21 standard modules (jdk.httpserver, java.desktop).

---

## 9. Deliberately avoided (flagged unresolved by the mapping agents)

- `Biome#getDownfall()` — does not exist in 1.21.1; not needed (palette uses BiomeEffects).
- `MultiNoiseUtil.MultiNoiseSampler` record-component accessors — unverifiable from
  mappings; samplers are only obtained via `NoiseConfig#getMultiNoiseSampler()`.
- `StructurePlacementCalculator.getStructureSetToPlacement` — does not exist; the mod uses
  `getStructureSets()` + `StructureSet#placement()` / `getPlacements(...)` instead.
- `Structure.getStructureSettings` — does not exist; the mod uses `getValidBiomes()`.
- `new Identifier(...)` — constructor privatized; only `Identifier.tryParse` is used.
- `World#getBiome` — never used anywhere (would load chunks; violates the oracle rule).
- `StructureAccessor` start queries — never used (force chunk generation; the placement
  calculator + `createStructureStart` are the chunk-load-free paths).
