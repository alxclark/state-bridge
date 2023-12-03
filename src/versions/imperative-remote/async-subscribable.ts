import { retain, release, MaybePromise } from "@remote-ui/rpc";

import type {
  SyncSubscribable,
  RemoteSubscribable,
  StatefulRemoteSubscribable,
} from "@remote-ui/async-subscription";

export type Subscriber<T> = (value: T) => void;

export type MapArray<Value, Key = string> = [Key, Value][];

export interface MapArrayRemoteSubscribable<T>
  extends Omit<RemoteSubscribable<MapArray<T>>, "subscribe"> {
  /**
   * A discriminant to allow easier unwrapping of subscribable maps.
   */
  brand: "map";
  /**
   * An enhanced subscribe method that returns a delta of changes that happened to the array/map.
   * A second argument is provided containing a version number for remotes to ensure they
   * are on the correct version of the data and can safely apply the delta to their own representation.
   */
  subscribe(
    subscriber: (delta: Delta<T>, options: { version: number }) => void
  ): MaybePromise<[() => void, { version: number }]>;
  /**
   * Returns the full current value of the subscribable set.
   * This is used by remotes when they detect they are out of sync with the host.
   * This forces the host to serialize a large payload and is expensive, but ensures accuracy
   */
  getCurrent(): Promise<{ value: MapArray<T>; version: number }>;
}

export interface StatefulRemoteSubscribableSet<T> extends SyncSubscribable<T> {
  destroy(): Promise<void>;
}

export interface Delta<T> {
  added: MapArray<T>;
  removed: string[];
}

/**
 * A remote subscribable that is optimized for map-like arrays
 * (where the position of elements is unimportant).
 *
 * This subscribable sends a delta of the changes that happened to an array
 * instead of sending the complete state. This minimizes the amount of data
 * needed to communicate between the host and remote for simple data structures.
 */
export function createMapArrayRemoteSubscribable<T>(
  subscription: SyncSubscribable<MapArray<T>>
): MapArrayRemoteSubscribable<T> {
  const initial = subscription.current;

  const current = initial;
  let version = 1;

  return {
    brand: "map",
    initial,
    subscribe(subscriber) {
      retain(subscriber);

      const unsubscribe = subscription.subscribe(
        (next = subscription.current) => {
          version++;

          const delta: Delta<T> = {
            added: next.filter(
              ([nextkey]) =>
                !current.some(([currentKey]) => currentKey === nextkey)
            ),
            removed: current
              .filter(
                ([currentKey]) =>
                  !next.some(([nextKey]) => currentKey === nextKey)
              )
              .map(([key]) => key),
          };

          subscriber(delta, { version });
        }
      );

      const teardown = () => {
        unsubscribe();
        release(subscriber);
      };

      return [teardown, { version }];
    },
    async getCurrent() {
      return { value: subscription.current, version };
    },
  };
}

// Contratry to the async remote subscribably, we do not send the full state
// from the host everytime a consumer subscribes to the remote subscription.
export async function makeStatefulListSubscribable<T>(
  subscription: MapArrayRemoteSubscribable<T>
): Promise<StatefulRemoteSubscribable<MapArray<T>>> {
  // We retain because it will automatically retain any functions we get from
  // calling functions on this object, which will automatically manage the memory
  // for unsubscribe callbacks received from subscription.subscribe().
  retain(subscription);

  let current = subscription.initial;

  let listening = true;
  let version = 1;

  // Fetch the latest value from the host.
  // This is needed since `initial` on the subscription
  // is the value when we initialized the subscription on the host,
  // not when we created the subscription on the remote.

  const latest = await subscription.getCurrent();

  current = latest.value;
  version = latest.version;

  const subscribers = new Set<Subscriber<MapArray<T>>>();

  const subscriptionResult = Promise.resolve<[() => void, { version: number }]>(
    subscription.subscribe((delta, options) =>
      listener(delta, options, subscription)
    )
  );

  return {
    get current() {
      return current;
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);

      return () => {
        subscribers.delete(subscriber);
      };
    },
    async destroy() {
      listening = false;
      subscribers.clear();

      const [unsubscribe] = await subscriptionResult;
      unsubscribe();
      release(subscription);
    },
  };

  async function listener(
    value: Delta<T> | MapArray<T>,
    options: { version: number },
    subscription?: MapArrayRemoteSubscribable<T>
  ) {
    version++;
    const nextVersion = options.version;

    if (nextVersion !== version && subscription) {
      // We are out of sync with the host, so we need to request the full state
      // and apply it. We also bump the version number even if versions have been skipped.
      const result = await subscription.getCurrent();
      current = result.value;
      // eslint-disable-next-line require-atomic-updates
      version = result.version;
    }

    if (!listening) return;

    if ("added" in value) {
      value.added.forEach(([key, value]) => {
        current.push([key, value]);
      });
      current = current.filter(([key]) => !value.removed.includes(key));
    } else {
      current = value;
    }

    for (const subscriber of subscribers) {
      subscriber(current);
    }
  }
}
