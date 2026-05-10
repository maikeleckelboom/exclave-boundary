import { describe, expect, expectTypeOf, it } from "vitest";

import { defineSpec } from "../../src/spec/define";
import { keysOf } from "../../src/spec/keys";

describe("keysOf", () => {
  it("builds a nested mirror of canonical flat keys", () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: "dj-rig",
      params: {
        deck: {
          a: {
            transport: {
              tempo: param.f32({ min: 60, max: 200 }),
              playing: param.bool(),
              syncMode: param.enum(["free", "leader", "follower"]),
            },
            loop: {
              enabled: param.bool(),
              lengthBeats: param.u32({ min: 1, max: 64 }),
            },
            eq: {
              gains: param.f32.array(4),
            },
          },
          b: {
            transport: {
              tempo: param.f32({ min: 60, max: 200 }),
            },
          },
        },
        mixer: {
          crossfader: param.f32({ min: 0, max: 1 }),
          cue: {
            a: param.bool(),
            b: param.bool(),
          },
        },
      },
      meters: {
        deck: {
          a: {
            transport: {
              bpm: meter.f32(),
              beatPhase: meter.f32(),
            },
            audio: {
              peak: meter.f32(),
              spectrum: meter.f32.array(256),
            },
          },
        },
        engine: {
          xruns: meter.u32(),
          cpuLoad: meter.f32(),
        },
      },
    }));

    const k = keysOf(spec);

    expectTypeOf(
      k.params.deck.a.transport.tempo,
    ).toEqualTypeOf<"deck.a.transport.tempo">();
    expectTypeOf(
      k.params.deck.a.transport.playing,
    ).toEqualTypeOf<"deck.a.transport.playing">();
    expectTypeOf(
      k.params.deck.a.transport.syncMode,
    ).toEqualTypeOf<"deck.a.transport.syncMode">();
    expectTypeOf(
      k.params.deck.a.loop.enabled,
    ).toEqualTypeOf<"deck.a.loop.enabled">();
    expectTypeOf(
      k.params.deck.a.loop.lengthBeats,
    ).toEqualTypeOf<"deck.a.loop.lengthBeats">();
    expectTypeOf(k.params.deck.a.eq.gains).toEqualTypeOf<"deck.a.eq.gains">();
    expectTypeOf(
      k.params.deck.b.transport.tempo,
    ).toEqualTypeOf<"deck.b.transport.tempo">();
    expectTypeOf(k.params.mixer.crossfader).toEqualTypeOf<"mixer.crossfader">();
    expectTypeOf(k.params.mixer.cue.a).toEqualTypeOf<"mixer.cue.a">();
    expectTypeOf(k.params.mixer.cue.b).toEqualTypeOf<"mixer.cue.b">();

    expectTypeOf(
      k.meters.deck.a.transport.bpm,
    ).toEqualTypeOf<"deck.a.transport.bpm">();
    expectTypeOf(
      k.meters.deck.a.transport.beatPhase,
    ).toEqualTypeOf<"deck.a.transport.beatPhase">();
    expectTypeOf(
      k.meters.deck.a.audio.peak,
    ).toEqualTypeOf<"deck.a.audio.peak">();
    expectTypeOf(
      k.meters.deck.a.audio.spectrum,
    ).toEqualTypeOf<"deck.a.audio.spectrum">();
    expectTypeOf(k.meters.engine.xruns).toEqualTypeOf<"engine.xruns">();
    expectTypeOf(k.meters.engine.cpuLoad).toEqualTypeOf<"engine.cpuLoad">();

    expect(k.params.deck.a.transport.tempo).toBe("deck.a.transport.tempo");
    expect(k.params.deck.a.transport.playing).toBe("deck.a.transport.playing");
    expect(k.params.deck.a.transport.syncMode).toBe(
      "deck.a.transport.syncMode",
    );
    expect(k.params.deck.a.loop.enabled).toBe("deck.a.loop.enabled");
    expect(k.params.deck.a.loop.lengthBeats).toBe("deck.a.loop.lengthBeats");
    expect(k.params.deck.a.eq.gains).toBe("deck.a.eq.gains");
    expect(k.params.deck.b.transport.tempo).toBe("deck.b.transport.tempo");
    expect(k.params.mixer.crossfader).toBe("mixer.crossfader");
    expect(k.params.mixer.cue.a).toBe("mixer.cue.a");
    expect(k.params.mixer.cue.b).toBe("mixer.cue.b");

    expect(k.meters.deck.a.transport.bpm).toBe("deck.a.transport.bpm");
    expect(k.meters.deck.a.transport.beatPhase).toBe(
      "deck.a.transport.beatPhase",
    );
    expect(k.meters.deck.a.audio.peak).toBe("deck.a.audio.peak");
    expect(k.meters.deck.a.audio.spectrum).toBe("deck.a.audio.spectrum");
    expect(k.meters.engine.xruns).toBe("engine.xruns");
    expect(k.meters.engine.cpuLoad).toBe("engine.cpuLoad");

    expect(Object.isFrozen(k)).toBe(true);
    expect(Object.isFrozen(k.params)).toBe(true);
    expect(Object.isFrozen(k.params.deck)).toBe(true);
    expect(Object.isFrozen(k.params.deck.a.transport)).toBe(true);
    expect(Object.isFrozen(k.meters)).toBe(true);
    expect(Object.isFrozen(k.meters.deck.a.audio)).toBe(true);
    expect(Object.isFrozen(k.meters.engine)).toBe(true);

    const fakeParamState: Record<string, number | boolean> = {
      "deck.a.transport.tempo": 128,
      "mixer.crossfader": 0.5,
      "deck.a.transport.playing": true,
    };

    expect(fakeParamState[k.params.deck.a.transport.tempo]).toBe(128);
    expect(fakeParamState[k.params.mixer.crossfader]).toBe(0.5);
    expect(fakeParamState[k.params.deck.a.transport.playing]).toBe(true);
  });

  it("returns empty mirrors when params or meters are absent", () => {
    const paramsOnly = defineSpec(({ param }) => ({
      id: "params-only",
      params: {
        gain: param.f32({ min: 0, max: 1 }),
      },
    }));

    const metersOnly = defineSpec(({ meter }) => ({
      id: "meters-only",
      meters: {
        peak: meter.f32(),
      },
    }));

    const kp = keysOf(paramsOnly);
    const km = keysOf(metersOnly);

    expect(kp.params.gain).toBe("gain");
    expect(kp.meters).toEqual({});

    expect(km.params).toEqual({});
    expect(km.meters.peak).toBe("peak");
  });
});
