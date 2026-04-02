import React from "react";
import { Image, Text } from "react-native";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", async () => {
  const actual = await vi.importActual<typeof import("react-native")>("react-native");
  return {
    ...actual,
    Image: actual.Image ?? ((props: Record<string, unknown>) => React.createElement("Image", props)),
  };
});

import { Avatar } from "./Avatar";

function renderAvatar(props: Parameters<typeof Avatar>[0]) {
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(React.createElement(Avatar, props));
  });
  return renderer!;
}

describe("Avatar", () => {
  it("renders initials when no image is provided", () => {
    const renderer = renderAvatar({ name: "John Doe" });
    const texts = renderer.root.findAllByType(Text);
    expect(texts.some((t) => t.props.children === "JD")).toBe(true);
  });

  it("renders image when imageUri is provided", () => {
    const renderer = renderAvatar({ name: "John Doe", imageUri: "https://example.com/avatar.png" });
    const image = renderer.root.findByType(Image);
    expect(image.props.source.uri).toBe("https://example.com/avatar.png");
  });

  it("uses transparent background when image is shown", () => {
    const renderer = renderAvatar({ name: "John Doe", imageUri: "https://example.com/avatar.png" });
    const container = renderer.root.findAll((node) =>
      node.props?.style?.borderRadius != null && node.props?.style?.backgroundColor != null,
    )[0];
    expect(container.props.style.backgroundColor).toBe("transparent");
  });

  it("uses colored background when showing initials (no image)", () => {
    const renderer = renderAvatar({ name: "John Doe" });
    const container = renderer.root.findAll((node) =>
      node.props?.style?.borderRadius != null && node.props?.style?.backgroundColor != null,
    )[0];
    expect(container.props.style.backgroundColor).not.toBe("transparent");
  });

  it("falls back to colored background after image load error", () => {
    const renderer = renderAvatar({ name: "John Doe", imageUri: "https://example.com/broken.png" });

    // Simulate image error
    act(() => {
      renderer.root.findByType(Image).props.onError();
    });

    // Should now show initials with colored background
    const container = renderer.root.findAll((node) =>
      node.props?.style?.borderRadius != null && node.props?.style?.backgroundColor != null,
    )[0];
    expect(container.props.style.backgroundColor).not.toBe("transparent");
    const texts = renderer.root.findAllByType(Text);
    expect(texts.some((t) => t.props.children === "JD")).toBe(true);
  });

  it("sends auth token as x-api-key header", () => {
    const renderer = renderAvatar({
      name: "John",
      imageUri: "https://example.com/avatar.png",
      authToken: "secret-key",
    });
    const image = renderer.root.findByType(Image);
    expect(image.props.source.headers).toEqual({ "x-api-key": "secret-key" });
  });
});
