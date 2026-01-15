import type { EngineInstance } from "./engine-bank";
import type { LanePluginPack } from "./lane-plugins";
import type { EngineDefinition } from "../engine/definition";
import type { SpecInput } from "@seqlok/core";

export interface LaneKindConfig<
  S extends SpecInput,
  TConfig,
  EngineKindEnum extends number,
  Command,
  EventPayload,
  TInstance extends EngineInstance<EngineKindEnum>,
> {
  readonly id: string;
  readonly engine: EngineDefinition<
    S,
    TConfig,
    EngineKindEnum,
    Command,
    EventPayload,
    TInstance
  >;
  /**
   * Optional plugin pack. If omitted, the lane kind has no plugins.
   */
  readonly plugins?: LanePluginPack<S>;
}

/**
 * Static description of a lane kind (e.g. "stretch", "deck", "bus", "analyzer").
 *
 * This lives purely in the host / topology layer. It does not know about
 * AudioWorklet, worklet-mount contracts, or shared-memory ABI.
 */
export interface LaneKind<
  S extends SpecInput,
  TConfig,
  EngineKindEnum extends number,
  Command,
  EventPayload,
  TInstance extends EngineInstance<EngineKindEnum>,
> {
  readonly id: string;
  readonly engine: EngineDefinition<
    S,
    TConfig,
    EngineKindEnum,
    Command,
    EventPayload,
    TInstance
  >;
  readonly plugins: LanePluginPack<S>;
}

/**
 * Define a lane kind for a given engine family and plugin pack.
 */
export function defineLaneKind<
  S extends SpecInput,
  TConfig,
  EngineKindEnum extends number,
  Command,
  EventPayload,
  TInstance extends EngineInstance<EngineKindEnum>,
>(
  config: LaneKindConfig<
    S,
    TConfig,
    EngineKindEnum,
    Command,
    EventPayload,
    TInstance
  >,
): LaneKind<S, TConfig, EngineKindEnum, Command, EventPayload, TInstance> {
  const { id, engine, plugins } = config;

  const effectivePlugins: LanePluginPack<S> = plugins ?? {
    observers: [],
    processors: [],
  };

  return {
    id,
    engine,
    plugins: effectivePlugins,
  };
}
