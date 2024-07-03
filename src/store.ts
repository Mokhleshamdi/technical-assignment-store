import { JSONObject, JSONArray, JSONPrimitive, JSONValue } from "./json-types";

export type Permission = "r" | "w" | "rw" | "none";

export type StoreResult = Store | JSONPrimitive | undefined;

export type StoreValue =
  | JSONObject
  | JSONArray
  | StoreResult
  | (() => StoreResult);

export interface IStore {
  defaultPolicy: Permission;
  allowedToRead(key: string): boolean;
  allowedToWrite(key: string): boolean;
  read(path: string): StoreResult;
  write(path: string, value: StoreValue): StoreValue;
  writeEntries(entries: JSONObject): void;
  entries(): JSONObject;
}

// Restrict Decorator Implementation
export function Restrict(permission: Permission = "none"): any {
  return function (target: any, propertyKey: string | symbol) {
    const key = propertyKey.toString();
    if (!target.constructor.restrictedProperties) {
      target.constructor.restrictedProperties = {};
    }
    target.constructor.restrictedProperties[key] = permission;
  };
}

// Helper function to check permissions
function getPermission(
  target: any,
  key: string,
  action: "r" | "w" | "rw"
): boolean {
  const permissions = (target.constructor as any).restrictedProperties || {};
  const specificPermission = permissions[key];
  if (specificPermission) {
    return specificPermission.includes(action);
  }
  return target.defaultPolicy.includes(action);
}

export class Store implements IStore {
  defaultPolicy: Permission = "rw";
  protected store: { [key: string]: StoreValue } = {};

  allowedToRead(key: string): boolean {
    return getPermission(this, key, "r");
  }

  allowedToWrite(key: string): boolean {
    return getPermission(this, key, "w");
  }

 read(path: string): StoreResult {
  const keys = path.split(":");
  let current: any = this;

  for (const key of keys) {
    if (!current.allowedToRead(key)) {
      throw new Error(`Reading "${key}" is not allowed.`);
    }

    if (typeof current[key] === "function") {
      current = current[key]();
    } else if (current[key] instanceof Store) {
      current = current[key];
    } else if (current.store && key in current.store) {
      current = current.store[key];
    } else {
      return undefined;
    }
  }

  return current instanceof Store ? current.entries() : current;
}


  write(path: string, value: StoreValue): StoreValue {
    const keys = path.split(":");
    let current: any = this;

    keys.slice(0, -1).forEach((key, index) => {
      if (!current.allowedToWrite(key)) {
        throw new Error(`Write access denied for key: ${keys.slice(0, index + 1).join(":")}`);
      }
      if (!(key in current.store)) {
        current.store[key] = new Store();
      }
      current = current.store[key];
    });

    const finalKey = keys[keys.length - 1];
    if (!current.allowedToWrite(finalKey)) {
      throw new Error(`Write access denied for key: ${path}`);
    }

    current.store[finalKey] = value;
    return value;
  }

  writeEntries(entries: JSONObject): void {
    Object.entries(entries).forEach(([key, value]) => {
      this.write(key, value as StoreValue);
    });
  }

  entries(): JSONObject {
    const result: JSONObject = {};
    Object.entries(this.store).forEach(([key, value]) => {
      if (this.allowedToRead(key)) {
        if (value instanceof Store) {
          result[key] = value.entries();
        } else if (typeof value === "function") {
          const resultValue = value();
          if (resultValue instanceof Store) {
            result[key] = resultValue.entries();
          } else {
            result[key] = resultValue as JSONValue;
          }
        } else {
          result[key] = value as JSONValue;
        }
      }
    });

    const restrictedProperties = (this.constructor as any).restrictedProperties || {};
    Object.entries(restrictedProperties).forEach(([key, permission]) => {
      if (this.allowedToRead(key)) {
        result[key] = (this as any)[key];
      }
    });

    return result;
  }
}
