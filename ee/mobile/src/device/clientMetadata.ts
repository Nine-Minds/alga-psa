import { Platform } from "react-native";
import * as Application from "expo-application";
import { secureStorage } from "../storage/secureStorage";

const DEVICE_ID_KEY = "alga.mobile.deviceId";

export async function getStableDeviceId(): Promise<string | undefined> {
  const existing = await secureStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  try {
    const deviceId =
      Platform.OS === "ios"
        ? (await Application.getIosIdForVendorAsync()) ?? undefined
        : Platform.OS === "android"
          ? (await Application.getAndroidId()) ?? undefined
          : undefined;

    if (deviceId) await secureStorage.setItem(DEVICE_ID_KEY, deviceId);
    return deviceId;
  } catch {
    return undefined;
  }
}

export async function getClientMetadataHeaders(): Promise<Record<string, string | undefined>> {
  const deviceId = await getStableDeviceId();
  return {
    "x-alga-platform": Platform.OS,
    "x-alga-app-version": Application.nativeApplicationVersion ?? undefined,
    "x-alga-app-build": Application.nativeBuildVersion ?? undefined,
    "x-alga-device-id": deviceId,
  };
}

