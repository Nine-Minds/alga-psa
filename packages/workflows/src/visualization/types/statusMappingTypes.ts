/**
 * Types for mapping runtime status to visualization status
 */
import { createContext } from 'react';

/**
 * Status mapping configuration
 */
export interface StatusMapping {
  nodeStatusMap: {
    [key: string]: 'default' | 'active' | 'success' | 'error' | 'warning';
  };
  edgeStatusMap: {
    [key: string]: {
      animated: boolean;
      style: {
        stroke: string;
        strokeWidth?: number;
      };
    };
  };
}

/**
 * Default status mapping
 */
export const defaultStatusMapping: StatusMapping = {
  nodeStatusMap: {
    default: 'default',
    active: 'active',
    success: 'success',
    error: 'error',
    warning: 'warning'
  },
  edgeStatusMap: {
    default: {
      animated: false,
      style: {
        stroke: '#ccc',
        strokeWidth: 1
      }
    },
    active: {
      animated: true,
      style: {
        stroke: '#3498db',
        strokeWidth: 2
      }
    },
    success: {
      animated: false,
      style: {
        stroke: '#2ecc71',
        strokeWidth: 2
      }
    },
    error: {
      animated: false,
      style: {
        stroke: '#e74c3c',
        strokeWidth: 2
      }
    }
  }
};

/**
 * Context for status mapping
 */
export const StatusMappingContext = createContext<StatusMapping>(defaultStatusMapping);