import type { ReactNode } from "react";
import { Component } from "react";
import { ErrorState } from "../ui/states";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { reportError } from "./errorReporting";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: unknown) {
    reportError(error, { errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorState
          title="App error"
          description="Something went wrong. You can try reloading the app."
          action={
            <PrimaryButton onPress={() => this.setState({ hasError: false })}>
              Try again
            </PrimaryButton>
          }
        />
      );
    }

    return this.props.children;
  }
}

