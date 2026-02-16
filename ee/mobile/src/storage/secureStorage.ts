import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export type SecureStorageKey = string;

export type SecureStorage = {
  getItem(key: SecureStorageKey): Promise<string | null>;
  setItem(key: SecureStorageKey, value: string): Promise<void>;
  deleteItem(key: SecureStorageKey): Promise<void>;
};

async function webFallbackGet(key: string): Promise<string | null> {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function webFallbackSet(key: string, value: string): Promise<void> {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

async function webFallbackDelete(key: string): Promise<void> {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(key);
  } catch {
    return;
  }
}

export const secureStorage: SecureStorage = {
  async getItem(key) {
    if (Platform.OS === "web") return webFallbackGet(key);
    return SecureStore.getItemAsync(key);
  },
  async setItem(key, value) {
    if (Platform.OS === "web") return webFallbackSet(key, value);
    await SecureStore.setItemAsync(key, value);
  },
  async deleteItem(key) {
    if (Platform.OS === "web") return webFallbackDelete(key);
    await SecureStore.deleteItemAsync(key);
  },
};

export async function getSecureJson<T>(key: SecureStorageKey): Promise<T | null> {
  const value = await secureStorage.getItem(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function setSecureJson<T>(key: SecureStorageKey, value: T): Promise<void> {
  await secureStorage.setItem(key, JSON.stringify(value));
}
