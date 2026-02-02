import { ComponentType } from 'react';

declare module '@ee/*' {
  const Component: ComponentType<any>;
  export default Component;
}

declare module '@enterprise/*' {
  const Component: ComponentType<any>;
  export default Component;
}
