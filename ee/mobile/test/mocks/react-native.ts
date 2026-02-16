type MockComponentProps = Record<string, unknown>;

function MockComponent(): null {
  return null;
}

export const Platform = { OS: "web" };
export const StyleSheet = { create: <T extends Record<string, unknown>>(styles: T): T => styles };
export const View = MockComponent as (_props: MockComponentProps) => null;
export const Text = MockComponent as (_props: MockComponentProps) => null;
export const ActivityIndicator = MockComponent as (_props: MockComponentProps) => null;
export const Pressable = MockComponent;
