export interface EngineInstance<K extends number = number> {
  readonly kind: K;
  render(dst: Float32Array, frames: number): void;
}

export interface EngineBank<
  K extends number,
  TInstance extends EngineInstance<K>,
> {
  register(engine: TInstance): void;
  get(kind: K): TInstance | null;
  unregister(kind: K): void;
}

/**
 * Simple Map-backed implementation for tests and basic lanes.
 */
export class SimpleEngineBank<
  K extends number,
  TInstance extends EngineInstance<K>,
> implements EngineBank<K, TInstance>
{
  private readonly map = new Map<K, TInstance>();

  register(engine: TInstance): void {
    this.map.set(engine.kind, engine);
  }

  unregister(kind: K): void {
    this.map.delete(kind);
  }

  get(kind: K): TInstance | null {
    return this.map.get(kind) ?? null;
  }
}
