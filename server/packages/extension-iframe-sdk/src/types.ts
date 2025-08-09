export interface HostInitEvent {
  type: 'init';
  payload: { tenantId: string; extensionId: string; theme?: Record<string, string> };
}

export interface ThemeEvent { type: 'theme'; payload: Record<string, string> }
export interface AuthEvent { type: 'auth'; payload: { token: string } }
export interface NavigateEvent { type: 'navigate'; payload: { path: string } }
export interface TelemetryEvent { type: 'telemetry'; payload: Record<string, any> }
export interface ResizeEvent { type: 'resize'; payload: { height: number } }

export type HostEvent = HostInitEvent | ThemeEvent | AuthEvent | NavigateEvent | TelemetryEvent | ResizeEvent;

