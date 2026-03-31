import React, { useState } from "react";
import { Image, Text, View } from "react-native";

const SIZES = { sm: 28, md: 36, lg: 48 } as const;

const AVATAR_COLORS = [
  "#6366F1", // indigo
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#F97316", // orange
  "#14B8A6", // teal
  "#06B6D4", // cyan
  "#84CC16", // lime
  "#EAB308", // yellow
] as const;

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === "") return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  imageUri,
  authToken,
  size = "md",
  accessibilityLabel,
}: {
  name?: string;
  /** Remote image URL for the avatar. Falls back to initials on load failure. */
  imageUri?: string | null;
  /** API key / bearer token sent as x-api-key header when loading the image. */
  authToken?: string | null;
  size?: "sm" | "md" | "lg";
  accessibilityLabel?: string;
}) {
  const dim = SIZES[size];
  const displayName = name ?? "?";
  const bgColor = AVATAR_COLORS[hashName(displayName) % AVATAR_COLORS.length];
  const initials = name ? getInitials(name) : "?";
  const fontSize = dim * 0.4;
  const [imgFailed, setImgFailed] = useState(false);

  const showImage = Boolean(imageUri) && !imgFailed;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? (name ? `Avatar for ${name}` : "Avatar")}
      style={{
        width: dim,
        height: dim,
        borderRadius: dim / 2,
        backgroundColor: showImage ? "transparent" : bgColor,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {showImage ? (
        <Image
          source={{
            uri: imageUri!,
            ...(authToken ? { headers: { "x-api-key": authToken } } : undefined),
          }}
          style={{ width: dim, height: dim }}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <Text
          style={{
            color: "#FFFFFF",
            fontSize,
            fontWeight: "600",
            lineHeight: fontSize * 1.2,
          }}
        >
          {initials}
        </Text>
      )}
    </View>
  );
}
