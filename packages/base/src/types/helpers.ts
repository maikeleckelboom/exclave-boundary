/**
 * Assert that a boolean type is literally `true`.
 *
 * If `T` is not exactly `true`, this fails to compile at the use site.
 */
export type AssertTrue<T extends true> = T;

/**
 * Compute whether `Sub` is assignable to `Super`.
 *
 * Result is a boolean *type* (true | false), with no constraints.
 */
export type IsExtends<Sub, Super> = Sub extends Super ? true : false;

/**
 * Compute whether two union types are exactly equal
 * (same members, ignoring order).
 *
 * Result is a boolean *type* (true | false), with no constraints.
 */
export type IsExact<A, B> =
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
