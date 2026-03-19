import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class AlgaPsaApi implements ICredentialType {
  name = 'algaPsaApi';

  displayName = 'Alga PSA API';

  documentationUrl = 'https://github.com/alga-psa/alga-psa';

  properties: INodeProperties[] = [
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'https://algapsa.com',
      description: 'Base URL for your Alga PSA instance',
    },
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: {
        password: true,
      },
      default: '',
      required: true,
      description: 'API key used to authenticate with Alga PSA',
    },
  ];
}
