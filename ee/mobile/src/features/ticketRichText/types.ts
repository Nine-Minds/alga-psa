export type TicketMobileEditorCommand =
  | "focus"
  | "blur"
  | "set-content"
  | "set-editable"
  | "toggle-bold"
  | "toggle-italic"
  | "toggle-underline"
  | "toggle-bullet-list"
  | "toggle-ordered-list"
  | "undo"
  | "redo";

export type TicketMobileEditorRequest = "get-html" | "get-json";

export type TicketMobileEditorToolbarState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  bulletList: boolean;
  orderedList: boolean;
};

export type TicketMobileEditorStatePayload = {
  ready: boolean;
  focused: boolean;
  editable: boolean;
  toolbar: TicketMobileEditorToolbarState;
  canUndo: boolean;
  canRedo: boolean;
};

export type TicketMobileEditorInitPayload = {
  content: string | null | undefined;
  editable: boolean;
  autofocus?: boolean;
  placeholder?: string;
  debounceMs?: number;
  imageAuth?: { baseUrl: string; apiKey: string };
};

export type TicketMobileEditorNativeToWebMessage =
  | {
      type: "init";
      payload: TicketMobileEditorInitPayload;
    }
  | {
      type: "command";
      payload: {
        command: TicketMobileEditorCommand;
        value?: string | boolean;
      };
    }
  | {
      type: "request";
      payload: {
        requestId: string;
        request: TicketMobileEditorRequest;
      };
    }
  | {
      type: "image-data";
      payload: {
        src: string;
        dataUri: string;
      };
    };

export type TicketMobileEditorWebToNativeMessage =
  | {
      type: "editor-ready";
      payload: {
        format: "blocknote" | "prosemirror";
        editable: boolean;
      };
    }
  | {
      type: "state-change";
      payload: TicketMobileEditorStatePayload;
    }
  | {
      type: "content-change";
      payload: {
        html: string;
        json: unknown;
      };
    }
  | {
      type: "content-height";
      payload: {
        height: number;
      };
    }
  | {
      type: "response";
      payload: {
        requestId: string;
        request: TicketMobileEditorRequest;
        value: unknown;
      };
    }
  | {
      type: "error";
      payload: {
        code: string;
        message: string;
        requestId?: string;
      };
    }
  | {
      type: "image-request";
      payload: {
        src: string;
      };
    };
