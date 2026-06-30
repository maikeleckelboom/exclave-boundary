import type {
  SignalsmithStretchModule,
  SignalsmithStretchModuleFactory,
} from "../signalsmith/module-types";

interface SignalsmithModuleImport {
  readonly default?: SignalsmithStretchModuleFactory;
  readonly SignalsmithStretchModule?: SignalsmithStretchModuleFactory;
}

interface SignalsmithModuleGlobal {
  readonly __SIGNALSMITH_STRETCH_MODULE_FACTORY__?:
    | SignalsmithStretchModuleFactory
    | undefined;
}

export async function loadSignalsmithStretchModule(
  moduleUrl: string,
): Promise<SignalsmithStretchModule> {
  const bundledFactory = (globalThis as SignalsmithModuleGlobal)
    .__SIGNALSMITH_STRETCH_MODULE_FACTORY__;

  if (bundledFactory) {
    return bundledFactory();
  }

  const imported = (await import(
    /* @vite-ignore */ moduleUrl
  )) as SignalsmithModuleImport;
  const factory = imported.default ?? imported.SignalsmithStretchModule;

  if (!factory) {
    throw new Error("Generated Signalsmith module did not export a factory.");
  }

  return factory();
}
