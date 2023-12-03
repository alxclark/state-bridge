import { SyncSubscribable } from "@remote-ui/async-subscription";
import {
  MapArray,
  createMapArrayRemoteSubscribable,
  makeStatefulListSubscribable,
} from "../async-subscribable";

jest.mock("@remote-ui/rpc", () => ({
  retain: jest.fn(),
  release: jest.fn(),
}));

const { retain, release } = jest.requireMock("@remote-ui/rpc") as {
  retain: jest.Mock;
  release: jest.Mock;
};

describe("makeStatefulListSubscribable()", () => {
  beforeEach(() => {
    release.mockReset();
    retain.mockReset();
  });

  it("retains the subscription", () => {
    const subscription = createMapArrayRemoteSubscribable({
      current: [],
      subscribe: () => {
        return () => {};
      },
    });

    makeStatefulListSubscribable(subscription);
    expect(retain).toHaveBeenCalledWith(subscription);
  });

  it("keeps track of the current value", async () => {
    const hostSubscription = createSyncSubscribable<
      MapArray<{ title: string }>
    >([["1", { title: "hello" }]]);

    const remoteSubscription =
      createMapArrayRemoteSubscribable(hostSubscription);
    const statefulSubscription = await makeStatefulListSubscribable(
      remoteSubscription
    );

    hostSubscription.update([]);

    expect(statefulSubscription.current).toStrictEqual([]);

    hostSubscription.update([
      ["2", { title: "hello" }],
      ["3", { title: "hello" }],
    ]);

    expect(statefulSubscription.current).toStrictEqual([
      ["2", { title: "hello" }],
      ["3", { title: "hello" }],
    ]);
  });

  it("calls subscribers on the remote", async () => {
    const firstItem: MapArray<{ title: string }>[0] = ["1", { title: "First" }];
    const secondItem: MapArray<{ title: string }>[0] = [
      "2",
      { title: "Second" },
    ];

    const hostSubscription = createSyncSubscribable([firstItem]);

    const remoteSubscription =
      createMapArrayRemoteSubscribable(hostSubscription);
    const statefulSubscription = await makeStatefulListSubscribable(
      remoteSubscription
    );

    const subscriber = jest.fn();
    statefulSubscription.subscribe(subscriber);

    hostSubscription.update([firstItem, secondItem]);

    expect(subscriber).toHaveBeenCalledWith([firstItem, secondItem]);
  });

  it("when the list on the host changes, only send new items and ids of removed elements", async () => {
    const firstItem: MapArray<{ title: string }>[0] = ["1", { title: "First" }];
    const secondItem: MapArray<{ title: string }>[0] = [
      "2",
      { title: "Second" },
    ];
    const thirdItem: MapArray<{ title: string }>[0] = ["3", { title: "Third" }];

    const hostSubscription = createSyncSubscribable([firstItem, secondItem]);

    const remoteSubscription =
      createMapArrayRemoteSubscribable(hostSubscription);

    const subscriber = jest.fn();
    remoteSubscription.subscribe(subscriber);

    hostSubscription.update([firstItem, thirdItem]);

    expect(subscriber).toHaveBeenCalledWith(
      {
        added: [thirdItem],
        removed: [secondItem[0]],
      },
      { version: 2 }
    );
  });

  it("initializes the stateful subscription with the latest state of the host subscription", async () => {
    const firstItem: MapArray<{ title: string }>[0] = ["1", { title: "First" }];
    const secondItem: MapArray<{ title: string }>[0] = [
      "2",
      { title: "Second" },
    ];

    const hostSubscription = createSyncSubscribable([firstItem]);

    const remoteSubscription =
      createMapArrayRemoteSubscribable(hostSubscription);

    hostSubscription.update([secondItem]);

    const statefulSubscription = await makeStatefulListSubscribable(
      remoteSubscription
    );

    expect(statefulSubscription.current).toStrictEqual([secondItem]);
  });
});

function createSyncSubscribable<T>(
  initial: T
): SyncSubscribable<T> & { update(value: T): void } {
  let current = initial;
  const subscribers = new Set<
    Parameters<SyncSubscribable<T>["subscribe"]>[0]
  >();

  return {
    get current() {
      return current;
    },
    update(value) {
      current = value;

      for (const subscriber of subscribers) {
        subscriber(value);
      }
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  };
}
