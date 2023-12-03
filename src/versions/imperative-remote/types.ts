import { Todo } from "../../types";

export interface ItemWithId {
  id: string;
}

export interface AddOptions {
  listId: string;
  position: number;
}
export interface MoveOptions {
  listId: string;
  position: number;
}

export interface BridgeApi<ListItem extends ItemWithId> {
  add(item: ListItem, options: AddOptions): void;
  remove(item: ListItem["id"]): void;
  move(item: ListItem["id"], options: MoveOptions): void;
  update(item: Partial<ListItem>): void;
}

// Example specific ---------------

export type TodoApi = BridgeApi<Todo>;
