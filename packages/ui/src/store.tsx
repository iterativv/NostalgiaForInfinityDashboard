// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useEffect, useState } from "react";
import { Store } from "@tanstack/store";
import { shallow, useStore } from "@tanstack/react-store";
import { isFunction } from "@tanstack/react-table";

/**
 * TanStack Store state hooks — the sanctioned replacement for component-local
 * React state primitives (`useState`, `useRef`, `useMemo`).
 *
 * Application components must NOT call React state hooks directly; they hold
 * state in `Store` instances created here and read it through
 * `useStore`/`useDerived`, so every piece of UI state flows through the same
 * TanStack Store substrate the app already uses for global state.
 *
 * The React primitives below exist only inside this module — the single
 * framework boundary, exactly like `@tanstack/react-store`'s own `useStore`
 * wraps `useSyncExternalStore`.
 */

/**
 * Component-scoped `Store`, created once per component instance.
 *
 * Read with `useStore(store, selector?)`, write with `store.setState`.
 */
export function useLocalStore<T>(initial: T | (() => T)): Store<T> {
  const [store] = useState(() => {
    // SAFETY: the `T | (() => T)` union is this API's own contract and
    // `isFunction` discriminates the function arm, so the call is the
    // caller-declared lazy initializer.
    const seed = isFunction(initial) ? (initial as () => T)() : initial;

    return new Store<T>(seed);
  });

  return store;
}

/**
 * Store that always mirrors `value` (props, query results, derived inputs).
 *
 * Writes happen only when the reference actually changed — `Store.setState`
 * is an identity-compare no-op for equal references, so re-renders with the
 * same value never notify subscribers. This is what makes it safe to call
 * during render, and it gives `useStore` selectors a stable store to
 * memoize against.
 */
export function useSyncedStore<T>(value: T): Store<T> {
  const store = useLocalStore(value);

  if (store.state !== value) {
    store.setState(() => value);
  }

  return store;
}

/**
 * `useMemo` replacement: derives `R` from any `value` through a TanStack
 * Store.
 *
 * The derivation reruns only when the input changes per `inputs` (default:
 * reference equality — pass `shallow` for a deps array); the derived
 * reference is kept when the new output compares equal per `output`, so
 * downstream stores/tables see a stable value exactly like `useMemo` gave.
 */
export interface DerivedOptions<T, R> {
  /** Input comparison (default `Object.is`); use `shallow` for dep arrays. */
  readonly inputs?: (a: T, b: T) => boolean;
  /** Output comparison (default `Object.is`); keeps the old reference on equal. */
  readonly output?: (a: R, b: R) => boolean;
}

interface DerivedState<T, R> {
  input: T;
  output: R;
}

export function useDerived<T, R>(
  value: T,
  derive: (value: T) => R,
  options: DerivedOptions<T, R> = {},
): R {
  const inputs = options.inputs ?? Object.is;
  const output = options.output ?? Object.is;

  const store = useLocalStore<DerivedState<T, R>>(() => ({
    input: value,
    output: derive(value),
  }));

  // Identity-compare store: the write (and its notification) only happens
  // when the inputs actually changed; an unchanged derivation keeps both the
  // output reference and the subscribers asleep.
  if (!inputs(store.state.input, value)) {
    const next = derive(value);

    store.setState((prev) =>
      output(next, prev.output)
        ? { input: value, output: prev.output }
        : { input: value, output: next },
    );
  }

  return useStore(store, (state: DerivedState<T, R>) => state.output);
}

/**
 * `useRef`-for-DOM replacement: a `Store` holding the latest element,
 * plus a stable setter to pass as the `ref` callback. The setter identity
 * never changes for a component instance, so React never detaches/reattaches
 * the element between renders.
 */
export interface ElementStoreBinding<T extends Element> {
  readonly store: Store<T | null>;
  readonly setElement: (element: T | null) => void;
}

export function useElementStore<T extends Element>(): ElementStoreBinding<T> {
  const [[store, setElement]] = useState(() => {
    const elementStore = new Store<T | null>(null);

    return [
      elementStore,
      (element: T | null) => {
        elementStore.setState(() => element);
      },
    ] as const;
  });

  return { store, setElement };
}

/**
 * Sanctioned lifecycle hook for wiring EXTERNAL systems (chart libraries,
 * DOM listeners, timers) into stores. Pure state syncing should live in
 * stores/selectors instead — reach for this only when an imperative
 * subscription or teardown is unavoidable.
 */
export function useStoreEffect(
  setup: () => void | (() => void),
  deps: readonly unknown[],
): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- wrapper hook: `deps` is the caller's array by contract and `setup`'s identity is intentionally not a dependency (same contract as useEffect itself).
  useEffect(() => setup(), deps);
}

/**
 * Debounced mirror of `value`, held in a TanStack Store.
 *
 * The search text is part of stream subscription keys (`capabilityKey`), so
 * every distinct value re-subscribes (REST refetch + SSE reopen, itself
 * debounced in the pool). Updating the subscribed value only after the user
 * pauses typing keeps per-keystroke resubscription storms off the backend
 * while the input itself stays instant.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const store = useLocalStore(value);

  useStoreEffect(() => {
    const timer = setTimeout(() => store.setState(() => value), delayMs);

    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return useStore(store, (state) => state);
}

export { shallow, useStore };
