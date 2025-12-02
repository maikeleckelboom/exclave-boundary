import type { DomainName } from "./all-domains";
import type {
  ErrorDescriptor as RegistryDescriptor,
  ErrorNumericCode,
} from "@seqlok/base";

export interface AggregatedErrorDescriptor extends RegistryDescriptor {
  readonly domain: DomainName;
  readonly key: string;
  readonly numericCode: ErrorNumericCode;
}
