import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { MentionSuggestionList, type MentionSuggestionItem } from "./MentionSuggestionList";

vi.mock("../../ui/components/Avatar", () => ({
  Avatar: (props: Record<string, unknown>) => React.createElement("MockAvatar", props),
}));

const users: MentionSuggestionItem[] = [
  { user_id: "@everyone", username: "everyone", display_name: "Everyone", avatar_url: null },
  { user_id: "u-1", username: "alice", display_name: "Alice Smith", avatar_url: "/avatars/alice.png" },
  { user_id: "u-2", username: "bob", display_name: "Bob Jones", avatar_url: null },
];

function renderList(
  props: Partial<React.ComponentProps<typeof MentionSuggestionList>> = {},
): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(
      React.createElement(MentionSuggestionList, {
        loading: false,
        users,
        onSelect: () => undefined,
        ...props,
      }),
    );
  });
  if (!renderer) throw new Error("Renderer was not created");
  return renderer;
}

function findMentionPressables(renderer: ReactTestRenderer) {
  return renderer.root.findAll(
    (node) =>
      (node.type as string) === "Pressable"
      && typeof node.props.accessibilityLabel === "string"
      && node.props.accessibilityLabel.startsWith("Mention "),
  );
}

describe("MentionSuggestionList", () => {
  it("renders nothing when loading is false and users is empty", () => {
    const renderer = renderList({ users: [], loading: false });
    expect(renderer.toJSON()).toBeNull();
  });

  it("renders a loading indicator when loading and users is empty", () => {
    const renderer = renderList({ users: [], loading: true });
    const indicator = renderer.root.findAll((node) => (node.type as string) === "ActivityIndicator");
    expect(indicator).toHaveLength(1);
  });

  it("renders one pressable row per user", () => {
    const renderer = renderList();
    const pressables = findMentionPressables(renderer);
    expect(pressables).toHaveLength(3);
    expect(pressables[0].props.accessibilityLabel).toBe("Mention Everyone");
    expect(pressables[1].props.accessibilityLabel).toBe("Mention Alice Smith");
    expect(pressables[2].props.accessibilityLabel).toBe("Mention Bob Jones");
  });

  it("calls onSelect with the tapped user", () => {
    const onSelect = vi.fn();
    const renderer = renderList({ onSelect });
    const pressables = findMentionPressables(renderer);

    act(() => {
      pressables[1].props.onPress();
    });

    expect(onSelect).toHaveBeenCalledWith(users[1]);
  });

  it("displays @username text for users that have a username", () => {
    const renderer = renderList();
    // Username text is rendered as ["@", "username"] children in React
    const textNodes = renderer.root.findAll(
      (node) => {
        if ((node.type as string) !== "Text") return false;
        const children = node.props.children;
        if (Array.isArray(children) && children.length === 2 && children[0] === "@") return true;
        return false;
      },
    );
    const usernames = textNodes.map((n) => `@${(n.props.children as string[])[1]}`);
    expect(usernames).toContain("@everyone");
    expect(usernames).toContain("@alice");
    expect(usernames).toContain("@bob");
  });

  it("renders avatar with correct image URI when baseUrl is provided", () => {
    const renderer = renderList({ baseUrl: "https://example.com", authToken: "tok" });
    const avatars = renderer.root.findAll((node) => (node.type as string) === "MockAvatar");
    const aliceAvatar = avatars.find((a) => a.props.name === "Alice Smith");
    expect(aliceAvatar?.props.imageUri).toBe("https://example.com/avatars/alice.png");
    expect(aliceAvatar?.props.authToken).toBe("tok");
  });

  it("renders avatar without image URI when baseUrl is not provided", () => {
    const renderer = renderList();
    const avatars = renderer.root.findAll((node) => (node.type as string) === "MockAvatar");
    const aliceAvatar = avatars.find((a) => a.props.name === "Alice Smith");
    expect(aliceAvatar?.props.imageUri).toBeUndefined();
  });

  it("shows users even when still loading (streaming results)", () => {
    const renderer = renderList({ loading: true });
    const pressables = findMentionPressables(renderer);
    expect(pressables).toHaveLength(3);
  });
});
